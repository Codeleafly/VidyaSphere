/**
 * Chat Messages & Lossless Gzip Attachments Routes
 */

import { errorResponse, successResponse, corsHeaders } from '../../utils/response.js';
import { compressData, decompressData, toUint8Array, parseUtcTimestamp } from '../../utils/compression.js';
import { generateId } from '../../auth/crypto.js';
import { authenticate } from '../../auth/middleware.js';
import { parseDmId } from './dms.js';
import { broadcastChatMessage } from './ws.js';

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
      return { error: errorResponse('Chat permission pending. Awaiting student acceptance.', 403) };
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

    const access = await verifyChannelReadAccess(env, channel, auth.user);
    if (access.error) return access.error;

    const matchChannels = access.matchChannels;
    const since = url.searchParams.get('since');
    const placeholders = matchChannels.map(() => '?').join(',');

    let messages = [];
    if (since) {
      const { results } = await env.DB.prepare(`
        SELECT m.id, m.sender_id, m.channel, m.content, m.is_edited, m.has_attachment,
               m.attachment_name, m.attachment_type, m.attachment_size,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.updated_at) as updated_at,
               p.full_name as sender_name, p.role as sender_role, p.class_name, p.division, p.roll_number, p.is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.channel IN (${placeholders})
          AND datetime(m.created_at) >= datetime('now', '-7 days')
          AND datetime(m.created_at) > datetime(?)
        ORDER BY m.created_at ASC, m.rowid ASC LIMIT 100
      `).bind(...matchChannels, since).all();
      messages = results || [];
    } else {
      const { results } = await env.DB.prepare(`
        SELECT m.id, m.sender_id, m.channel, m.content, m.is_edited, m.has_attachment,
               m.attachment_name, m.attachment_type, m.attachment_size,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.created_at) as created_at,
               strftime('%Y-%m-%dT%H:%M:%SZ', m.updated_at) as updated_at,
               p.full_name as sender_name, p.role as sender_role, p.class_name, p.division, p.roll_number, p.is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.channel IN (${placeholders}) AND datetime(m.created_at) >= datetime('now', '-7 days')
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT 80
      `).bind(...matchChannels).all();
      messages = (results || []).reverse();
    }

    return successResponse({ messages });
  }

  // POST /api/chat/messages
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
          return errorResponse('Cannot send message. Chat permission is pending authorization by the student.', 403);
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

      const msgId = generateId('msg', 8);
      const hasAttachment = fileBuffer ? 1 : 0;
      const finalContent = content || (fileName ? `Shared attachment: ${fileName}` : '');

      await env.DB.prepare(`
        INSERT INTO messages (id, sender_id, channel, content, is_edited, has_attachment, attachment_name, attachment_type, attachment_size)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)
      `).bind(
        msgId,
        auth.user.id,
        channel,
        finalContent,
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

      const nowIso = new Date().toISOString();
      const responsePayload = {
        id: msgId,
        sender_id: auth.user.id,
        senderId: auth.user.id,
        sender_name: auth.user.fullName,
        senderName: auth.user.fullName,
        sender_role: auth.user.role,
        senderRole: auth.user.role,
        class_name: auth.user.className || null,
        className: auth.user.className || null,
        division: auth.user.division || null,
        roll_number: auth.user.rollNumber || null,
        rollNumber: auth.user.rollNumber || null,
        is_root_admin: auth.user.isRootAdmin ? 1 : 0,
        isRootAdmin: auth.user.isRootAdmin || false,
        channel,
        content: finalContent,
        is_edited: 0,
        isEdited: 0,
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

  // PUT /api/chat/messages/:id
  if (path.startsWith('/api/chat/messages/') && !path.includes('/attachments') && method === 'PUT') {
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

      await env.DB.prepare(`
        UPDATE messages SET content = ?, is_edited = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(content.trim(), msgId).run();

      return successResponse({ id: msgId, content: content.trim(), isEdited: 1 }, 'Message updated successfully');
    } catch (err) {
      return errorResponse(`Message edit failed: ${err.message}`, 500);
    }
  }

  // DELETE /api/chat/messages/:id
  if (path.startsWith('/api/chat/messages/') && !path.includes('/attachments') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const msgId = path.split('/')[4];

    try {
      const existing = await env.DB.prepare(`
        SELECT m.*, p.username as sender_username, p.is_root_admin as sender_is_root_admin
        FROM messages m
        JOIN profiles p ON m.sender_id = p.id
        WHERE m.id = ?
      `).bind(msgId).first();
      if (!existing) return errorResponse('Message not found', 404);

      const isSelf = existing.sender_id === auth.user.id;
      const isViewerRoot = auth.user.isRootAdmin || auth.user.username === 'admin';
      const isViewerAdmin = auth.user.role === 'admin';
      const isSenderRoot = existing.sender_is_root_admin === 1 || existing.sender_username === 'admin';

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
          if (!isViewerAdmin) {
            return errorResponse('Forbidden: You can only delete your own messages', 403);
          }
          if (isSenderRoot && !isViewerRoot) {
            return errorResponse('Forbidden: Secondary Admins cannot delete Lead Root Admin messages', 403);
          }
        }
      }

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM message_attachments WHERE message_id = ?`).bind(msgId),
        env.DB.prepare(`DELETE FROM messages WHERE id = ?`).bind(msgId)
      ]);

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
