/**
 * VidyaSphere Examination Schedules & Class Unit Tests Route Handler
 * - GET /api/exams: Readable by all students, teachers, and visitors
 * - /api/admin/exams*: Strictly Admin ONLY (Board & School-wide Exams)
 * - /api/teacher/exams*: Strictly Class Teachers ONLY (Unit / Class Tests for their assigned Class)
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { validateHttpUrl } from '../utils/compression.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleExamsRoutes(request, env, path, method) {
  // GET /api/exams - Fetch exam timetable
  if (path === '/api/exams' && method === 'GET') {
    const url = new URL(request.url);
    const targetClass = url.searchParams.get('class');
    const academicYear = url.searchParams.get('academic_year') || '2026-2027';

    let query = `
      SELECT e.*, p.full_name as author_name, p.role as author_role, p.teacher_type as author_teacher_type
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

  // POST /api/admin/exams OR POST /api/teacher/exams
  if ((path === '/api/admin/exams' || path === '/api/teacher/exams') && method === 'POST') {
    const isTeacherEndpoint = path.startsWith('/api/teacher/');
    const auth = await authenticate(request, env, isTeacherEndpoint ? ['teacher'] : ['admin']);
    if (auth.error) return auth.error;

    if (isTeacherEndpoint && auth.user.teacherType !== 'class') {
      return errorResponse('Forbidden: Only Class Teachers can schedule unit/class tests.', 403);
    }

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
        broadcastNotice = false,
        examType = 'board'
      } = body;

      if (!title || !subject || !examDate) {
        return errorResponse('Exam title, subject, and date (YYYY-MM-DD) are required', 400);
      }

      let finalClassName = String(className || '').trim();
      let finalExamType = examType === 'unit_test' ? 'unit_test' : 'board';

      if (isTeacherEndpoint) {
        finalExamType = 'unit_test';
        const teacherClass = (auth.user.className || '').trim();
        if (!teacherClass) {
          return errorResponse('Your Class Teacher profile does not have an assigned class.', 400);
        }
        if (finalClassName && finalClassName !== 'All Classes' && finalClassName !== teacherClass) {
          return errorResponse(`Forbidden: Class Teachers can only schedule unit tests for ${teacherClass}.`, 403);
        }
        finalClassName = teacherClass;
      }

      const urlCheck = validateHttpUrl(driveLink);
      if (urlCheck && urlCheck.error) {
        return errorResponse(`Invalid Google Drive link: ${urlCheck.error}`, 400);
      }
      const cleanDriveLink = urlCheck ? urlCheck.url : null;

      const yearSetting = await env.DB.prepare(`SELECT value FROM school_settings WHERE key = 'academic_year'`).first();
      const academicYear = yearSetting?.value || '2026-2027';
      const examId = generateId('exm', 8);

      await env.DB.prepare(`
        INSERT INTO exams (id, title, class_name, subject, exam_date, start_time, end_time, room_or_hall, syllabus, drive_link, exam_type, academic_year, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        examId,
        title.trim(),
        finalClassName,
        subject.trim(),
        examDate.trim(),
        startTime.trim(),
        endTime.trim(),
        roomOrHall.trim(),
        syllabus.trim(),
        cleanDriveLink,
        finalExamType,
        academicYear,
        auth.user.id
      ).run();

      await env.DB.prepare(`
        INSERT INTO audit_logs (id, action, actor_id, details)
        VALUES (?, ?, ?, ?)
      `).bind(
        generateId('log', 8),
        isTeacherEndpoint ? 'CLASS_TEST_SCHEDULED' : 'EXAM_SCHEDULED',
        auth.user.id,
        `Scheduled ${finalExamType} "${title}" for ${finalClassName} on ${examDate}`
      ).run();

      if (broadcastNotice) {
        const annId = generateId('ann', 8);
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        const label = finalExamType === 'unit_test' ? 'Class Test Alert' : 'Exam Alert';
        const annContent = `Scheduled ${finalExamType === 'unit_test' ? 'Unit/Class Test' : 'Exam'}: ${title} (${subject}) on ${examDate}${startTime ? ' at ' + startTime : ''}.${roomOrHall ? ' Room/Hall: ' + roomOrHall : ''}\nCheck the Exam Timetable for complete syllabus and details.`;
        await env.DB.prepare(`
          INSERT INTO announcements (id, title, content, priority, target_class, author_id, is_pinned, expires_at)
          VALUES (?, ?, ?, 'exam', ?, ?, 1, ?)
        `).bind(annId, `${label}: ${title}`, annContent, finalClassName, auth.user.id, expiresAt).run();
      }

      return successResponse({ id: examId, examType: finalExamType, className: finalClassName }, 'Exam schedule created successfully', 201);
    } catch (err) {
      return errorResponse(`Exam creation failed: ${err.message}`, 500);
    }
  }

  // PUT /api/admin/exams/:id OR PUT /api/teacher/exams/:id
  if ((path.startsWith('/api/admin/exams/') || path.startsWith('/api/teacher/exams/')) && method === 'PUT') {
    const isTeacherEndpoint = path.startsWith('/api/teacher/');
    const auth = await authenticate(request, env, isTeacherEndpoint ? ['teacher'] : ['admin']);
    if (auth.error) return auth.error;

    if (isTeacherEndpoint && auth.user.teacherType !== 'class') {
      return errorResponse('Forbidden: Only Class Teachers can edit class unit tests.', 403);
    }

    const examId = path.replace(isTeacherEndpoint ? '/api/teacher/exams/' : '/api/admin/exams/', '').trim();
    try {
      const existing = await env.DB.prepare(`SELECT * FROM exams WHERE id = ?`).bind(examId).first();
      if (!existing) return errorResponse('Exam not found', 404);

      if (isTeacherEndpoint) {
        if (existing.exam_type !== 'unit_test' || existing.class_name !== auth.user.className) {
          return errorResponse('Forbidden: Class Teachers can only edit unit tests in their own assigned class.', 403);
        }
      }

      const body = await request.json();
      const {
        title,
        className = existing.class_name,
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

      const finalClassName = isTeacherEndpoint ? auth.user.className : className.trim();
      if (isTeacherEndpoint && body.className && body.className.trim() !== auth.user.className) {
        return errorResponse(`Forbidden: Cannot move test outside ${auth.user.className}.`, 403);
      }

      const urlCheck = validateHttpUrl(driveLink);
      if (urlCheck && urlCheck.error) {
        return errorResponse(`Invalid Google Drive link: ${urlCheck.error}`, 400);
      }
      const cleanDriveLink = urlCheck ? urlCheck.url : null;

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
        finalClassName,
        subject.trim(),
        examDate.trim(),
        startTime.trim(),
        endTime.trim(),
        roomOrHall.trim(),
        syllabus.trim(),
        cleanDriveLink,
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

  // DELETE /api/admin/exams/:id OR DELETE /api/teacher/exams/:id
  if ((path.startsWith('/api/admin/exams/') || path.startsWith('/api/teacher/exams/')) && method === 'DELETE') {
    const isTeacherEndpoint = path.startsWith('/api/teacher/');
    const auth = await authenticate(request, env, isTeacherEndpoint ? ['teacher'] : ['admin']);
    if (auth.error) return auth.error;

    if (isTeacherEndpoint && auth.user.teacherType !== 'class') {
      return errorResponse('Forbidden: Only Class Teachers can delete class unit tests.', 403);
    }

    const examId = path.replace(isTeacherEndpoint ? '/api/teacher/exams/' : '/api/admin/exams/', '').trim();
    try {
      const existing = await env.DB.prepare(`SELECT * FROM exams WHERE id = ?`).bind(examId).first();
      if (!existing) return errorResponse('Exam not found', 404);

      if (isTeacherEndpoint && (existing.exam_type !== 'unit_test' || existing.class_name !== auth.user.className)) {
        return errorResponse('Forbidden: Class Teachers can only delete unit tests for their assigned class (Board exams are Admin-only).', 403);
      }

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
