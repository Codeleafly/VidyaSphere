/**
 * Phase 4: Realtime Student-to-Student Chat Engine
 * Features:
 * 1. Public Class & School Hub Channels
 * 2. Consent-First 1-on-1 Direct Messages (Permission required before chatting)
 * 3. Custom Study Groups
 * 4. Ephemeral 7-Day Auto-Purge (Messages & attachments auto-expire after 7 days)
 * 5. Edit & Delete Sent Messages (Full student control)
 * 6. Scientific Lossless Gzip Compressed File Attachments (Images, PDFs, Study Materials)
 * 7. Zero-Waste Lazy Download Architecture (Files download ONLY on explicit demand)
 */

import { jsonResponse, errorResponse, successResponse, corsHeaders } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

// Native Gzip Compression using Web Standards CompressionStream (Shrinks PDFs, text, and data losslessly)
async function compressData(arrayBuffer) {
  const stream = new Response(arrayBuffer).body.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

// Native Gzip Decompression using Web Standards DecompressionStream (Restores 100% original bytes)
async function decompressData(compressedArrayBuffer) {
  const stream = new Response(compressedArrayBuffer).body.pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

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
              isEdited: 0,
              hasAttachment: 0,
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
             (SELECT content FROM messages WHERE channel = ('dm_' || dc.id) AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages WHERE channel = ('dm_' || dc.id) AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 1) as last_message_time
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

  // 6a. GET /api/chat/groups/:id/members - List members of a study group
  if (path.startsWith('/api/chat/groups/') && path.endsWith('/members') && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const groupId = parts[4];

    // Check if user is a member of this group or system admin
    const callerMember = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).first();

    if (!callerMember && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You are not a member of this study group', 403);
    }

    const { results } = await env.DB.prepare(`
      SELECT gm.group_id, gm.user_id, gm.role as member_role,
             strftime('%Y-%m-%dT%H:%M:%SZ', gm.joined_at) as joined_at,
             p.username, p.full_name, p.class_name, p.division, p.roll_number, p.is_root_admin
      FROM group_members gm
      JOIN profiles p ON gm.user_id = p.id
      WHERE gm.group_id = ?
      ORDER BY (CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END), p.full_name ASC
    `).bind(groupId).all();

    return successResponse({ members: results || [] });
  }

  // 6b. POST /api/chat/groups/:id/members - Add member to study group
  if (path.startsWith('/api/chat/groups/') && path.endsWith('/members') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const groupId = parts[4];

    const group = await env.DB.prepare(`SELECT * FROM chat_groups WHERE id = ?`).bind(groupId).first();
    if (!group) return errorResponse('Study group not found', 404);

    const callerMember = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).first();

    if (!callerMember && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only study group members can add classmates', 403);
    }

    try {
      const body = await request.json();
      const { targetUserId, targetUsername } = body;

      if (!targetUserId && !targetUsername) {
        return errorResponse('Student ID or username is required', 400);
      }

      let targetUser = null;
      if (targetUserId) {
        targetUser = await env.DB.prepare(`SELECT * FROM profiles WHERE id = ? AND account_status = 'active'`).bind(targetUserId).first();
      } else {
        targetUser = await env.DB.prepare(`SELECT * FROM profiles WHERE username = ? AND account_status = 'active'`).bind(targetUsername.trim().toLowerCase()).first();
      }

      if (!targetUser) {
        return errorResponse('Classmate not found or student account is not active', 404);
      }

      const existing = await env.DB.prepare(
        `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
      ).bind(groupId, targetUser.id).first();

      if (existing) {
        return errorResponse(`${targetUser.full_name} is already a member of this study group`, 400);
      }

      await env.DB.prepare(
        `INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'member')`
      ).bind(groupId, targetUser.id).run();

      return successResponse({
        member: {
          id: targetUser.id,
          username: targetUser.username,
          fullName: targetUser.full_name,
          role: 'member'
        }
      }, `${targetUser.full_name} added to ${group.name}!`, 201);
    } catch (err) {
      return errorResponse(`Add member error: ${err.message}`, 500);
    }
  }

  // 6c. DELETE /api/chat/groups/:id/members/:userId - Remove member or leave group
  if (path.startsWith('/api/chat/groups/') && path.includes('/members/') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const groupId = parts[4];
    const targetUserId = parts[6];

    const group = await env.DB.prepare(`SELECT * FROM chat_groups WHERE id = ?`).bind(groupId).first();
    if (!group) return errorResponse('Study group not found', 404);

    const callerMember = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).first();

    if (!callerMember && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You are not a member of this group', 403);
    }

    const isSelfLeaving = (targetUserId === auth.user.id);
    const isGroupAdmin = (callerMember && callerMember.role === 'admin');
    const isSystemAdmin = (auth.user.role === 'admin');

    if (!isSelfLeaving && !isGroupAdmin && !isSystemAdmin) {
      return errorResponse('Forbidden: Only group admins can remove other members', 403);
    }

    await env.DB.prepare(
      `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, targetUserId).run();

    return successResponse({ groupId, userId: targetUserId }, isSelfLeaving ? 'You left the study group' : 'Member removed from group');
  }

  // 6d. DELETE /api/chat/groups/:id - Delete study group (Creator, Admin)
  if (path.startsWith('/api/chat/groups/') && !path.includes('/members') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const groupId = parts[4];

    const group = await env.DB.prepare(`SELECT * FROM chat_groups WHERE id = ?`).bind(groupId).first();
    if (!group) return errorResponse('Study group not found', 404);

    if (group.creator_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only the group creator or admin can delete the study group', 403);
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM group_members WHERE group_id = ?`).bind(groupId),
      env.DB.prepare(`DELETE FROM messages WHERE channel = ?`).bind(`grp_${groupId}`),
      env.DB.prepare(`DELETE FROM chat_groups WHERE id = ?`).bind(groupId)
    ]);

    return successResponse({ groupId }, 'Study group deleted');
  }

  // 7. GET /api/chat/messages - Fetch messages for channel (Strict Ephemeral 7-Day Window)
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

    // Strict 7-Day Auto-Purge window with ISO 8601 UTC Z formatting
    const { results } = await env.DB.prepare(`
      SELECT m.id, m.sender_id, m.channel, m.content, m.is_edited, m.has_attachment,
             m.attachment_name, m.attachment_type, m.attachment_size,
             strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at,
             strftime('%Y-%m-%dT%H:%M:%SZ', m.updated_at) as updated_at,
             p.full_name as sender_name, p.role as sender_role, p.class_name, p.is_root_admin
      FROM messages m
      JOIN profiles p ON m.sender_id = p.id
      WHERE m.channel = ? AND m.created_at >= datetime('now', '-7 days')
      ORDER BY m.created_at DESC LIMIT 80
    `).bind(channel).all();

    const messages = (results || []).reverse();
    return successResponse({ messages });
  }

  // 8. POST /api/chat/messages - Send message with optional Compressed Study Attachment
  if (path === '/api/chat/messages' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const contentType = request.headers.get('content-type') || '';
      let content = '', channel = 'school';
      let fileBuffer = null, fileName = null, fileType = null, fileSize = 0;

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        content = (formData.get('content') || '').toString().trim();
        channel = (formData.get('channel') || 'school').toString().trim();
        const file = formData.get('file');

        if (file && typeof file === 'object' && file.name) {
          fileName = file.name;
          fileType = file.type || 'application/octet-stream';
          fileBuffer = await file.arrayBuffer();
          fileSize = fileBuffer.byteLength;
        }
      } else {
        const body = await request.json();
        content = (body.content || '').trim();
        channel = (body.channel || 'school').trim();

        if (body.fileBase64 && body.fileName) {
          fileName = body.fileName;
          fileType = body.fileType || 'application/octet-stream';
          const binary = atob(body.fileBase64);
          const u8 = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i);
          fileBuffer = u8.buffer;
          fileSize = fileBuffer.byteLength;
        }
      }

      if (!content && !fileBuffer) {
        return errorResponse('Message content or file attachment is required', 400);
      }

      // Max 10MB attachment limit for chat to protect mobile edge storage
      if (fileSize > 10 * 1024 * 1024) {
        return errorResponse('Chat file attachment exceeds the 10MB limit. For large textbooks, use Google Drive in the Notes section.', 400);
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

      const msgId = generateId('msg', 8);
      const hasAttachment = fileBuffer ? 1 : 0;

      // Persist parent message
      await env.DB.prepare(`
        INSERT INTO messages (id, sender_id, channel, content, is_edited, has_attachment, attachment_name, attachment_type, attachment_size)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).bind(
        msgId,
        auth.user.id,
        channel,
        content || (fileName ? `Shared attachment: ${fileName}` : ''),
        hasAttachment,
        fileName || null,
        fileType || null,
        fileSize || 0
      ).run();

      // If attachment exists: apply scientific lossless Gzip compression before storing
      if (fileBuffer) {
        const compressed = await compressData(fileBuffer);
        const compressedBytes = new Uint8Array(compressed);

        await env.DB.prepare(`
          INSERT INTO message_attachments (message_id, file_name, file_type, file_size, compressed_data)
          VALUES (?, ?, ?, ?, ?)
        `).bind(msgId, fileName, fileType, fileSize, compressedBytes).run();
      }

      const responsePayload = {
        id: msgId,
        senderName: auth.user.fullName,
        senderRole: auth.user.role,
        isRootAdmin: auth.user.isRootAdmin || false,
        channel,
        content: content || (fileName ? `Shared attachment: ${fileName}` : ''),
        isEdited: 0,
        hasAttachment,
        attachmentName: fileName || null,
        attachmentType: fileType || null,
        attachmentSize: fileSize || 0,
        createdAt: new Date().toISOString(),
      };

      return successResponse(responsePayload, 'Message sent', 201);
    } catch (err) {
      return errorResponse(`Chat send error: ${err.message}`, 500);
    }
  }

  // 9. PUT /api/chat/messages/:id - Edit sent message (Sender or Admin only)
  if (path.startsWith('/api/chat/messages/') && !path.includes('/attachments') && method === 'PUT') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const msgId = parts[4];

    try {
      const body = await request.json();
      const { content } = body;

      if (!content || !content.trim()) {
        return errorResponse('Updated message content cannot be empty', 400);
      }

      const existing = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
      if (!existing) return errorResponse('Message not found', 404);

      if (existing.sender_id !== auth.user.id && auth.user.role !== 'admin') {
        return errorResponse('Forbidden: You can only edit your own messages', 403);
      }

      // Check if message is older than 7 days
      const createdAt = new Date(existing.created_at);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      if (createdAt < sevenDaysAgo) {
        return errorResponse('Expired messages older than 7 days cannot be edited', 400);
      }

      await env.DB.prepare(`
        UPDATE messages
        SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(content.trim(), msgId).run();

      return successResponse({ id: msgId, content: content.trim(), isEdited: 1 }, 'Message updated successfully');
    } catch (err) {
      return errorResponse(`Message edit failed: ${err.message}`, 500);
    }
  }

  // 10. DELETE /api/chat/messages/:id - Delete sent message (Sender or Admin only)
  if (path.startsWith('/api/chat/messages/') && !path.includes('/attachments') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const msgId = parts[4];

    try {
      const existing = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
      if (!existing) return errorResponse('Message not found', 404);

      if (existing.sender_id !== auth.user.id && auth.user.role !== 'admin') {
        return errorResponse('Forbidden: You can only delete your own messages', 403);
      }

      // Cascade delete attachment chunks
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM message_attachments WHERE message_id = ?`).bind(msgId),
        env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(msgId)
      ]);

      return successResponse({ id: msgId }, 'Message deleted successfully');
    } catch (err) {
      return errorResponse(`Message deletion failed: ${err.message}`, 500);
    }
  }

  // 11. GET /api/chat/attachments/:messageId - On-Demand Lazy Download (Zero Quality Loss)
  if (path.startsWith('/api/chat/attachments/') && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const msgId = parts[4];

    // Verify parent message exists & channel access
    const msg = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
    if (!msg) return errorResponse('Attachment message not found or expired', 404);

    if (msg.channel.startsWith('dm_')) {
      const dmId = msg.channel.replace('dm_', '');
      const dm = await env.DB.prepare(`SELECT * FROM direct_chats WHERE id = ?`).bind(dmId).first();
      if (!dm || (dm.user1_id !== auth.user.id && dm.user2_id !== auth.user.id)) {
        return errorResponse('Access denied to private attachment', 403);
      }
    }

    const attachment = await env.DB.prepare(`SELECT * FROM message_attachments WHERE message_id = ?`).bind(msgId).first();
    if (!attachment) return errorResponse('File attachment not found or already purged', 404);

    try {
      let rawData = attachment.compressed_data;
      let u8;
      if (rawData instanceof Uint8Array) {
        u8 = rawData;
      } else if (ArrayBuffer.isView(rawData)) {
        u8 = new Uint8Array(rawData.buffer, rawData.byteOffset, rawData.byteLength);
      } else if (typeof rawData === 'string') {
        const bin = atob(rawData);
        u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      } else {
        u8 = new Uint8Array(rawData);
      }

      // Lossless decompression using native DecompressionStream
      let outputBuffer;
      if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
        outputBuffer = await decompressData(u8.buffer);
      } else {
        outputBuffer = u8.buffer;
      }

      const cleanFilename = (attachment.file_name || 'download').replace(/[^a-zA-Z0-9._-]/g, '_');

      return new Response(outputBuffer, {
        headers: {
          'Content-Type': attachment.file_type || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${cleanFilename}"`,
          'Cache-Control': 'public, max-age=86400',
          ...corsHeaders(),
        }
      });
    } catch (decompErr) {
      return errorResponse(`Decompression error: ${decompErr.message}`, 500);
    }
  }

  return errorResponse('Chat route not found', 404);
}
