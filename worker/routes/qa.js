/**
 * Phase 3: Academic Q&A Forum
 * Peer-to-peer homework help with accepted solution verification
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleQARoutes(request, env, path, method) {
  // GET /api/qa/questions - List questions with answer count
  if (path === '/api/qa/questions' && method === 'GET') {
    const url = new URL(request.url);
    const subject = url.searchParams.get('subject') || '';
    const className = url.searchParams.get('className') || '';
    const status = url.searchParams.get('status') || ''; // 'resolved' or 'unanswered'

    let query = `
      SELECT q.*, p.full_name as author_name, p.role as author_role,
             (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) as answer_count
      FROM questions q
      LEFT JOIN profiles p ON q.author_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (subject) {
      query += ` AND q.subject = ?`;
      params.push(subject);
    }
    if (className) {
      query += ` AND q.class_name = ?`;
      params.push(className);
    }
    if (status === 'resolved') {
      query += ` AND q.is_resolved = 1`;
    } else if (status === 'unanswered') {
      query += ` AND (SELECT COUNT(*) FROM answers a WHERE a.question_id = q.id) = 0`;
    }

    query += ` ORDER BY q.created_at DESC LIMIT 50`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ questions: results || [] });
  }

  // GET /api/qa/questions/:id - Detail view with all answers
  if (path.startsWith('/api/qa/questions/') && !path.includes('/answers') && method === 'GET') {
    const id = path.replace('/api/qa/questions/', '');

    const question = await env.DB.prepare(
      `SELECT q.*, p.full_name as author_name, p.role as author_role
       FROM questions q
       LEFT JOIN profiles p ON q.author_id = p.id
       WHERE q.id = ?`
    ).bind(id).first();

    if (!question) return errorResponse('Question not found', 404);

    const { results: answers } = await env.DB.prepare(
      `SELECT a.*, p.full_name as author_name, p.role as author_role
       FROM answers a
       LEFT JOIN profiles p ON a.author_id = p.id
       WHERE a.question_id = ?
       ORDER BY a.is_accepted DESC, a.created_at ASC`
    ).bind(id).all();

    return successResponse({
      question,
      answers: answers || [],
    });
  }

  // POST /api/qa/questions - Ask a new question
  if (path === '/api/qa/questions' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { title, description, subject, className } = body;

      if (!title || !description || !subject || !className) {
        return errorResponse('Title, description, subject, and class are required');
      }

      const id = generateId('q', 8);

      await env.DB.prepare(
        `INSERT INTO questions (id, author_id, title, description, subject, class_name)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(id, auth.user.id, title.trim(), description.trim(), subject.trim(), className.trim())
        .run();

      return successResponse({ id }, 'Question posted successfully', 201);
    } catch (err) {
      return errorResponse(`Question error: ${err.message}`, 500);
    }
  }

  // POST /api/qa/questions/:id/answers - Submit an answer
  if (path.startsWith('/api/qa/questions/') && path.endsWith('/answers') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const questionId = parts[4];

    try {
      const body = await request.json();
      const { answerText } = body;

      if (!answerText || answerText.trim().length === 0) {
        return errorResponse('Answer text cannot be empty');
      }

      const answerId = generateId('ans', 8);

      await env.DB.prepare(
        `INSERT INTO answers (id, question_id, author_id, answer_text, is_accepted)
         VALUES (?, ?, ?, ?, 0)`
      )
        .bind(answerId, questionId, auth.user.id, answerText.trim())
        .run();

      return successResponse({ id: answerId }, 'Answer submitted successfully', 201);
    } catch (err) {
      return errorResponse(`Answer error: ${err.message}`, 500);
    }
  }

  // POST /api/qa/answers/:id/accept - Author marks an answer as accepted
  if (path.startsWith('/api/qa/answers/') && path.endsWith('/accept') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const answerId = parts[4];

    const answer = await env.DB.prepare(
      `SELECT a.*, q.author_id as question_author_id
       FROM answers a
       JOIN questions q ON a.question_id = q.id
       WHERE a.id = ?`
    ).bind(answerId).first();

    if (!answer) return errorResponse('Answer not found', 404);

    // Only the question author can accept an answer
    if (answer.question_author_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only the question author can accept this answer', 403);
    }

    await env.DB.batch([
      // Unmark any previously accepted answer for this question
      env.DB.prepare(`UPDATE answers SET is_accepted = 0 WHERE question_id = ?`).bind(answer.question_id),
      // Mark this answer accepted
      env.DB.prepare(`UPDATE answers SET is_accepted = 1 WHERE id = ?`).bind(answerId),
      // Mark question resolved
      env.DB.prepare(`UPDATE questions SET is_resolved = 1 WHERE id = ?`).bind(answer.question_id),
    ]);

    return successResponse({}, 'Answer accepted as the verified solution!');
  }

  return errorResponse('Q&A route not found', 404);
}
