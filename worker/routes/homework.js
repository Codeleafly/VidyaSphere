/**
 * Phase 6: Lightweight Daily Homework Feed
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { validateHttpUrl } from '../utils/compression.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleHomeworkRoutes(request, env, path, method) {
  // GET /api/homework - List homework filtered by className, subject, search, teacherId
  if (path === '/api/homework' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const className = (url.searchParams.get('className') || '').trim();
    const subject = (url.searchParams.get('subject') || '').trim();
    const search = (url.searchParams.get('search') || '').trim();
    const teacherId = (url.searchParams.get('teacherId') || '').trim();

    let query = `
      SELECT h.*, p.full_name as teacher_name, p.role as teacher_role, p.teacher_type, p.is_root_admin as teacher_is_root_admin
      FROM homework h
      LEFT JOIN profiles p ON h.teacher_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (className && className !== 'all' && className !== 'All Classes') {
      query += ` AND h.class_name = ?`;
      params.push(className);
    }
    if (subject) {
      query += ` AND h.subject = ?`;
      params.push(subject);
    }
    if (teacherId) {
      query += ` AND h.teacher_id = ?`;
      params.push(teacherId);
    }
    if (search) {
      query += ` AND (h.title LIKE ? OR h.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY (CASE WHEN h.due_date IS NULL OR h.due_date = '' THEN 1 ELSE 0 END), h.due_date ASC, h.created_at DESC LIMIT 100`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ homework: results || [] });
  }

  // POST /api/homework - Teacher or Admin publishes homework
  if (path === '/api/homework' && method === 'POST') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { title, description, className, subject, dueDate = '', resourceUrl = '' } = body;

      if (!title || !description || !className || !subject) {
        return errorResponse('Title, description, className, and subject are required', 400);
      }

      const urlCheck = validateHttpUrl(resourceUrl);
      if (urlCheck && urlCheck.error) {
        return errorResponse(`Invalid Resource URL: ${urlCheck.error}`, 400);
      }

      const id = generateId('hwk', 8);
      await env.DB.prepare(
        `INSERT INTO homework (id, teacher_id, title, description, class_name, subject, due_date, resource_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        auth.user.id,
        title.trim(),
        description.trim(),
        className.trim(),
        subject.trim(),
        String(dueDate || '').trim() || null,
        urlCheck ? urlCheck.url : null
      ).run();

      return successResponse({ id }, 'Homework posted!', 201);
    } catch (err) {
      return errorResponse(`Homework creation failed: ${err.message}`, 500);
    }
  }

  // PUT /api/homework/:id
  if (path.startsWith('/api/homework/') && method === 'PUT') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const id = path.replace('/api/homework/', '').trim();
    const existing = await env.DB.prepare(`SELECT * FROM homework WHERE id = ?`).bind(id).first();
    if (!existing) return errorResponse('Homework item not found', 404);

    if (existing.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only edit your own homework posts', 403);
    }

    try {
      const body = await request.json();
      const urlCheck = validateHttpUrl(body.resourceUrl !== undefined ? body.resourceUrl : (existing.resource_url || ''));
      if (urlCheck && urlCheck.error) return errorResponse(`Invalid Resource URL: ${urlCheck.error}`, 400);

      await env.DB.prepare(
        `UPDATE homework SET title = ?, description = ?, class_name = ?, subject = ?, due_date = ?, resource_url = ? WHERE id = ?`
      ).bind(
        String(body.title ?? existing.title).trim(),
        String(body.description ?? existing.description).trim(),
        String(body.className ?? existing.class_name).trim(),
        String(body.subject ?? existing.subject).trim(),
        String(body.dueDate !== undefined ? body.dueDate : (existing.due_date || '')).trim() || null,
        urlCheck ? urlCheck.url : null,
        id
      ).run();

      return successResponse({ id }, 'Homework updated successfully');
    } catch (err) {
      return errorResponse(`Homework update failed: ${err.message}`, 500);
    }
  }

  // DELETE /api/homework/:id
  if (path.startsWith('/api/homework/') && method === 'DELETE') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const id = path.replace('/api/homework/', '').trim();
    const existing = await env.DB.prepare(`SELECT * FROM homework WHERE id = ?`).bind(id).first();
    if (!existing) return errorResponse('Homework item not found', 404);

    if (existing.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only delete your own homework posts', 403);
    }

    await env.DB.prepare(`DELETE FROM homework WHERE id = ?`).bind(id).run();
    return successResponse({ id }, 'Homework deleted successfully');
  }

  return errorResponse('Homework route not found', 404);
}
