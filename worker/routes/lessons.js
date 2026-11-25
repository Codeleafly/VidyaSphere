/**
 * Phase 6: Chapter-Wise Lessons (Zero-Storage YouTube Unlisted + Drive PDF + Summary)
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { validateHttpUrl } from '../utils/compression.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleLessonsRoutes(request, env, path, method) {
  // GET /api/lessons - List lessons filtered by className, subject, search, or teacherId
  if (path === '/api/lessons' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const className = (url.searchParams.get('className') || '').trim();
    const subject = (url.searchParams.get('subject') || '').trim();
    const search = (url.searchParams.get('search') || '').trim();
    const teacherId = (url.searchParams.get('teacherId') || '').trim();

    let query = `
      SELECT l.*, p.full_name as teacher_name, p.role as teacher_role, p.teacher_type
      FROM lessons l
      LEFT JOIN profiles p ON l.teacher_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (className && className !== 'all' && className !== 'All Classes') {
      query += ` AND l.class_name = ?`;
      params.push(className);
    }
    if (subject) {
      query += ` AND l.subject = ?`;
      params.push(subject);
    }
    if (teacherId) {
      query += ` AND l.teacher_id = ?`;
      params.push(teacherId);
    }
    if (search) {
      query += ` AND (l.title LIKE ? OR l.chapter LIKE ? OR l.summary LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY l.created_at DESC LIMIT 100`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ lessons: results || [] });
  }

  // POST /api/lessons - Teachers & Admins create a chapter lesson
  if (path === '/api/lessons' && method === 'POST') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { title, className, subject, chapter = '', summary = '', videoUrl = '', resourceUrl = '' } = body;

      if (!title || !className || !subject) {
        return errorResponse('Lesson title, className, and subject are required', 400);
      }

      const videoCheck = validateHttpUrl(videoUrl);
      if (videoCheck && videoCheck.error) {
        return errorResponse(`Invalid Video URL: ${videoCheck.error}`, 400);
      }
      const resCheck = validateHttpUrl(resourceUrl);
      if (resCheck && resCheck.error) {
        return errorResponse(`Invalid Resource URL: ${resCheck.error}`, 400);
      }

      const yearRow = await env.DB.prepare(`SELECT value FROM school_settings WHERE key = 'academic_year'`).first().catch(() => null);
      const academicYear = yearRow?.value || '2026-2027';
      const id = generateId('les', 8);

      await env.DB.prepare(
        `INSERT INTO lessons (id, teacher_id, title, class_name, subject, chapter, summary, video_url, resource_url, academic_year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        auth.user.id,
        title.trim(),
        className.trim(),
        subject.trim(),
        String(chapter || '').trim(),
        String(summary || '').trim(),
        videoCheck ? videoCheck.url : null,
        resCheck ? resCheck.url : null,
        academicYear
      ).run();

      return successResponse({ id }, 'Chapter lesson published!', 201);
    } catch (err) {
      return errorResponse(`Lesson creation failed: ${err.message}`, 500);
    }
  }

  // PUT /api/lessons/:id - Author teacher or admin edits lesson
  if (path.startsWith('/api/lessons/') && method === 'PUT') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const id = path.replace('/api/lessons/', '').trim();
    const existing = await env.DB.prepare(`SELECT * FROM lessons WHERE id = ?`).bind(id).first();
    if (!existing) return errorResponse('Lesson not found', 404);

    if (existing.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only edit your own lessons', 403);
    }

    try {
      const body = await request.json();
      const {
        title = existing.title,
        className = existing.class_name,
        subject = existing.subject,
        chapter = existing.chapter,
        summary = existing.summary,
        videoUrl = existing.video_url || '',
        resourceUrl = existing.resource_url || ''
      } = body;

      const videoCheck = validateHttpUrl(videoUrl);
      if (videoCheck && videoCheck.error) return errorResponse(`Invalid Video URL: ${videoCheck.error}`, 400);
      const resCheck = validateHttpUrl(resourceUrl);
      if (resCheck && resCheck.error) return errorResponse(`Invalid Resource URL: ${resCheck.error}`, 400);

      await env.DB.prepare(
        `UPDATE lessons
         SET title = ?, class_name = ?, subject = ?, chapter = ?, summary = ?, video_url = ?, resource_url = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(
        String(title).trim(),
        String(className).trim(),
        String(subject).trim(),
        String(chapter || '').trim(),
        String(summary || '').trim(),
        videoCheck ? videoCheck.url : null,
        resCheck ? resCheck.url : null,
        id
      ).run();

      return successResponse({ id }, 'Lesson updated successfully');
    } catch (err) {
      return errorResponse(`Lesson update failed: ${err.message}`, 500);
    }
  }

  // DELETE /api/lessons/:id
  if (path.startsWith('/api/lessons/') && method === 'DELETE') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const id = path.replace('/api/lessons/', '').trim();
    const existing = await env.DB.prepare(`SELECT * FROM lessons WHERE id = ?`).bind(id).first();
    if (!existing) return errorResponse('Lesson not found', 404);

    if (existing.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only delete your own lessons', 403);
    }

    await env.DB.prepare(`DELETE FROM lessons WHERE id = ?`).bind(id).run();
    return successResponse({ id }, 'Lesson deleted successfully');
  }

  return errorResponse('Lessons route not found', 404);
}
