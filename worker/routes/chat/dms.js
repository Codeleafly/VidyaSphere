/**
 * Consent-First 1-on-1 Direct Message Routes
 */

import { errorResponse, successResponse } from '../../utils/response.js';
import { generateId } from '../../auth/crypto.js';
import { authenticate } from '../../auth/middleware.js';

export function parseDmId(channel) {
  if (!channel) return null;
  let clean = channel;
  while (clean.startsWith('dm_')) {
    clean = clean.substring(3);
  }
  return clean ? `dm_${clean}` : null;
}

export async function handleDmRoutes(request, env, path, method) {
  // GET /api/chat/dms - List all direct chats for current user
  if (path === '/api/chat/dms' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const { results } = await env.DB.prepare(`
      SELECT dc.id, dc.user1_id, dc.user2_id, dc.status, dc.requested_by, dc.created_at, dc.updated_at,
             p1.username as u1_username, p1.full_name as u1_name, p1.class_name as u1_class, p1.division as u1_division, p1.roll_number as u1_roll, p1.is_root_admin as u1_root,
             p2.username as u2_username, p2.full_name as u2_name, p2.class_name as u2_class, p2.division as u2_division, p2.roll_number as u2_roll, p2.is_root_admin as u2_root,
             (SELECT content FROM messages WHERE channel = ('dm_' || dc.id) AND datetime(created_at) >= datetime('now', '-7 days') ORDER BY created_at DESC, rowid DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages WHERE channel = ('dm_' || dc.id) AND datetime(created_at) >= datetime('now', '-7 days') ORDER BY created_at DESC, rowid DESC LIMIT 1) as last_message_time
      FROM direct_chats dc
      JOIN profiles p1 ON dc.user1_id = p1.id
      JOIN profiles p2 ON dc.user2_id = p2.id
      WHERE dc.user1_id = ? OR dc.user2_id = ?
      ORDER BY dc.updated_at DESC
    `).bind(auth.user.id, auth.user.id).all();

    const dms = (results || []).map(r => {
      const isUser1 = r.user1_id === auth.user.id;
      const partner = {
        id: isUser1 ? r.user2_id : r.user1_id,
        username: isUser1 ? r.u2_username : r.u1_username,
        fullName: isUser1 ? r.u2_name : r.u1_name,
        className: isUser1 ? r.u2_class : r.u1_class,
        division: isUser1 ? r.u2_division : r.u1_division,
        rollNumber: isUser1 ? r.u2_roll : r.u1_roll,
        isRootAdmin: (isUser1 ? r.u2_root : r.u1_root) === 1,
      };
      return {
        id: r.id,
        partner,
        status: r.status,
        requestedByMe: r.requested_by === auth.user.id,
        lastMessage: r.last_message || null,
        lastMessageTime: r.last_message_time || r.created_at,
        updatedAt: r.updated_at
      };
    });

    return successResponse({ dms });
  }

  // POST /api/chat/dms/request - Request permission to chat 1-on-1
  if (path === '/api/chat/dms/request' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { targetUserId, targetUsername, query } = body;

      let target = null;
      if (targetUserId) {
        target = await env.DB.prepare(
          `SELECT id, username, full_name, class_name FROM profiles WHERE id = ? AND account_status = 'active'`
        ).bind(targetUserId).first();
      } else {
        const cleanQuery = (targetUsername || query || '').toString().trim();
        const cleanHandle = cleanQuery.replace(/^@/, '').toLowerCase();
        if (cleanHandle) {
          target = await env.DB.prepare(
            `SELECT id, username, full_name, class_name FROM profiles WHERE LOWER(username) = ? AND account_status = 'active'`
          ).bind(cleanHandle).first();
        }
        if (!target && /^\d+$/.test(cleanQuery)) {
          target = await env.DB.prepare(
            `SELECT id, username, full_name, class_name FROM profiles WHERE roll_number = ? AND account_status = 'active'`
          ).bind(cleanQuery).first();
        }
      }

      if (!target) {
        return errorResponse('Student not found in school directory', 404);
      }

      if (target.id === auth.user.id) {
        return errorResponse('You cannot start a direct chat with yourself', 400);
      }

      const [u1, u2] = [auth.user.id, target.id].sort();
      const existing = await env.DB.prepare(
        `SELECT * FROM direct_chats WHERE user1_id = ? AND user2_id = ?`
      ).bind(u1, u2).first();

      if (existing) {
        if (existing.status === 'accepted') {
          return successResponse({ id: existing.id, status: 'accepted', partner: target }, 'Chat conversation is already active');
        }
        if (existing.status === 'pending') {
          return successResponse({ id: existing.id, status: 'pending', partner: target }, 'Chat request is already pending authorization');
        }
        await env.DB.prepare(
          `UPDATE direct_chats SET status = 'pending', requested_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(auth.user.id, existing.id).run();
        return successResponse({ id: existing.id, status: 'pending', partner: target }, 'Chat request re-sent successfully!');
      }

      const dmId = generateId('dm', 8);
      await env.DB.prepare(
        `INSERT INTO direct_chats (id, user1_id, user2_id, status, requested_by)
         VALUES (?, ?, ?, 'pending', ?)`
      ).bind(dmId, u1, u2, auth.user.id).run();

      return successResponse({
        id: dmId,
        status: 'pending',
        partner: target,
      }, `Chat request sent to ${target.full_name}! Messaging will activate once they accept.`, 201);
    } catch (err) {
      return errorResponse(`Direct chat error: ${err.message}`, 500);
    }
  }

  // POST /api/chat/dms/:id/accept - Recipient accepts chat request
  if (path.startsWith('/api/chat/dms/') && path.endsWith('/accept') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const dmId = path.split('/')[4];
    const dm = await env.DB.prepare(`SELECT * FROM direct_chats WHERE id = ?`).bind(dmId).first();
    if (!dm) return errorResponse('Direct chat request not found', 404);

    if (dm.user1_id !== auth.user.id && dm.user2_id !== auth.user.id) {
      return errorResponse('Forbidden: You are not a participant in this conversation', 403);
    }
    if (dm.requested_by === auth.user.id) {
      return errorResponse('You cannot accept a request you sent yourself. Awaiting recipient approval.', 400);
    }

    await env.DB.prepare(
      `UPDATE direct_chats SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(dmId).run();

    return successResponse({ id: dmId, status: 'accepted' }, 'Chat request accepted! You can now exchange direct messages.');
  }

  // POST /api/chat/dms/:id/decline - Recipient declines chat request
  if (path.startsWith('/api/chat/dms/') && path.endsWith('/decline') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const dmId = path.split('/')[4];
    const dm = await env.DB.prepare(`SELECT * FROM direct_chats WHERE id = ?`).bind(dmId).first();
    if (!dm) return errorResponse('Direct chat request not found', 404);

    if (dm.user1_id !== auth.user.id && dm.user2_id !== auth.user.id) {
      return errorResponse('Forbidden: You are not a participant in this conversation', 403);
    }

    await env.DB.prepare(
      `UPDATE direct_chats SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(dmId).run();

    return successResponse({ id: dmId, status: 'rejected' }, 'Chat request declined.');
  }

  return null;
}
