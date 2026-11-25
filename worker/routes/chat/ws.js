/**
 * Chat WebSocket Upgrade, Presence & Edge Broadcaster
 */

import { errorResponse } from '../../utils/response.js';

const activeSockets = new Map(); // ws -> session

/**
 * Broadcast an arbitrary real-time event (message_updated, message_deleted, message_pinned, message_reacted, typing, etc.)
 * When targetUsers is provided (DM or Study Group), restricts delivery to authorized participants.
 */
export function broadcastChatEvent(eventPayload, targetUsers = null, excludeUserId = null) {
  const payloadStr = JSON.stringify(eventPayload);

  for (const [ws, userSession] of activeSockets.entries()) {
    try {
      if (excludeUserId && userSession.user_id === excludeUserId) continue;
      if (targetUsers) {
        if (targetUsers.has(userSession.user_id)) {
          ws.send(payloadStr);
        }
      } else {
        ws.send(payloadStr);
      }
    } catch {
      activeSockets.delete(ws);
    }
  }
}

/**
 * Broadcast a new chat message to connected edge WebSocket subscribers.
 */
export function broadcastChatMessage(messagePayload, targetUsers = null) {
  broadcastChatEvent({ type: 'new_message', message: messagePayload }, targetUsers);
}

/**
 * Handle GET /api/chat/ws WebSocket connection upgrade.
 */
export async function handleChatWebSocket(request, env) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return errorResponse('Expected WebSocket Upgrade request', 426);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return errorResponse('Authentication token required for WebSocket connection', 401);
  }

  const session = await env.DB.prepare(
    `SELECT s.user_id, p.username, p.full_name, p.role, p.teacher_type, p.class_name, p.division, p.roll_number, p.is_root_admin
     FROM sessions s
     JOIN profiles p ON s.user_id = p.id
     WHERE s.token = ?
       AND datetime(s.expires_at) > datetime('now')
       AND p.account_status = 'active'`
  ).bind(token).first();

  if (!session) {
    return errorResponse('Unauthorized WebSocket session', 401);
  }

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();
  activeSockets.set(server, session);

  try {
    server.send(JSON.stringify({ type: 'presence', onlineCount: activeSockets.size }));
  } catch { /* ignore */ }

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        server.send(JSON.stringify({ type: 'pong', timestamp: Date.now(), onlineCount: activeSockets.size }));
        return;
      }

      if (data.type === 'typing' && data.channel) {
        const channel = String(data.channel);
        // Only relay typing on public channels to avoid leaking private channel presence across arbitrary clients
        if (!channel.startsWith('dm_') && !channel.startsWith('grp_')) {
          broadcastChatEvent({
            type: 'typing',
            channel,
            userId: session.user_id,
            fullName: session.full_name,
            isTyping: Boolean(data.isTyping),
          }, null, session.user_id);
        }
      }
    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

  server.addEventListener('close', () => activeSockets.delete(server));
  server.addEventListener('error', () => activeSockets.delete(server));

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}
