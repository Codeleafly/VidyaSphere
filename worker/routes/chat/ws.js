/**
 * Chat WebSocket Upgrade & Edge Broadcaster
 */

import { errorResponse } from '../../utils/response.js';

const activeSockets = new Map(); // ws -> session

/**
 * Broadcast a chat message to connected edge WebSocket subscribers.
 * When targetUsers is provided (DM or Study Group), restricts delivery to authorized participants.
 */
export function broadcastChatMessage(messagePayload, targetUsers = null) {
  const payloadStr = JSON.stringify({
    type: 'new_message',
    message: messagePayload
  });

  for (const [ws, userSession] of activeSockets.entries()) {
    try {
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
    `SELECT s.user_id, p.username, p.full_name, p.role, p.class_name, p.division, p.roll_number, p.is_root_admin
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

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ping') {
        server.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
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
