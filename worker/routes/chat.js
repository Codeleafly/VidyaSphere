/**
 * Phase 4: Realtime Student-to-Student Chat Engine
 * Supports:
 * 1. Public Class & School Hub Channels
 * 2. Consent-First 1-on-1 Direct Messages (Permission required before chatting)
 * 3. Custom Study Groups
 * 4. WebSocket realtime streaming with fallback REST messaging
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

// In-memory active WebSocket connections map for Edge runtime broadcasting
const activeSockets = new Map(); // ws -> session

export async function handleChatRoutes(request, env, path, method) {
  // GET /api/chat/ws - WebSocket connection upgrade
  if (path === '/api/chat/ws') {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return errorResponse('Expected WebSocket Upgrade request', 426);
    }

    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return errorResponse('Authentication token required for WebSocket connection', 401);
    }

    // Authenticate token against sessions table
    const session = await env.DB.prepare(
      `SELECT s.user_id, p.username, p.full_name, p.role, p.class_name, p.division, p.is_root_admin
       FROM sessions s
       JOIN profiles p ON s.user_id = p.id
       WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP`
    ).bind(token).first();

    if (!session) {
      return errorResponse('Unauthorized WebSocket session', 401);
    }

    // Native WebSocketPair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    server.accept();
    activeSockets.set(server, session);

    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message' && data.content?.trim()) {
          const channel = data.channel || 'school';
          const content = data.content.trim();

          // Permission check for DM channel
          let targetUsers = null;
          if (channel.startsWith('dm_')) {
            const dmId = channel.replace('dm_', '');
            const dm = await env.DB.prepare(
              `SELECT * FROM direct_chats WHERE id = ?`
            ).bind(dmId).first();

            if (!dm || (dm.user1_id !== session.user_id && dm.user2_id !== session.user_id) || dm.status !== 'accepted') {
              server.send(JSON.stringify({ type: 'error', error: 'Direct chat not accepted or unauthorized' }));
              return;
            }
            targetUsers = new Set([dm.user1_id, dm.user2_id]);
          } else if (channel.startsWith('grp_')) {
            const grpId = channel.replace('grp_', '');
            const member = await env.DB.prepare(
              `SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?`
            ).bind(grpId, session.user_id).first();

            if (!member) {
              server.send(JSON.stringify({ type: 'error', error: 'You are not a member of this study group' }));
              return;
            }
          }

          const msgId = generateId('msg', 8);

          // Persist to D1
          await env.DB.prepare(
            `INSERT INTO messages (id, sender_id, channel, content) VALUES (?, ?, ?, ?)`
          ).bind(msgId, session.user_id, channel, content).run();

          const broadcastPayload = JSON.stringify({
            type: 'new_message',
            message: {
              id: msgId,
              senderId: session.user_id,
              senderName: session.full_name,
              senderRole: session.role,
              isRootAdmin: session.is_root_admin === 1,
              channel,
              content,
              createdAt: new Date().toISOString(),
            }
          });

          // Broadcast appropriately
          for (const [ws, userSession] of activeSockets.entries()) {
            try {
              if (targetUsers) {
                if (targetUsers.has(userSession.user_id)) {
                  ws.send(broadcastPayload);
                }
              } else {
                ws.send(broadcastPayload);
              }
            } catch (err) {
              activeSockets.delete(ws);
            }
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    server.addEventListener('close', () => {
      activeSockets.delete(server);
    });

    server.addEventListener('error', () => {
      activeSockets.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // 1. GET /api/chat/dms - List all direct chats for current student
  if (path === '/api/chat/dms' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const { results } = await env.DB.prepare(`
      SELECT dc.id, dc.user1_id, dc.user2_id, dc.status, dc.requested_by, dc.created_at, dc.updated_at,
             p1.username as u1_username, p1.full_name as u1_name, p1.class_name as u1_class, p1.is_root_admin as u1_root,
             p2.username as u2_username, p2.full_name as u2_name, p2.class_name as u2_class, p2.is_root_admin as u2_root,
             (SELECT content FROM messages WHERE channel = ('dm_' || dc.id) ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages WHERE channel = ('dm_' || dc.id) ORDER BY created_at DESC LIMIT 1) as last_message_time
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

  // 2. POST /api/chat/dms/request - Request permission to chat 1-on-1
  if (path === '/api/chat/dms/request' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { targetUserId, targetUsername } = body;

      let target = null;
      if (targetUserId) {
        target = await env.DB.prepare(`SELECT id, username, full_name, class_name FROM profiles WHERE id = ?`).bind(targetUserId).first();
      } else if (targetUsername) {
        target = await env.DB.prepare(`SELECT id, username, full_name, class_name FROM profiles WHERE username = ?`).bind(targetUsername.trim().toLowerCase()).first();
      }

      if (!target) {
        return errorResponse('Student not found in school directory', 404);
      }

      if (target.id === auth.user.id) {
        return errorResponse('You cannot start a direct chat with yourself', 400);
      }

      // Sort IDs so uniqueness constraint always checks the exact pair
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
        // If rejected previously, allow re-requesting
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

  // 3. POST /api/chat/dms/:id/accept - Recipient accepts chat request
  if (path.startsWith('/api/chat/dms/') && path.endsWith('/accept') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const dmId = parts[4];

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

  // 4. POST /api/chat/dms/:id/decline - Recipient declines chat request
  if (path.startsWith('/api/chat/dms/') && path.endsWith('/decline') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const dmId = parts[4];

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

  // 5. GET /api/chat/groups - List study groups
  if (path === '/api/chat/groups' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const { results } = await env.DB.prepare(`
      SELECT g.*, gm.role as my_role,
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
      FROM chat_groups g
      JOIN group_members gm ON g.id = gm.group_id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `).bind(auth.user.id).all();

    return successResponse({ groups: results || [] });
  }

  // 6. POST /api/chat/groups - Create study group
  if (path === '/api/chat/groups' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { name, description = '', className = 'all' } = body;

      if (!name || name.trim().length < 2) {
        return errorResponse('Group name must be at least 2 characters long', 400);
      }

      const groupId = generateId('grp', 8);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO chat_groups (id, name, description, class_name, creator_id)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(groupId, name.trim(), description.trim(), className, auth.user.id),
        env.DB.prepare(
          `INSERT INTO group_members (group_id, user_id, role)
           VALUES (?, ?, 'admin')`
        ).bind(groupId, auth.user.id)
      ]);

      return successResponse({ id: groupId, name: name.trim() }, 'Study group created successfully!', 201);
    } catch (err) {
      return errorResponse(`Create group error: ${err.message}`, 500);
    }
  }

  // 7. GET /api/chat/messages - Fetch recent messages for a channel
  if (path === '/api/chat/messages' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') || 'school';

    // Direct message security verification
    if (channel.startsWith('dm_')) {
      const dmId = channel.replace('dm_', '');
      const dm = await env.DB.prepare(
        `SELECT * FROM direct_chats WHERE id = ?`
      ).bind(dmId).first();

      if (!dm) return errorResponse('Direct chat conversation not found', 404);
      if (dm.user1_id !== auth.user.id && dm.user2_id !== auth.user.id) {
        return errorResponse('Access denied to private conversation', 403);
      }
      if (dm.status === 'pending') {
        return errorResponse('Chat permission pending. Awaiting student acceptance.', 403);
      }
      if (dm.status === 'rejected') {
        return errorResponse('This chat invitation was declined.', 403);
      }
    } else if (channel.startsWith('grp_')) {
      const grpId = channel.replace('grp_', '');
      const member = await env.DB.prepare(
        `SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?`
      ).bind(grpId, auth.user.id).first();

      if (!member) {
        return errorResponse('You are not a member of this study group', 403);
      }
    }

    const { results } = await env.DB.prepare(
      `SELECT m.*, p.full_name as sender_name, p.role as sender_role, p.class_name, p.is_root_admin
       FROM messages m
       JOIN profiles p ON m.sender_id = p.id
       WHERE m.channel = ?
       ORDER BY m.created_at DESC LIMIT 60`
    ).bind(channel).all();

    const messages = (results || []).reverse();
    return successResponse({ messages });
  }

  // 8. POST /api/chat/messages - Send message via REST
  if (path === '/api/chat/messages' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { content, channel = 'school' } = body;

      if (!content || !content.trim()) {
        return errorResponse('Message content cannot be empty', 400);
      }

      // Direct message security verification
      if (channel.startsWith('dm_')) {
        const dmId = channel.replace('dm_', '');
        const dm = await env.DB.prepare(
          `SELECT * FROM direct_chats WHERE id = ?`
        ).bind(dmId).first();

        if (!dm) return errorResponse('Direct chat conversation not found', 404);
        if (dm.user1_id !== auth.user.id && dm.user2_id !== auth.user.id) {
          return errorResponse('Access denied to private conversation', 403);
        }
        if (dm.status === 'pending') {
          return errorResponse('Cannot send message. Chat permission is pending authorization by the student.', 403);
        }
        if (dm.status === 'rejected') {
          return errorResponse('Cannot send message. Chat invitation was declined.', 403);
        }

        // Update direct chat timestamp
        await env.DB.prepare(`UPDATE direct_chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(dmId).run();
      } else if (channel.startsWith('grp_')) {
        const grpId = channel.replace('grp_', '');
        const member = await env.DB.prepare(
          `SELECT user_id FROM group_members WHERE group_id = ? AND user_id = ?`
        ).bind(grpId, auth.user.id).first();

        if (!member) {
          return errorResponse('You are not a member of this study group', 403);
        }
      }

      const id = generateId('msg', 8);

      await env.DB.prepare(
        `INSERT INTO messages (id, sender_id, channel, content) VALUES (?, ?, ?, ?)`
      ).bind(id, auth.user.id, channel, content.trim()).run();

      return successResponse(
        {
          id,
          senderName: auth.user.fullName,
          senderRole: auth.user.role,
          isRootAdmin: auth.user.isRootAdmin || false,
          channel,
          content: content.trim(),
          createdAt: new Date().toISOString(),
        },
        'Message sent',
        201
      );
    } catch (err) {
      return errorResponse(`Chat send error: ${err.message}`, 500);
    }
  }

  return errorResponse('Chat route not found', 404);
}
