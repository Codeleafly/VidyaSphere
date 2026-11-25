/**
 * Announcements / Official School Notice Board
 * Notices automatically expire after 30 days (1 month) and can be deleted manually by Lead or Secondary Admins.
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

const THIRTY_DAYS_MS = 30 * 24 * 3600 * 1000;

export async function handleAnnouncementRoutes(request, env, path, method) {
  // GET /api/announcements - Fetch active (non-expired) school notices
  if (path === '/api/announcements' && method === 'GET') {
    const url = new URL(request.url);
    const targetClass = url.searchParams.get('class');

    let query = `
      SELECT a.*,
             strftime('%Y-%m-%dT%H:%M:%SZ', a.created_at) as created_at,
             COALESCE(strftime('%Y-%m-%dT%H:%M:%SZ', a.expires_at), strftime('%Y-%m-%dT%H:%M:%SZ', datetime(a.created_at, '+30 days'))) as expires_at,
             p.full_name as author_name,
             p.role as author_role,
             p.is_root_admin as author_is_root_admin
      FROM announcements a
      LEFT JOIN profiles p ON a.author_id = p.id
      WHERE ((a.expires_at IS NOT NULL AND datetime(a.expires_at) > datetime('now'))
             OR (a.expires_at IS NULL AND datetime(a.created_at) >= datetime('now', '-30 days')))
    `;
    const params = [];

    if (targetClass) {
      query += ` AND (a.target_class = 'all' OR a.target_class = ?)`;
      params.push(targetClass);
    }

    query += ` ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 50`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ announcements: results || [] });
  }

  // POST /api/admin/announcements - Create new announcement (Lead Admin, Secondary Admin, or Teacher)
  if (path === '/api/admin/announcements' && method === 'POST') {
    const auth = await authenticate(request, env, ['admin', 'teacher']);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { title, content, priority = 'general', targetClass = 'all', isPinned = false } = body;

      if (!title || !content) {
        return errorResponse('Announcement title and content are required');
      }

      const id = generateId('ann', 8);
      const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO announcements (id, title, content, priority, target_class, author_id, is_pinned, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, title.trim(), content.trim(), priority, targetClass, auth.user.id, isPinned ? 1 : 0, expiresAt),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'ANNOUNCEMENT_CREATED', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Published notice "${title.trim()}" (auto-expires ${expiresAt})`),
      ]);

      return successResponse({ id, expiresAt }, 'Announcement published (auto-deletes after 30 days)', 201);
    } catch (err) {
      return errorResponse(`Announcement creation error: ${err.message}`, 500);
    }
  }

  // DELETE /api/admin/announcements/:id - Both Lead Admin and Secondary Admin can delete notices
  if (path.startsWith('/api/admin/announcements/') && method === 'DELETE') {
    const auth = await authenticate(request, env, ['admin', 'teacher']);
    if (auth.error) return auth.error;

    const id = path.replace('/api/admin/announcements/', '').trim();
    if (!id) return errorResponse('Announcement ID is required', 400);

    const existing = await env.DB.prepare(`SELECT id, title FROM announcements WHERE id = ?`).bind(id).first();
    if (!existing) return errorResponse('Announcement not found', 404);

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM announcements WHERE id = ?`).bind(id),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, action, actor_id, details)
         VALUES (?, 'ANNOUNCEMENT_DELETED', ?, ?)`
      ).bind(generateId('log', 8), auth.user.id, `Deleted notice "${existing.title}" (${id})`),
    ]);

    return successResponse({ id }, 'Announcement deleted successfully');
  }

  return errorResponse('Announcement route not found', 404);
}
