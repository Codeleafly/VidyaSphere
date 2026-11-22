/**
 * Announcements / Official School Notice Board
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleAnnouncementRoutes(request, env, path, method) {
  // GET /api/announcements - Fetch school notices with priority sorting
  if (path === '/api/announcements' && method === 'GET') {
    const url = new URL(request.url);
    const targetClass = url.searchParams.get('class');

    let query = `
      SELECT a.*, p.full_name as author_name
      FROM announcements a
      LEFT JOIN profiles p ON a.author_id = p.id
    `;
    const params = [];

    if (targetClass) {
      query += ` WHERE a.target_class = 'all' OR a.target_class = ?`;
      params.push(targetClass);
    }

    query += ` ORDER BY a.is_pinned DESC, a.created_at DESC LIMIT 50`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ announcements: results || [] });
  }

  // POST /api/admin/announcements - Create new announcement (Admin or Teacher)
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

      await env.DB.prepare(
        `INSERT INTO announcements (id, title, content, priority, target_class, author_id, is_pinned)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(id, title.trim(), content.trim(), priority, targetClass, auth.user.id, isPinned ? 1 : 0)
        .run();

      return successResponse({ id }, 'Announcement published successfully', 201);
    } catch (err) {
      return errorResponse(`Announcement creation error: ${err.message}`, 500);
    }
  }

  // DELETE /api/admin/announcements/:id
  if (path.startsWith('/api/admin/announcements/') && method === 'DELETE') {
    const auth = await authenticate(request, env, ['admin', 'teacher']);
    if (auth.error) return auth.error;

    const id = path.replace('/api/admin/announcements/', '');
    await env.DB.prepare(`DELETE FROM announcements WHERE id = ?`).bind(id).run();

    return successResponse({}, 'Announcement deleted');
  }

  return errorResponse('Announcement route not found', 404);
}
