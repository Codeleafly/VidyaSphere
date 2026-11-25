/**
 * Teacher Studio Scoped Routes
 * - Overview metrics & DM Privacy settings for all Teachers
 * - Scoped Student Approvals & Class Roster strictly for Class Teachers
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';
import { sendActivationEmail } from '../utils/email.js';
import { isClassTeacherForStudent } from '../utils/teacherScope.js';

export async function handleTeacherRoutes(request, env, path, method) {
  const auth = await authenticate(request, env, ['teacher']);
  if (auth.error) return auth.error;

  const teacher = auth.user;

  // GET /api/teacher/overview - Teacher Studio summary
  if (path === '/api/teacher/overview' && method === 'GET') {
    const [lessonsCount, quizzesCount, homeworkCount, notesCount] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as c FROM lessons WHERE teacher_id = ?`).bind(teacher.id).first().catch(() => ({ c: 0 })),
      env.DB.prepare(`SELECT COUNT(*) as c FROM quizzes WHERE teacher_id = ?`).bind(teacher.id).first().catch(() => ({ c: 0 })),
      env.DB.prepare(`SELECT COUNT(*) as c FROM homework WHERE teacher_id = ?`).bind(teacher.id).first().catch(() => ({ c: 0 })),
      env.DB.prepare(`SELECT COUNT(*) as c FROM notes WHERE uploader_id = ?`).bind(teacher.id).first().catch(() => ({ c: 0 })),
    ]);

    let pendingClassStudents = 0;
    let activeClassStudents = 0;
    if (teacher.teacherType === 'class' && teacher.className) {
      const hasDiv = teacher.division && !['ALL', '-', 'NA'].includes(teacher.division.toUpperCase());
      const pendingRow = hasDiv
        ? await env.DB.prepare(`SELECT COUNT(*) as c FROM profiles WHERE role = 'student' AND account_status = 'pending' AND class_name = ? AND UPPER(division) = ?`).bind(teacher.className, teacher.division.toUpperCase()).first()
        : await env.DB.prepare(`SELECT COUNT(*) as c FROM profiles WHERE role = 'student' AND account_status = 'pending' AND class_name = ?`).bind(teacher.className).first();

      const activeRow = hasDiv
        ? await env.DB.prepare(`SELECT COUNT(*) as c FROM profiles WHERE role = 'student' AND account_status = 'active' AND class_name = ? AND UPPER(division) = ?`).bind(teacher.className, teacher.division.toUpperCase()).first()
        : await env.DB.prepare(`SELECT COUNT(*) as c FROM profiles WHERE role = 'student' AND account_status = 'active' AND class_name = ?`).bind(teacher.className).first();

      pendingClassStudents = pendingRow?.c || 0;
      activeClassStudents = activeRow?.c || 0;
    }

    return successResponse({
      overview: {
        lessonsCount: lessonsCount?.c || 0,
        quizzesCount: quizzesCount?.c || 0,
        homeworkCount: homeworkCount?.c || 0,
        notesCount: notesCount?.c || 0,
        pendingClassStudents,
        activeClassStudents,
      }
    });
  }

  // PUT /api/teacher/settings - Toggle Student DM permission
  if (path === '/api/teacher/settings' && (method === 'PUT' || method === 'POST')) {
    try {
      const body = await request.json();
      const allowStudentDms = body.allowStudentDms === false || body.allowStudentDms === 0 ? 0 : 1;

      await env.DB.prepare(
        `UPDATE profiles SET allow_student_dms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(allowStudentDms, teacher.id).run();

      return successResponse(
        { allowStudentDms: allowStudentDms === 1 },
        `Student direct messages ${allowStudentDms === 1 ? 'enabled' : 'disabled'}`
      );
    } catch (err) {
      return errorResponse(`Teacher settings error: ${err.message}`, 500);
    }
  }

  // Class Teacher Scoped Student Roster & Approvals
  if (path.startsWith('/api/teacher/students')) {
    if (teacher.teacherType !== 'class') {
      return errorResponse('Forbidden: Only Class Teachers can view or approve student class rosters.', 403);
    }

    // GET /api/teacher/students?status=pending|active
    if (path === '/api/teacher/students' && method === 'GET') {
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || '';
      const hasDiv = teacher.division && !['ALL', '-', 'NA'].includes(teacher.division.toUpperCase());

      let query = `
        SELECT id, username, full_name, class_name, division, roll_number, email, account_status, rejection_reason, created_at
        FROM profiles
        WHERE role = 'student' AND class_name = ?
      `;
      const params = [teacher.className];

      if (hasDiv) {
        query += ` AND UPPER(division) = ?`;
        params.push(teacher.division.toUpperCase());
      }
      if (status) {
        query += ` AND account_status = ?`;
        params.push(status);
      }

      query += ` ORDER BY (CASE account_status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END), division ASC, CAST(roll_number AS INTEGER) ASC`;
      const { results } = await env.DB.prepare(query).bind(...params).all();
      return successResponse({ students: results || [] });
    }

    // POST /api/teacher/students/approve
    if (path === '/api/teacher/students/approve' && method === 'POST') {
      try {
        const body = await request.json();
        const targetId = body.userId || body.studentId || body.id;
        if (!targetId) return errorResponse('userId is required', 400);

        const student = await env.DB.prepare(
          `SELECT id, username, full_name, email, role, class_name, division, account_status FROM profiles WHERE id = ? OR username = ?`
        ).bind(targetId, targetId).first();

        if (!student) return errorResponse('Student not found', 404);
        if (student.role !== 'student') {
          return errorResponse('Forbidden: Class Teachers can only approve Student accounts.', 403);
        }
        if (!isClassTeacherForStudent(teacher, student.class_name, student.division)) {
          return errorResponse(`Forbidden: You can only approve students in ${teacher.className}${teacher.division ? ' Div ' + teacher.division : ''}.`, 403);
        }

        await env.DB.batch([
          env.DB.prepare(`UPDATE profiles SET account_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(student.id),
          env.DB.prepare(`INSERT INTO audit_logs (id, action, actor_id, details) VALUES (?, 'CLASS_TEACHER_APPROVE', ?, ?)`).bind(
            generateId('log', 8),
            teacher.id,
            `Class Teacher @${teacher.username} approved student @${student.username} (${student.class_name} ${student.division})`
          ),
        ]);

        if (student.email) {
          try {
            await sendActivationEmail(env, {
              email: student.email,
              fullName: student.full_name,
              username: student.username,
              code: 'APPROVED',
              trackingToken: student.id,
            });
          } catch { /* ignore email delivery failures */ }
        }

        return successResponse({ id: student.id, accountStatus: 'active' }, `Student @${student.username} approved!`);
      } catch (err) {
        return errorResponse(`Class Teacher approve error: ${err.message}`, 500);
      }
    }

    // POST /api/teacher/students/reject
    if (path === '/api/teacher/students/reject' && method === 'POST') {
      try {
        const body = await request.json();
        const targetId = body.userId || body.studentId || body.id;
        const reason = body.reason || 'Class roster details did not match records';
        if (!targetId) return errorResponse('userId is required', 400);

        const student = await env.DB.prepare(
          `SELECT id, username, role, class_name, division, account_status FROM profiles WHERE id = ? OR username = ?`
        ).bind(targetId, targetId).first();

        if (!student) return errorResponse('Student not found', 404);
        if (student.role !== 'student') {
          return errorResponse('Forbidden: Class Teachers can only reject Student accounts.', 403);
        }
        if (!isClassTeacherForStudent(teacher, student.class_name, student.division)) {
          return errorResponse(`Forbidden: You can only manage students in ${teacher.className}.`, 403);
        }

        await env.DB.batch([
          env.DB.prepare(`UPDATE profiles SET account_status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(reason, student.id),
          env.DB.prepare(`INSERT INTO audit_logs (id, action, actor_id, details) VALUES (?, 'CLASS_TEACHER_REJECT', ?, ?)`).bind(
            generateId('log', 8),
            teacher.id,
            `Class Teacher @${teacher.username} rejected student @${student.username}: ${reason}`
          ),
        ]);

        return successResponse({ id: student.id, accountStatus: 'rejected' }, 'Student request rejected');
      } catch (err) {
        return errorResponse(`Class Teacher reject error: ${err.message}`, 500);
      }
    }
  }

  return errorResponse('Teacher route not found', 404);
}
