/**
 * Phase 4: Realtime Student-to-Student Chat Router
 * Modular entrypoint delegating to WebSocket, Direct Messages, Study Groups, and Messages handlers.
 */

import { errorResponse } from '../utils/response.js';
import { handleChatWebSocket } from './chat/ws.js';
import { handleDmRoutes } from './chat/dms.js';
import { handleGroupRoutes } from './chat/groups.js';
import { handleMessageRoutes } from './chat/messages.js';

export async function handleChatRoutes(request, env, path, method) {
  if (path === '/api/chat/ws') {
    return await handleChatWebSocket(request, env);
  }

  if (path.startsWith('/api/chat/dms')) {
    const res = await handleDmRoutes(request, env, path, method);
    if (res) return res;
  }

  if (path.startsWith('/api/chat/groups')) {
    const res = await handleGroupRoutes(request, env, path, method);
    if (res) return res;
  }

  if (path.startsWith('/api/chat/messages') || path.startsWith('/api/chat/attachments/')) {
    const res = await handleMessageRoutes(request, env, path, method);
    if (res) return res;
  }

  return errorResponse('Chat route not found', 404);
}
