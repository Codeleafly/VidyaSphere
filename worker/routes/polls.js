/**
 * Phase 3: School Polls & Student Elections
 * Duplicate-proof voting ledger with live tallies & moderation
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handlePollsRoutes(request, env, path, method) {
  // GET /api/polls - Fetch active/closed polls with live vote tallies
  if (path === '/api/polls' && method === 'GET') {
    const authHeader = request.headers.get('Authorization');
    let currentUserId = null;
    if (authHeader) {
      const auth = await authenticate(request, env);
      if (!auth.error) currentUserId = auth.user.id;
    }

    const { results: rawPolls } = await env.DB.prepare(
      `SELECT p.*, pr.full_name as creator_name, pr.role as creator_role,
              pr.teacher_type as creator_teacher_type, pr.is_root_admin as creator_is_root_admin
       FROM polls p
       LEFT JOIN profiles pr ON p.creator_id = pr.id
       ORDER BY p.created_at DESC LIMIT 40`
    ).all();

    const polls = await Promise.all((rawPolls || []).map(async (poll) => {
      let options = [];
      try {
        options = JSON.parse(poll.options_json);
      } catch {
        options = [];
      }

      const { results: votes } = await env.DB.prepare(
        `SELECT option_index, COUNT(*) as count FROM poll_votes WHERE poll_id = ? GROUP BY option_index`
      ).bind(poll.id).all();

      const counts = {};
      let totalVotes = 0;
      (votes || []).forEach(v => {
        counts[v.option_index] = v.count;
        totalVotes += v.count;
      });

      const optionsWithVotes = options.map((opt, idx) => {
        const count = counts[idx] || 0;
        const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        return {
          index: idx,
          label: opt,
          votes: count,
          percentage,
        };
      });

      let userVotedOption = null;
      if (currentUserId) {
        const userVote = await env.DB.prepare(
          `SELECT option_index FROM poll_votes WHERE poll_id = ? AND user_id = ?`
        ).bind(poll.id, currentUserId).first();
        if (userVote) userVotedOption = userVote.option_index;
      }

      const isExpired = poll.expires_at ? new Date(poll.expires_at) <= new Date() : false;

      return {
        id: poll.id,
        creatorId: poll.creator_id,
        question: poll.question,
        creatorName: poll.creator_name,
        creatorRole: poll.creator_role,
        creatorTeacherType: poll.creator_teacher_type || null,
        creatorIsRootAdmin: poll.creator_is_root_admin === 1,
        expiresAt: poll.expires_at,
        isExpired,
        totalVotes,
        options: optionsWithVotes,
        userVotedOption,
        createdAt: poll.created_at,
      };
    }));

    return successResponse({ polls });
  }

  // POST /api/polls - Create a new poll (Admin, Teacher, or Student)
  if (path === '/api/polls' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { question, options, expiresAt } = body;

      if (!question || !Array.isArray(options) || options.length < 2) {
        return errorResponse('Question and at least 2 options are required');
      }

      const id = generateId('poll', 8);
      const cleanOptions = options.map(o => String(o).trim()).filter(Boolean);

      if (cleanOptions.length < 2) {
        return errorResponse('At least 2 non-empty options are required');
      }

      let normalizedExpiry = null;
      if (expiresAt && String(expiresAt).trim()) {
        const parsed = new Date(String(expiresAt).trim());
        if (isNaN(parsed.getTime())) {
          return errorResponse('Invalid expiration date format', 400);
        }
        normalizedExpiry = parsed.toISOString();
      }

      await env.DB.prepare(
        `INSERT INTO polls (id, creator_id, question, options_json, expires_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(id, auth.user.id, question.trim(), JSON.stringify(cleanOptions), normalizedExpiry)
        .run();

      return successResponse({ id }, 'Poll created successfully', 201);
    } catch (err) {
      return errorResponse(`Poll creation error: ${err.message}`, 500);
    }
  }

  // POST /api/polls/:id/vote - Cast vote with strict single-vote enforcement
  if (path.startsWith('/api/polls/') && path.endsWith('/vote') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const pollId = parts[3];

    try {
      const body = await request.json();
      const { optionIndex } = body;

      if (typeof optionIndex !== 'number') {
        return errorResponse('optionIndex is required');
      }

      const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(pollId).first();
      if (!poll) return errorResponse('Poll not found', 404);

      if (poll.expires_at && new Date(poll.expires_at) <= new Date()) {
        return errorResponse('This poll has ended and is closed for voting', 400);
      }

      const options = JSON.parse(poll.options_json);
      if (optionIndex < 0 || optionIndex >= options.length) {
        return errorResponse('Invalid option selected', 400);
      }

      const voteId = generateId('vote', 8);

      try {
        await env.DB.prepare(
          `INSERT INTO poll_votes (id, poll_id, user_id, option_index) VALUES (?, ?, ?, ?)`
        ).bind(voteId, pollId, auth.user.id, optionIndex).run();
      } catch (dbErr) {
        if (dbErr.message.includes('UNIQUE') || dbErr.message.includes('constraint')) {
          return errorResponse('You have already voted in this poll. Multiple votes are forbidden.', 409);
        }
        throw dbErr;
      }

      return successResponse({ pollId, optionIndex }, 'Vote recorded successfully!');
    } catch (err) {
      return errorResponse(`Voting error: ${err.message}`, 500);
    }
  }

  // POST /api/polls/:id/close - Close poll early (Creator or Admin)
  if (path.startsWith('/api/polls/') && path.endsWith('/close') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const pollId = path.split('/')[3];
    const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(pollId).first();
    if (!poll) return errorResponse('Poll not found', 404);

    if (poll.creator_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only the poll creator or an Admin can close this poll', 403);
    }

    const nowIso = new Date().toISOString();
    await env.DB.prepare(`UPDATE polls SET expires_at = ? WHERE id = ?`).bind(nowIso, pollId).run();

    return successResponse({ id: pollId, expiresAt: nowIso }, 'Poll closed for voting');
  }

  // DELETE /api/polls/:id - Delete poll and votes (Creator or Admin)
  if (path.startsWith('/api/polls/') && !path.endsWith('/vote') && !path.endsWith('/close') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const pollId = path.replace('/api/polls/', '').trim();
    const poll = await env.DB.prepare(`SELECT * FROM polls WHERE id = ?`).bind(pollId).first();
    if (!poll) return errorResponse('Poll not found', 404);

    if (poll.creator_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only the poll creator or an Admin can delete this poll', 403);
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM poll_votes WHERE poll_id = ?`).bind(pollId),
      env.DB.prepare(`DELETE FROM polls WHERE id = ?`).bind(pollId),
    ]);

    return successResponse({ id: pollId }, 'Poll deleted successfully');
  }

  return errorResponse('Poll route not found', 404);
}
