/**
 * VidyaSphere Examination Schedules & Timetables Route Handler
 * Zero npm dependencies, 100% native Web Standards.
 * 
 * Rules:
 * 1. READ (GET /api/exams): All authenticated students and public visitors can view exams.
 * 2. WRITE (POST, PUT, DELETE /api/admin/exams): Strictly restricted to ADMIN role.
 *    Any unauthorized attempt returns 403 Forbidden.
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleExamsRoutes(request, env, path, method) {
  // GET /api/exams - Fetch exam timetable
  if (path === '/api/exams' && method === 'GET') {
    const url = new URL(request.url);
    const targetClass = url.searchParams.get('class');
    const academicYear = url.searchParams.get('academic_year') || '2026-2027';

    let query = `
      SELECT e.*, p.full_name as author_name
      FROM exams e
      LEFT JOIN profiles p ON e.created_by = p.id
      WHERE e.academic_year = ?
    `;
    const params = [academicYear];

    if (targetClass && targetClass !== 'all' && targetClass !== 'All Classes') {
      query += ` AND (e.class_name = 'all' OR e.class_name = 'All Classes' OR e.class_name = ?)`;
      params.push(targetClass);
    }

    query += ` ORDER BY e.exam_date ASC, e.start_time ASC LIMIT 100`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ exams: results || [] });
  }

  // POST /api/admin/exams - Schedule / Announce New Exam (Admin ONLY)
  if (path === '/api/admin/exams' && method === 'POST') {
    const auth = await authenticate(request, env, ['admin']);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const {
        title,
        className = 'All Classes',
        subject,
        examDate,
        startTime = '',
        endTime = '',
        roomOrHall = '',
        syllabus = '',
        driveLink = '',
        broadcastNotice = false
      } = body;

      if (!title || !subject || !examDate) {
        return errorResponse('Exam title, subject, and date (YYYY-MM-DD) are required', 400);
      }

      // Fetch active academic year
      const yearSetting = await env.DB.prepare(`SELECT value FROM school_settings WHERE key = 'academic_year'`).first();
      const academicYear = yearSetting?.value || '2026-2027';

      const examId = generateId('exm', 8);

      await env.DB.prepare(`
        INSERT INTO exams (id, title, class_name, subject, exam_date, start_time, end_time, room_or_hall, syllabus, drive_link, academic_year, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        examId,
        title.trim(),
        className.trim(),
        subject.trim(),
        examDate.trim(),
        startTime.trim(),
        endTime.trim(),
        roomOrHall.trim(),
        syllabus.trim(),
        driveLink ? driveLink.trim() : null,
        academicYear,
        auth.user.id
      ).run();

      // Log in audit log
      await env.DB.prepare(`
        INSERT INTO audit_logs (id, action, actor_id, details)
        VALUES (?, 'EXAM_SCHEDULED', ?, ?)
      `).bind(generateId('log', 8), auth.user.id, `Scheduled ${title} for ${className} on ${examDate}`).run();

      // Optionally broadcast notice to school notice board
      if (broadcastNotice) {
        const annId = generateId('ann', 8);
        const annContent = `Official Exam Scheduled: ${title} (${subject}) on ${examDate}${startTime ? ' at ' + startTime : ''}.${roomOrHall ? ' Room/Hall: ' + roomOrHall : ''}\nCheck the Exam Timetable for complete syllabus and guidelines.`;
        await env.DB.prepare(`
          INSERT INTO announcements (id, title, content, priority, target_class, author_id, is_pinned)
          VALUES (?, ?, ?, 'exam', ?, ?, 1)
        `).bind(annId, `Exam Alert: ${title}`, annContent, className, auth.user.id).run();
      }

      return successResponse({ id: examId }, 'Exam schedule created successfully', 201);
    } catch (err) {
      return errorResponse(`Exam creation failed: ${err.message}`, 500);
    }
  }

  // PUT /api/admin/exams/:id - Update / Change Exam details (Admin ONLY)
  if (path.startsWith('/api/admin/exams/') && method === 'PUT') {
    const auth = await authenticate(request, env, ['admin']);
    if (auth.error) return auth.error;

    const examId = path.replace('/api/admin/exams/', '');
    try {
      const body = await request.json();
      const {
        title,
        className = 'All Classes',
        subject,
        examDate,
        startTime = '',
        endTime = '',
        roomOrHall = '',
        syllabus = '',
        driveLink = ''
      } = body;

      if (!title || !subject || !examDate) {
        return errorResponse('Exam title, subject, and date are required', 400);
      }

      const existing = await env.DB.prepare(`SELECT id FROM exams WHERE id = ?`).bind(examId).first();
      if (!existing) {
        return errorResponse('Exam not found', 404);
      }

      await env.DB.prepare(`
        UPDATE exams
        SET title = ?,
            class_name = ?,
            subject = ?,
            exam_date = ?,
            start_time = ?,
            end_time = ?,
            room_or_hall = ?,
            syllabus = ?,
            drive_link = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        title.trim(),
        className.trim(),
        subject.trim(),
        examDate.trim(),
        startTime.trim(),
        endTime.trim(),
        roomOrHall.trim(),
        syllabus.trim(),
        driveLink ? driveLink.trim() : null,
        examId
      ).run();

      await env.DB.prepare(`
        INSERT INTO audit_logs (id, action, actor_id, details)
        VALUES (?, 'EXAM_UPDATED', ?, ?)
      `).bind(generateId('log', 8), auth.user.id, `Updated exam details for ${title} (${examId})`).run();

      return successResponse({ id: examId }, 'Exam schedule updated successfully');
    } catch (err) {
      return errorResponse(`Exam update failed: ${err.message}`, 500);
    }
  }

  // DELETE /api/admin/exams/:id - Delete Exam (Admin ONLY)
  if (path.startsWith('/api/admin/exams/') && method === 'DELETE') {
    const auth = await authenticate(request, env, ['admin']);
    if (auth.error) return auth.error;

    const examId = path.replace('/api/admin/exams/', '');
    try {
      await env.DB.prepare(`DELETE FROM exams WHERE id = ?`).bind(examId).run();

      await env.DB.prepare(`
        INSERT INTO audit_logs (id, action, actor_id, details)
        VALUES (?, 'EXAM_DELETED', ?, ?)
      `).bind(generateId('log', 8), auth.user.id, `Deleted exam ${examId}`).run();

      return successResponse({}, 'Exam schedule deleted successfully');
    } catch (err) {
      return errorResponse(`Failed to delete exam: ${err.message}`, 500);
    }
  }

  return errorResponse('Exam route not found', 404);
}
