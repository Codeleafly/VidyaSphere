/**
 * Phase 4: Realtime School & Class Chat
 * Native WebSockets with fallback REST messaging
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

// In-memory active WebSocket connections map for Edge runtime broadcasting
const activeSockets = new Set();

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
      `SELECT s.user_id, p.username, p.full_name, p.role, p.class_name, p.division
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
    activeSockets.add(server);

    server.addEventListener('message', async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message' && data.content?.trim()) {
          const msgId = generateId('msg', 8);
          const channel = data.channel || 'school';
          const content = data.content.trim();

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
              channel,
              content,
              createdAt: new Date().toISOString(),
            }
          });

          // Broadcast to all active connected sockets
          for (const ws of activeSockets) {
            try {
              ws.send(broadcastPayload);
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

  // GET /api/chat/messages - Fetch recent messages for a channel
  if (path === '/api/chat/messages' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const channel = url.searchParams.get('channel') || 'school';

    const { results } = await env.DB.prepare(
      `SELECT m.*, p.full_name as sender_name, p.role as sender_role, p.class_name
       FROM messages m
       JOIN profiles p ON m.sender_id = p.id
       WHERE m.channel = ?
       ORDER BY m.created_at DESC LIMIT 50`
    ).bind(channel).all();

    const messages = (results || []).reverse();
    return successResponse({ messages });
  }

  // POST /api/chat/messages - Send message via REST (fallback)
  if (path === '/api/chat/messages' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { content, channel = 'school' } = body;

      if (!content || !content.trim()) {
        return errorResponse('Message content cannot be empty');
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
