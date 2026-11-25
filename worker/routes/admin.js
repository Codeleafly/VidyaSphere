/**
 * Admin Routes: Approvals (Students & Teachers), Roster, Role Hierarchy & Teacher Protection
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';
import { sendActivationEmail } from '../utils/email.js';
import { parseStringList } from '../utils/teacherScope.js';

export async function handleAdminRoutes(request, env, path, method) {
  const auth = await authenticate(request, env, ['admin']);
  if (auth.error) return auth.error;

  const isCallerRoot = auth.user.isRootAdmin || auth.user.username === 'admin';

  // GET /api/admin/registrations or /api/admin/applications
  if ((path === '/api/admin/registrations' || path === '/api/admin/applications') && method === 'GET') {
    const url = new URL(request.url);
    let status = url.searchParams.get('status');
    const roleFilter = url.searchParams.get('role');
    if (status === 'approved') status = 'active';

    let query = `
      SELECT id, username, full_name, class_name, division, roll_number, email, role,
             teacher_type, assigned_classes, assigned_subjects, allow_student_dms,
             account_status, account_status as review_status, rejection_reason, created_at
      FROM profiles
      WHERE is_root_admin = 0 AND username != 'admin'
    `;
    const params = [];

    if (status) {
      query += ` AND account_status = ?`;
      params.push(status);
    }
    if (roleFilter) {
      query += ` AND role = ?`;
      params.push(roleFilter);
    }

    query += ` ORDER BY created_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ registrations: results || [] });
  }

  // POST /api/admin/approve - 1-Click Approval for Students & Teachers (Lead & Secondary Admin)
  if (path === '/api/admin/approve' && method === 'POST') {
    try {
      const body = await request.json();
      const targetId = body.userId || body.trackingToken || body.id;
      if (!targetId) return errorResponse('userId is required', 400);

      const applicant = await env.DB.prepare(
        `SELECT id, username, full_name, email, role, account_status, class_name, division,
                teacher_type, assigned_classes, assigned_subjects
         FROM profiles WHERE id = ? OR username = ?`
      ).bind(targetId, targetId).first();

      if (!applicant) return errorResponse('User record not found', 404);

      let targetRole = applicant.role === 'teacher' ? 'teacher' : 'student';
      if (body.role === 'admin') {
        if (!isCallerRoot) {
          return errorResponse('Forbidden: Only Lead Root Admin can approve users directly as Admin.', 403);
        }
        targetRole = 'admin';
      } else if (body.role === 'teacher' || body.role === 'student') {
        targetRole = body.role;
      }

      let nextTeacherType = body.teacherType !== undefined ? body.teacherType : applicant.teacher_type;
      let nextClasses = body.assignedClasses !== undefined
        ? parseStringList(body.assignedClasses)
        : parseStringList(applicant.assigned_classes);
      let nextSubjects = body.assignedSubjects !== undefined
        ? parseStringList(body.assignedSubjects)
        : parseStringList(applicant.assigned_subjects);
      let nextClassName = body.className !== undefined ? String(body.className).trim() : applicant.class_name;
      let nextDivision = body.division !== undefined ? String(body.division).trim().toUpperCase() : applicant.division;

      if (targetRole === 'teacher') {
        if (!['subject', 'class'].includes(nextTeacherType)) {
          nextTeacherType = 'subject';
        }
        if (nextTeacherType === 'class' && nextClassName && !nextClasses.includes(nextClassName)) {
          nextClasses.unshift(nextClassName);
        }
        if (!nextClassName && nextClasses.length > 0) {
          nextClassName = nextClasses[0];
        }
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles
           SET account_status = 'active',
               role = ?,
               class_name = ?,
               division = ?,
               teacher_type = ?,
               assigned_classes = ?,
               assigned_subjects = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(
          targetRole,
          nextClassName,
          nextDivision,
          targetRole === 'teacher' ? nextTeacherType : null,
          JSON.stringify(nextClasses),
          JSON.stringify(nextSubjects),
          applicant.id
        ),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'APPROVE_USER', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Approved ${applicant.full_name} (@${applicant.username}) with role ${targetRole}`),
      ]);

      let emailResult = null;
      if (applicant.email) {
        try {
          emailResult = await sendActivationEmail(env, {
            email: applicant.email,
            fullName: applicant.full_name,
            username: applicant.username,
            code: 'APPROVED',
            trackingToken: applicant.id,
          });
        } catch (mailErr) {
          console.error('Email dispatch error on approve:', mailErr);
        }
      }

      return successResponse({
        id: applicant.id,
        username: applicant.username,
        accountStatus: 'active',
        role: targetRole,
        teacherType: targetRole === 'teacher' ? nextTeacherType : null,
        assignedClasses: nextClasses,
        assignedSubjects: nextSubjects,
        email: applicant.email || null,
        emailDispatched: emailResult ? emailResult.success : false,
      }, `User @${applicant.username} approved as ${targetRole}! Portal is now unlocked.`);
    } catch (err) {
      return errorResponse(`Approve error: ${err.message}`, 500);
    }
  }

  // POST /api/admin/reject - Reject pending registration with reason
  if (path === '/api/admin/reject' && method === 'POST') {
    try {
      const body = await request.json();
      const targetId = body.userId || body.trackingToken || body.id;
      const reason = body.reason || 'Application details did not match school records';

      if (!targetId) return errorResponse('userId is required', 400);

      const target = await env.DB.prepare(
        `SELECT id, role, account_status, is_root_admin, username FROM profiles WHERE id = ? OR username = ?`
      ).bind(targetId, targetId).first();

      if (!target) return errorResponse('User not found', 404);
      if (target.is_root_admin === 1 || target.username === 'admin') {
        return errorResponse('Forbidden: Root Admin cannot be rejected.', 403);
      }
      if (target.account_status === 'active' && target.role === 'teacher' && !isCallerRoot) {
        return errorResponse('Forbidden: Only Lead Root Admin can disable an active Teacher.', 403);
      }
      if (target.role === 'admin' && !isCallerRoot) {
        return errorResponse('Forbidden: Only Lead Root Admin can modify another Admin.', 403);
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET account_status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(reason, target.id),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'REJECT_USER', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Rejected ${targetId}: ${reason}`),
      ]);

      return successResponse({}, 'Verification request marked as rejected');
    } catch (err) {
      return errorResponse(`Reject error: ${err.message}`, 500);
    }
  }

  // POST /api/admin/teacher-profile - Lead & Secondary Admins can adjust Teacher assignments during/after approval
  if (path === '/api/admin/teacher-profile' && method === 'POST') {
    try {
      const body = await request.json();
      const { userId, teacherType, assignedClasses, assignedSubjects, className, division } = body;
      if (!userId) return errorResponse('userId is required', 400);

      const target = await env.DB.prepare(
        `SELECT id, username, role, class_name, division, teacher_type, assigned_classes, assigned_subjects
         FROM profiles WHERE id = ? OR username = ?`
      ).bind(userId, userId).first();

      if (!target) return errorResponse('Teacher record not found', 404);
      if (target.role !== 'teacher') return errorResponse('Target user is not a teacher', 400);

      const nextType = ['subject', 'class'].includes(teacherType) ? teacherType : (target.teacher_type || 'subject');
      const nextClasses = assignedClasses !== undefined ? parseStringList(assignedClasses) : parseStringList(target.assigned_classes);
      const nextSubjects = assignedSubjects !== undefined ? parseStringList(assignedSubjects) : parseStringList(target.assigned_subjects);
      const nextClassName = className !== undefined ? String(className).trim() : (nextClasses[0] || target.class_name);
      const nextDivision = division !== undefined ? String(division).trim().toUpperCase() : target.division;

      if (nextType === 'class' && nextClassName && !nextClasses.includes(nextClassName)) {
        nextClasses.unshift(nextClassName);
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles
           SET teacher_type = ?, assigned_classes = ?, assigned_subjects = ?, class_name = ?, division = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(nextType, JSON.stringify(nextClasses), JSON.stringify(nextSubjects), nextClassName, nextDivision, target.id),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details) VALUES (?, 'UPDATE_TEACHER_ASSIGNMENT', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Updated assignments for teacher @${target.username}`),
      ]);

      return successResponse({
        userId: target.id,
        teacherType: nextType,
        assignedClasses: nextClasses,
        assignedSubjects: nextSubjects,
        className: nextClassName,
        division: nextDivision,
      }, `Teacher @${target.username} assignments updated!`);
    } catch (err) {
      return errorResponse(`Update teacher profile error: ${err.message}`, 500);
    }
  }

  // GET /api/admin/students - Search & filter full school roster (students, teachers, admins)
  if (path === '/api/admin/students' && method === 'GET') {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const className = url.searchParams.get('className') || '';
    const status = url.searchParams.get('status') || '';
    const roleFilter = url.searchParams.get('role') || '';

    let query = `
      SELECT id, username, full_name, class_name, division, roll_number, email, role,
             teacher_type, assigned_classes, assigned_subjects, allow_student_dms,
             account_status, is_root_admin, created_at
      FROM profiles
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (full_name LIKE ? OR username LIKE ? OR roll_number LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (className) {
      query += ` AND class_name = ?`;
      params.push(className);
    }
    if (status) {
      query += ` AND account_status = ?`;
      params.push(status);
    }
    if (roleFilter) {
      query += ` AND role = ?`;
      params.push(roleFilter);
    }

    query += ` ORDER BY is_root_admin DESC, (CASE role WHEN 'admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END), class_name ASC, division ASC, CAST(roll_number AS INTEGER) ASC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ students: results || [] });
  }

  // POST /api/admin/student-status - Suspend or reactivate (Root Admin & Active Teachers protected!)
  if (path === '/api/admin/student-status' && method === 'POST') {
    try {
      const body = await request.json();
      const { studentId, status } = body;

      if (!studentId || !['active', 'suspended'].includes(status)) {
        return errorResponse('Valid studentId and status (active|suspended) required', 400);
      }

      const target = await env.DB.prepare(
        `SELECT id, username, role, is_root_admin FROM profiles WHERE id = ?`
      ).bind(studentId).first();

      if (!target) return errorResponse('User not found', 404);

      if (target.id === auth.user.id) {
        return errorResponse('You cannot suspend or modify your own account status', 400);
      }

      if (target.is_root_admin === 1 || target.username === 'admin') {
        return errorResponse('Forbidden: Root Lead Admin is permanently protected and cannot be suspended or disabled.', 403);
      }
      if (target.role === 'admin' && !isCallerRoot) {
        return errorResponse('Forbidden: Only the Lead Root Admin can suspend or reactivate Secondary Admins.', 403);
      }
      if (target.role === 'teacher' && !isCallerRoot) {
        return errorResponse('Forbidden: Only the Lead Root Admin (@admin) can suspend or reactivate Teachers.', 403);
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET account_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(status, studentId),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'UPDATE_USER_STATUS', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Set status to ${status} for ${studentId} (@${target.username})`),
      ]);

      return successResponse({ studentId, status }, `Account status updated to ${status}`);
    } catch (err) {
      return errorResponse(`Status update error: ${err.message}`, 500);
    }
  }

  // POST /api/admin/change-role - Lead Root Admin ONLY (promote/demote student, teacher, admin)
  if (path === '/api/admin/change-role' && method === 'POST') {
    try {
      const body = await request.json();
      const { userId, newRole, teacherType, assignedClasses, assignedSubjects } = body;

      if (!userId || !['student', 'teacher', 'admin'].includes(newRole)) {
        return errorResponse('Valid userId and newRole (student|teacher|admin) are required', 400);
      }

      if (!isCallerRoot) {
        return errorResponse('Forbidden: Only the Lead Root Admin (@admin) has authority to modify or demote user roles.', 403);
      }

      const target = await env.DB.prepare(
        `SELECT id, username, is_root_admin, teacher_type, assigned_classes, assigned_subjects FROM profiles WHERE id = ? OR username = ?`
      ).bind(userId, userId).first();

      if (!target) return errorResponse('Target user not found', 404);

      if (target.is_root_admin === 1 || target.username === 'admin') {
        return errorResponse('Forbidden: Lead Root Admin role cannot be modified or demoted.', 403);
      }

      const nextTeacherType = newRole === 'teacher'
        ? (['subject', 'class'].includes(teacherType) ? teacherType : (target.teacher_type || 'subject'))
        : null;
      const nextClasses = newRole === 'teacher'
        ? JSON.stringify(assignedClasses !== undefined ? parseStringList(assignedClasses) : parseStringList(target.assigned_classes))
        : '[]';
      const nextSubjects = newRole === 'teacher'
        ? JSON.stringify(assignedSubjects !== undefined ? parseStringList(assignedSubjects) : parseStringList(target.assigned_subjects))
        : '[]';

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles
           SET role = ?, teacher_type = ?, assigned_classes = ?, assigned_subjects = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        ).bind(newRole, nextTeacherType, nextClasses, nextSubjects, target.id),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'ROLE_CHANGED', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Changed role of @${target.username} to ${newRole}`),
      ]);

      return successResponse({ userId: target.id, newRole }, `User @${target.username} has been updated to ${newRole}!`);
    } catch (err) {
      return errorResponse(`Change role error: ${err.message}`, 500);
    }
  }

  // DELETE /api/admin/users/:id - Delete account (Teachers & Admins protected for Root Admin only)
  if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
    const targetId = path.replace('/api/admin/users/', '').trim();
    if (!targetId) return errorResponse('User ID is required', 400);

    const target = await env.DB.prepare(
      `SELECT id, username, role, is_root_admin FROM profiles WHERE id = ?`
    ).bind(targetId).first();

    if (!target) return errorResponse('User not found', 404);
    if (target.id === auth.user.id) return errorResponse('You cannot delete your own account', 400);
    if (target.is_root_admin === 1 || target.username === 'admin') {
      return errorResponse('Forbidden: Lead Root Admin cannot be deleted.', 403);
    }
    if ((target.role === 'teacher' || target.role === 'admin') && !isCallerRoot) {
      return errorResponse('Forbidden: Only the Lead Root Admin (@admin) can delete Teachers or Admins.', 403);
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(target.id),
      env.DB.prepare(`DELETE FROM profiles WHERE id = ?`).bind(target.id),
      env.DB.prepare(
        `INSERT INTO audit_logs (id, action, actor_id, details) VALUES (?, 'DELETE_USER', ?, ?)`
      ).bind(generateId('log', 8), auth.user.id, `Deleted user @${target.username} (${target.role})`),
    ]);

    return successResponse({ id: target.id }, `User @${target.username} removed`);
  }

  // GET /api/admin/stats - Dashboard overview metrics
  if (path === '/api/admin/stats' && method === 'GET') {
    const [pendingAll, totalStudents, totalTeachers, totalNotes, totalQuestions, activePolls, totalExams, totalLessons, totalQuizzes] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as count FROM profiles WHERE account_status = 'pending'`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM profiles WHERE role = 'student' AND account_status = 'active'`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM profiles WHERE role = 'teacher' AND account_status = 'active'`).first().catch(() => ({ count: 0 })),
      env.DB.prepare(`SELECT COUNT(*) as count FROM notes`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM questions`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM polls`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM exams`).first().catch(() => ({ count: 0 })),
      env.DB.prepare(`SELECT COUNT(*) as count FROM lessons`).first().catch(() => ({ count: 0 })),
      env.DB.prepare(`SELECT COUNT(*) as count FROM quizzes`).first().catch(() => ({ count: 0 })),
    ]);

    return successResponse({
      stats: {
        pendingRegistrations: pendingAll ? pendingAll.count : 0,
        totalStudents: totalStudents ? totalStudents.count : 0,
        totalTeachers: totalTeachers ? totalTeachers.count : 0,
        totalNotes: totalNotes ? totalNotes.count : 0,
        totalQuestions: totalQuestions ? totalQuestions.count : 0,
        totalPolls: activePolls ? activePolls.count : 0,
        totalExams: totalExams ? totalExams.count : 0,
        totalLessons: totalLessons ? totalLessons.count : 0,
        totalQuizzes: totalQuizzes ? totalQuizzes.count : 0,
      }
    });
  }

  // GET /api/admin/settings
  if (path === '/api/admin/settings' && method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT * FROM school_settings`).all();
    const settingsMap = {};
    (results || []).forEach(r => { settingsMap[r.key] = r.value; });
    return successResponse({ settings: settingsMap });
  }

  // POST /api/admin/settings
  if (path === '/api/admin/settings' && method === 'POST') {
    try {
      const body = await request.json();
      const { key, value } = body;
      if (!key || !value) return errorResponse('key and value are required');

      await env.DB.prepare(
        `INSERT INTO school_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
      ).bind(key.trim(), value.trim()).run();

      return successResponse({ key, value }, `Setting '${key}' updated to '${value}'`);
    } catch (err) {
      return errorResponse(`Settings error: ${err.message}`, 500);
    }
  }

  return errorResponse('Admin route not found', 404);
}
