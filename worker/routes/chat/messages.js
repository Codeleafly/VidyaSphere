/**
 * Chat Messages, Replies, Emoji Reactions, Pinning & Lossless Gzip Attachments Routes
 */

import { errorResponse, successResponse, corsHeaders } from '../../utils/response.js';
import { compressData, decompressData, toUint8Array, parseUtcTimestamp } from '../../utils/compression.js';
import { generateId } from '../../auth/crypto.js';
import { authenticate } from '../../auth/middleware.js';
import { canTeacherModerateChannel, isRootAdminAccount } from '../../utils/teacherScope.js';
import { parseDmId } from './dms.js';
import { broadcastChatMessage, broadcastChatEvent } from './ws.js';

const ALLOWED_REACTIONS = new Set(['👍', '❤️', '💡', '🔥', '✅', '🎉', '🙏', '😂']);

function sanitizeMessageRow(m) {
  const isRoot = m.is_root_admin === 1 || m.sender_is_root_admin === 1 || m.sender_username === 'admin';
  let reactions = {};
  try {
    reactions = m.reactions_json ? JSON.parse(m.reactions_json) : {};
  } catch { reactions = {}; }
  let replyPreview = null;
  try {
    replyPreview = m.reply_preview ? JSON.parse(m.reply_preview) : null;
  } catch { replyPreview = null; }

  return {
    ...m,
    class_name: isRoot ? '' : (m.class_name || ''),
    division: isRoot ? '' : (m.division || ''),
    roll_number: isRoot ? '' : (m.roll_number || ''),
    is_root_admin: isRoot ? 1 : 0,
    reactions,
    replyPreview,
  };
}

async function getTargetUsersForChannel(env, channel) {
  if (channel.startsWith('dm_')) {
    const canonicalDmId = parseDmId(channel);
    const dm = await env.DB.prepare(
      `SELECT user1_id, user2_id FROM direct_chats WHERE id = ? OR id = ?`
    ).bind(canonicalDmId, canonicalDmId.replace('dm_', '')).first();
    return dm ? new Set([dm.user1_id, dm.user2_id]) : new Set();
  }
  if (channel.startsWith('grp_')) {
    const grpId = channel.replace('grp_', '');
    const { results } = await env.DB.prepare(
      `SELECT user_id FROM group_members WHERE group_id = ? AND invite_status = 'accepted'`
    ).bind(grpId).all();
    return new Set((results || []).map(r => r.user_id));
  }
  return null;
}

