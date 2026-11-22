/**
 * Authentication & Authorization Middleware for VidyaSphere
 * Uses High-Entropy Random Tokens verified strictly against Database
 */

import { errorResponse } from '../utils/response.js';

export async function authenticate(request, env, allowedRoles = []) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { error: errorResponse('Missing or invalid Authorization header', 401) };
  }

  const token = authHeader.substring(7).trim();
  if (!token || token.length < 16) {
    return { error: errorResponse('Invalid session token format', 401) };
  }

  // Verify session token directly against Database
  const sessionRow = await env.DB.prepare(
    `SELECT s.token, s.user_id, s.expires_at, p.username, p.full_name, p.role, p.account_status, p.class_name, p.division
     FROM sessions s
     JOIN profiles p ON s.user_id = p.id
     WHERE s.token = ?`
  ).bind(token).first();

  if (!sessionRow) {
    return { error: errorResponse('Invalid or expired authentication session', 401) };
  }

  // Check expiration
  if (new Date(sessionRow.expires_at) < new Date()) {
    // Delete expired session
    await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    return { error: errorResponse('Session has expired. Please log in again.', 401) };
  }

  // Check if account was suspended
  if (sessionRow.account_status !== 'active') {
    return { error: errorResponse(`Account is ${sessionRow.account_status}. Access denied.`, 403) };
  }

  // Strict role verification directly from database record
  if (allowedRoles.length > 0 && !allowedRoles.includes(sessionRow.role)) {
    return { error: errorResponse('Forbidden: Insufficient privileges. Access restricted to authorized personnel only.', 403) };
  }

  return {
    user: {
      id: sessionRow.user_id,
      username: sessionRow.username,
      fullName: sessionRow.full_name,
      role: sessionRow.role,
      className: sessionRow.class_name,
      division: sessionRow.division,
      token: sessionRow.token,
    }
  };
}