async function verifyChannelReadAccess(env, channel, user) {
  if (channel.startsWith('dm_')) {
    const canonicalDmId = parseDmId(channel);
    const dm = await env.DB.prepare(
      `SELECT * FROM direct_chats WHERE id = ? OR id = ?`
    ).bind(canonicalDmId, canonicalDmId.replace('dm_', '')).first();

    if (!dm) return { error: errorResponse('Direct chat conversation not found', 404) };
    if (dm.user1_id !== user.id && dm.user2_id !== user.id) {
      return { error: errorResponse('Access denied to private conversation', 403) };
    }
    if (dm.status === 'pending') {
      return { error: errorResponse('Chat permission pending. Awaiting acceptance.', 403) };
    }
    if (dm.status === 'rejected') {
      return { error: errorResponse('This chat invitation was declined.', 403) };
    }
    return { matchChannels: [canonicalDmId, `dm_${canonicalDmId}`, channel] };
  }

  if (channel.startsWith('grp_')) {
    const grpId = channel.replace('grp_', '');
    const member = await env.DB.prepare(
      `SELECT user_id, invite_status FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(grpId, user.id).first();

    // Strict privacy: Even Lead Admin cannot view private study groups they haven't joined
    if (!member || member.invite_status !== 'accepted') {
      return { error: errorResponse('You are not an active member of this study group', 403) };
    }
  }

  return { matchChannels: [channel] };
}

export async function handleMessageRoutes(request, env, path, method) {
  // GET /api/chat/messages
  if (path === '/api/chat/messages' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') || 'school';
    const search = (url.searchParams.get('search') || '').trim();

    const access = await verifyChannelReadAccess(env, channel, auth.user);
    if (access.error) return access.error;

    const matchChannels = access.matchChannels;
    const since = url.searchParams.get('since');
    const placeholders = matchChannels.map(() => '?').join(',');

    let messages = [];
    if (since) {
      const { results } = await env.DB.prepare(`
        SELECT m.id, m.sender_id, m.channel, m.content, m.is_edited, m.is_pinned, m.pinned_by,
               m.reply_to_id, m.reply_preview, m.reactions_json,
               m.has_attachment, m.attachment_name, m.attachment_type, m.attachment_size,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.updated_at) as updated_at,
               p.username as sender_username, p.full_name as sender_name, p.role as sender_role,
               p.teacher_type as sender_teacher_type, p.class_name, p.division, p.roll_number, p.is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.channel IN (${placeholders})
          AND datetime(m.created_at) >= datetime('now', '-7 days')
          AND datetime(m.created_at) > datetime(?)
        ORDER BY m.created_at ASC, m.rowid ASC LIMIT 100
      `).bind(...matchChannels, since).all();
      messages = (results || []).map(sanitizeMessageRow);
    } else if (search) {
      const { results } = await env.DB.prepare(`
        SELECT m.id, m.sender_id, m.channel, m.content, m.is_edited, m.is_pinned, m.pinned_by,
               m.reply_to_id, m.reply_preview, m.reactions_json,
               m.has_attachment, m.attachment_name, m.attachment_type, m.attachment_size,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.updated_at) as updated_at,
               p.username as sender_username, p.full_name as sender_name, p.role as sender_role,
               p.teacher_type as sender_teacher_type, p.class_name, p.division, p.roll_number, p.is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.channel IN (${placeholders})
          AND datetime(m.created_at) >= datetime('now', '-7 days')
          AND (m.content LIKE ? OR p.full_name LIKE ? OR m.attachment_name LIKE ?)
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT 80
      `).bind(...matchChannels, `%${search}%`, `%${search}%`, `%${search}%`).all();
      messages = (results || []).reverse().map(sanitizeMessageRow);
    } else {
      const { results } = await env.DB.prepare(`
        SELECT m.id, m.sender_id, m.channel, m.content, m.is_edited, m.is_pinned, m.pinned_by,
               m.reply_to_id, m.reply_preview, m.reactions_json,
               m.has_attachment, m.attachment_name, m.attachment_type, m.attachment_size,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.updated_at) as updated_at,
               p.username as sender_username, p.full_name as sender_name, p.role as sender_role,
               p.teacher_type as sender_teacher_type, p.class_name, p.division, p.roll_number, p.is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.channel IN (${placeholders}) AND datetime(m.created_at) >= datetime('now', '-7 days')
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT 80
      `).bind(...matchChannels).all();
      messages = (results || []).reverse().map(sanitizeMessageRow);
    }

    const { results: pinnedMessages } = await env.DB.prepare(`
      SELECT m.id, m.content, m.sender_id, p.full_name as sender_name, p.role as sender_role,
             p.teacher_type as sender_teacher_type, p.is_root_admin,
             strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at
      FROM messages m
      JOIN profiles p ON m.sender_id = p.id
      WHERE m.channel IN (${placeholders})
        AND m.is_pinned = 1
        AND datetime(m.created_at) >= datetime('now', '-7 days')
      ORDER BY m.created_at DESC LIMIT 8
    `).bind(...matchChannels).all();

    return successResponse({ messages, pinnedMessages: pinnedMessages || [] });
  }

  // POST /api/chat/messages
  if (path === '/api/chat/messages' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const contentType = request.headers.get('content-type') || '';
      let content = '', channel = 'school', replyToId = null;
      let fileBuffer = null, fileName = null, fileType = null, fileSize = 0;

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        content = (formData.get('content') || '').toString().trim();
        channel = (formData.get('channel') || 'school').toString().trim();
        replyToId = (formData.get('replyToId') || '').toString().trim() || null;
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
        replyToId = (body.replyToId || '').toString().trim() || null;

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

      if (fileSize > 15 * 1024 * 1024) {
        return errorResponse('Chat file attachment exceeds the 15MB limit. For large textbooks, use Google Drive in the Notes section.', 400);
      }

      let targetUsers = null;
      if (channel.startsWith('dm_')) {
        const canonicalDmId = parseDmId(channel);
        const dm = await env.DB.prepare(
          `SELECT * FROM direct_chats WHERE id = ? OR id = ?`
        ).bind(canonicalDmId, canonicalDmId.replace('dm_', '')).first();

        if (!dm) return errorResponse('Direct chat conversation not found', 404);
        if (dm.user1_id !== auth.user.id && dm.user2_id !== auth.user.id) {
          return errorResponse('Access denied to private conversation', 403);
        }
        if (dm.status === 'pending') {
          return errorResponse('Cannot send message. Chat permission is pending authorization.', 403);
        }
        if (dm.status === 'rejected') {
          return errorResponse('Cannot send message. Chat invitation was declined.', 403);
        }

        channel = canonicalDmId;
        targetUsers = new Set([dm.user1_id, dm.user2_id]);
        await env.DB.prepare(`UPDATE direct_chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(dm.id).run();
      } else if (channel.startsWith('grp_')) {
        const grpId = channel.replace('grp_', '');
        const member = await env.DB.prepare(
          `SELECT user_id, invite_status FROM group_members WHERE group_id = ? AND user_id = ?`
        ).bind(grpId, auth.user.id).first();

        if (!member) {
          return errorResponse('You are not a member of this study group', 403);
        }
        if (member.invite_status !== 'accepted') {
          return errorResponse('Cannot send message. Please accept the group invitation first.', 403);
        }

        const { results: grpMembers } = await env.DB.prepare(
          `SELECT user_id FROM group_members WHERE group_id = ? AND invite_status = 'accepted'`
        ).bind(grpId).all();
        targetUsers = new Set((grpMembers || []).map(m => m.user_id));
      }

      if (content && !fileBuffer) {
        const dup = await env.DB.prepare(`
          SELECT id, created_at FROM messages
          WHERE sender_id = ? AND channel = ? AND content = ?
            AND datetime(created_at) >= datetime('now', '-2 seconds')
          ORDER BY created_at DESC LIMIT 1
        `).bind(auth.user.id, channel, content).first();

        if (dup) {
          return successResponse({
            id: dup.id,
            channel,
            content,
            created_at: dup.created_at,
            createdAt: dup.created_at,
            duplicateIgnored: true
          }, 'Message already delivered', 200);
        }
      }

      let replyPreviewObj = null;
      let replyPreviewJson = null;
      if (replyToId) {
        const parent = await env.DB.prepare(
          `SELECT m.id, m.content, m.channel, p.full_name as sender_name
           FROM messages m LEFT JOIN profiles p ON m.sender_id = p.id
           WHERE m.id = ?`
        ).bind(replyToId).first();
        if (parent && parent.channel === channel) {
          replyPreviewObj = {
            id: parent.id,
            senderName: parent.sender_name || 'User',
            content: String(parent.content || '').slice(0, 120),
          };
          replyPreviewJson = JSON.stringify(replyPreviewObj);
        } else {
          replyToId = null;
        }
      }

      const msgId = generateId('msg', 8);
      const hasAttachment = fileBuffer ? 1 : 0;
      const finalContent = content || (fileName ? `Shared attachment: ${fileName}` : '');

      await env.DB.prepare(`
        INSERT INTO messages (id, sender_id, channel, content, is_edited, reply_to_id, reply_preview, reactions_json, has_attachment, attachment_name, attachment_type, attachment_size)
        VALUES (?, ?, ?, ?, 0, ?, ?, '{}', ?, ?, ?, ?)
      `).bind(
        msgId,
        auth.user.id,
        channel,
        finalContent,
        replyToId,
        replyPreviewJson,
        hasAttachment,
        fileName || null,
        fileType || null,
        fileSize || 0
      ).run();

      if (fileBuffer) {
        try {
          const compressed = await compressData(fileBuffer);
          const compressedBytes = new Uint8Array(compressed);
          await env.DB.prepare(`
            INSERT INTO message_attachments (message_id, file_name, file_type, file_size, compressed_data)
            VALUES (?, ?, ?, ?, ?)
          `).bind(msgId, fileName, fileType, fileSize, compressedBytes).run();
        } catch (attErr) {
          await env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(msgId).run().catch(() => {});
          return errorResponse(`Attachment compression failed: ${attErr.message}`, 500);
        }
      }

      const isRoot = isRootAdminAccount(auth.user);
      const nowIso = new Date().toISOString();
      const responsePayload = {
        id: msgId,
        sender_id: auth.user.id,
        senderId: auth.user.id,
        sender_username: auth.user.username,
        sender_name: auth.user.fullName,
        senderName: auth.user.fullName,
        sender_role: auth.user.role,
        senderRole: auth.user.role,
        sender_teacher_type: auth.user.teacherType || null,
        senderTeacherType: auth.user.teacherType || null,
        class_name: isRoot ? '' : (auth.user.className || ''),
        className: isRoot ? '' : (auth.user.className || ''),
        division: isRoot ? '' : (auth.user.division || ''),
        roll_number: isRoot ? '' : (auth.user.rollNumber || ''),
        rollNumber: isRoot ? '' : (auth.user.rollNumber || ''),
        is_root_admin: isRoot ? 1 : 0,
        isRootAdmin: isRoot,
        channel,
        content: finalContent,
        is_edited: 0,
        isEdited: 0,
        is_pinned: 0,
        isPinned: false,
        reply_to_id: replyToId,
        replyPreview: replyPreviewObj,
        reactions: {},
        has_attachment: hasAttachment,
        hasAttachment,
        attachment_name: fileName || null,
        attachmentName: fileName || null,
        attachment_type: fileType || null,
        attachmentType: fileType || null,
        attachment_size: fileSize || 0,
        attachmentSize: fileSize || 0,
        created_at: nowIso,
        createdAt: nowIso,
      };

      broadcastChatMessage(responsePayload, targetUsers);
      return successResponse(responsePayload, 'Message sent', 201);
    } catch (err) {
      return errorResponse(`Chat send error: ${err.message}`, 500);
    }
  }

  // POST /api/chat/messages/:id/react - Toggle emoji reaction
  if (path.startsWith('/api/chat/messages/') && path.endsWith('/react') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const msgId = path.split('/')[4];
    const existing = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
    if (!existing) return errorResponse('Message not found', 404);

    const access = await verifyChannelReadAccess(env, existing.channel, auth.user);
    if (access.error) return access.error;

    try {
      const body = await request.json();
      const emoji = String(body.emoji || '').trim();
      if (!ALLOWED_REACTIONS.has(emoji)) {
        return errorResponse('Unsupported reaction emoji', 400);
      }

      let reactions = {};
      try {
        reactions = existing.reactions_json ? JSON.parse(existing.reactions_json) : {};
      } catch { reactions = {}; }

      const list = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
      const idx = list.indexOf(auth.user.id);
      if (idx === -1) {
        list.push(auth.user.id);
      } else {
        list.splice(idx, 1);
      }
      if (list.length > 0) {
        reactions[emoji] = list;
      } else {
        delete reactions[emoji];
      }

      await env.DB.prepare(
        `UPDATE messages SET reactions_json = ? WHERE id = ?`
      ).bind(JSON.stringify(reactions), msgId).run();

      const targetUsers = await getTargetUsersForChannel(env, existing.channel);
      broadcastChatEvent({
        type: 'message_reacted',
        channel: existing.channel,
        id: msgId,
        reactions,
      }, targetUsers);

      return successResponse({ id: msgId, reactions }, 'Reaction updated');
    } catch (err) {
      return errorResponse(`Reaction error: ${err.message}`, 500);
    }
  }

  // PUT /api/chat/messages/:id
  if (path.startsWith('/api/chat/messages/') && !path.includes('/attachments') && !path.endsWith('/pin') && !path.endsWith('/react') && method === 'PUT') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const msgId = path.split('/')[4];

    try {
      const body = await request.json();
      const { content } = body;

      if (!content || !content.trim()) {
        return errorResponse('Updated message content cannot be empty', 400);
      }

      const existing = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
      if (!existing) return errorResponse('Message not found', 404);

      if (existing.sender_id !== auth.user.id) {
        return errorResponse('Forbidden: You can only edit your own messages', 403);
      }

      const createdAt = parseUtcTimestamp(existing.created_at);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
      if (createdAt < sevenDaysAgo) {
        return errorResponse('Expired messages older than 7 days cannot be edited', 400);
      }

      const trimmed = content.trim();
      await env.DB.prepare(`
        UPDATE messages SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(trimmed, msgId).run();

      const targetUsers = await getTargetUsersForChannel(env, existing.channel);
      broadcastChatEvent({
        type: 'message_updated',
        channel: existing.channel,
        id: msgId,
        content: trimmed,
        isEdited: 1,
      }, targetUsers);

      return successResponse({ id: msgId, content: trimmed, isEdited: 1 }, 'Message updated successfully');
    } catch (err) {
      return errorResponse(`Message edit failed: ${err.message}`, 500);
    }
  }

  // POST /api/chat/messages/:id/pin - Pin/Unpin message (Admins, Scoped Teachers, Group Admins, or DM participants)
  if (path.startsWith('/api/chat/messages/') && path.endsWith('/pin') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const msgId = path.split('/')[4];
    const existing = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
    if (!existing) return errorResponse('Message not found', 404);

    if (existing.channel.startsWith('dm_')) {
      const access = await verifyChannelReadAccess(env, existing.channel, auth.user);
      if (access.error) return access.error;
    } else if (existing.channel.startsWith('grp_')) {
      const grpId = existing.channel.replace('grp_', '');
      const member = await env.DB.prepare(
        `SELECT role, invite_status FROM group_members WHERE group_id = ? AND user_id = ?`
      ).bind(grpId, auth.user.id).first();
      if (!member || member.invite_status !== 'accepted') {
        return errorResponse('Forbidden: You are not a member of this group', 403);
      }
      if (member.role !== 'admin' && auth.user.role !== 'teacher' && auth.user.role !== 'admin') {
        return errorResponse('Forbidden: Only group admins or faculty can pin group messages', 403);
      }
    } else {
      const allowed = auth.user.role === 'admin' || canTeacherModerateChannel(auth.user, existing.channel);
      if (!allowed) {
        return errorResponse('Forbidden: Only Admins or Teachers assigned to this channel can pin messages here', 403);
      }
    }

    const nextPinned = existing.is_pinned === 1 ? 0 : 1;
    await env.DB.prepare(
      `UPDATE messages SET is_pinned = ?, pinned_by = ? WHERE id = ?`
    ).bind(nextPinned, nextPinned === 1 ? auth.user.id : null, msgId).run();

    const targetUsers = await getTargetUsersForChannel(env, existing.channel);
    broadcastChatEvent({
      type: 'message_pinned',
      channel: existing.channel,
      id: msgId,
      isPinned: nextPinned === 1,
    }, targetUsers);

    return successResponse({ id: msgId, isPinned: nextPinned === 1 }, nextPinned === 1 ? 'Message pinned!' : 'Message unpinned');
  }

  // DELETE /api/chat/messages/:id
  if (path.startsWith('/api/chat/messages/') && !path.includes('/attachments') && !path.endsWith('/pin') && !path.endsWith('/react') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const msgId = path.split('/')[4];

    try {
      const existing = await env.DB.prepare(`
        SELECT m.*, p.username as sender_username, p.role as sender_role, p.is_root_admin as sender_is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.id = ?
      `).bind(msgId).first();
      if (!existing) return errorResponse('Message not found', 404);

      const isSelf = existing.sender_id === auth.user.id;
      const isViewerRoot = auth.user.isRootAdmin || auth.user.username === 'admin';
      const isViewerAdmin = auth.user.role === 'admin';
      const isSenderRoot = existing.sender_is_root_admin === 1 || existing.sender_username === 'admin';
      const isSenderAdmin = isSenderRoot || existing.sender_role === 'admin';

      // Personal 1-on-1 DMs are strictly private: even Lead Admin cannot moderate someone else's DM
      if (existing.channel.startsWith('dm_')) {
        if (!isSelf) {
          return errorResponse('Forbidden: Personal direct messages are strictly private', 403);
        }
      } else if (existing.channel.startsWith('grp_')) {
        const grpId = existing.channel.replace('grp_', '');
        const member = await env.DB.prepare(
          `SELECT role, invite_status FROM group_members WHERE group_id = ? AND user_id = ?`
        ).bind(grpId, auth.user.id).first();

        if (!member || member.invite_status !== 'accepted') {
          return errorResponse('Forbidden: Study group conversations are private to members', 403);
        }

        const isGroupModerator = member.role === 'admin' || isViewerAdmin;
        if (!isSelf) {
          if (!isGroupModerator) {
            return errorResponse('Forbidden: You can only delete your own messages', 403);
          }
          if (isSenderRoot && !isViewerRoot) {
            return errorResponse('Forbidden: Secondary Admins cannot delete Lead Root Admin messages', 403);
          }
        }
      } else {
        // Public school / class / subject channels
        if (!isSelf) {
          const canTeacherMod = canTeacherModerateChannel(auth.user, existing.channel);
          if (!isViewerAdmin && !canTeacherMod) {
            return errorResponse('Forbidden: You can only delete your own messages', 403);
          }
          if (isSenderRoot && !isViewerRoot) {
            return errorResponse('Forbidden: Secondary Admins cannot delete Lead Root Admin messages', 403);
          }
          if (!isViewerAdmin && isSenderAdmin) {
            return errorResponse('Forbidden: Teachers cannot delete Administrator messages', 403);
          }
        }
      }

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM message_attachments WHERE message_id = ?`).bind(msgId),
        env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(msgId)
      ]);

      const targetUsers = await getTargetUsersForChannel(env, existing.channel);
      broadcastChatEvent({
        type: 'message_deleted',
        channel: existing.channel,
        id: msgId,
      }, targetUsers);

      return successResponse({ id: msgId }, 'Message deleted successfully');
    } catch (err) {
      return errorResponse(`Message deletion failed: ${err.message}`, 500);
    }
  }

  // GET /api/chat/attachments/:messageId - On-Demand Lazy Download
  if (path.startsWith('/api/chat/attachments/') && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const msgId = path.split('/')[4];
    const msg = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(msgId).first();
    if (!msg) return errorResponse('Attachment message not found or expired', 404);

    if (msg.channel.startsWith('dm_') || msg.channel.startsWith('grp_')) {
      const access = await verifyChannelReadAccess(env, msg.channel, auth.user);
      if (access.error) return access.error;
    }

    const attachment = await env.DB.prepare(`SELECT * FROM message_attachments WHERE message_id = ?`).bind(msgId).first();
    if (!attachment) return errorResponse('File attachment not found or already purged', 404);

    try {
      const u8 = toUint8Array(attachment.compressed_data);
      const isGzip = u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b;
      const outputBuffer = isGzip ? await decompressData(u8.buffer) : u8.buffer;

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

  return null;
}
