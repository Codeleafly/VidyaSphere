/**
 * Admin Routes: Approvals, Student Roster, Account Controls, Statistics
 * Streamlined code-free instant approval system
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';
import { sendActivationEmail } from '../utils/email.js';

export async function handleAdminRoutes(request, env, path, method) {
  // All admin routes require admin role
  const auth = await authenticate(request, env, ['admin']);
  if (auth.error) return auth.error;

  // GET /api/admin/registrations or /api/admin/applications
  if ((path === '/api/admin/registrations' || path === '/api/admin/applications') && method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = `
      SELECT id, username, full_name, class_name, division, roll_number, email, role,
             account_status, account_status as review_status, rejection_reason, created_at
      FROM profiles
      WHERE role = 'student'
    `;
    const params = [];

    if (status) {
      query += ` AND account_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ registrations: results || [] });
  }

  // POST /api/admin/approve - 1-Click Approval (Zero Access Codes Required)
  if (path === '/api/admin/approve' && method === 'POST') {
    try {
      const body = await request.json();
      const targetId = body.userId || body.trackingToken || body.id;

      if (!targetId) return errorResponse('userId is required', 400);

      const student = await env.DB.prepare(
        `SELECT id, username, full_name, email, account_status FROM profiles WHERE (id = ? OR username = ?) AND role = 'student'`
      ).bind(targetId, targetId).first();

      if (!student) return errorResponse('Student record not found', 404);

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET account_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(student.id),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'APPROVE_STUDENT', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Approved student ${student.full_name} (@${student.username})`),
      ]);

      // If email provided, send instant activation confirmation
      let emailResult = null;
      if (student.email) {
        try {
          emailResult = await sendActivationEmail(env, {
            email: student.email,
            fullName: student.full_name,
            username: student.username,
            code: 'APPROVED',
            trackingToken: student.id,
          });
        } catch (mailErr) {
          console.error('Email dispatch error on approve:', mailErr);
        }
      }

      return successResponse({
        id: student.id,
        username: student.username,
        accountStatus: 'active',
        email: student.email || null,
        emailDispatched: emailResult ? emailResult.success : false,
      }, `Student @${student.username} successfully approved! Portal is now unlocked for them.`);
    } catch (err) {
      return errorResponse(`Approve error: ${err.message}`, 500);
    }
  }

  // POST /api/admin/reject - Reject registration with reason
  if (path === '/api/admin/reject' && method === 'POST') {
    try {
      const body = await request.json();
      const targetId = body.userId || body.trackingToken || body.id;
      const reason = body.reason || 'Application details did not match school records';

      if (!targetId) return errorResponse('userId is required', 400);

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET account_status = 'rejected', rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? OR username = ?`
        ).bind(reason, targetId, targetId),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'REJECT_STUDENT', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Rejected student ${targetId}: ${reason}`),
      ]);

      return successResponse({}, 'Student admission application marked as rejected');
    } catch (err) {
      return errorResponse(`Reject error: ${err.message}`, 500);
    }
  }

  // GET /api/admin/students - Search and filter roster (students and sub-admins)
  if (path === '/api/admin/students' && method === 'GET') {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const className = url.searchParams.get('className') || '';
    const status = url.searchParams.get('status') || '';

    let query = `
      SELECT id, username, full_name, class_name, division, roll_number, email, role, account_status, is_root_admin, created_at
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

    query += ` ORDER BY is_root_admin DESC, role DESC, class_name ASC, division ASC, CAST(roll_number AS INTEGER) ASC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ students: results || [] });
  }

  // POST /api/admin/student-status - Suspend or activate an account (Root Admin protected)
  if (path === '/api/admin/student-status' && method === 'POST') {
    try {
      const body = await request.json();
      const { studentId, status } = body;

      if (!studentId || !['active', 'suspended'].includes(status)) {
        return errorResponse('Valid studentId and status (active|suspended) required', 400);
      }

      const target = await env.DB.prepare(
        `SELECT id, username, is_root_admin FROM profiles WHERE id = ?`
      ).bind(studentId).first();

      if (!target) return errorResponse('User not found', 404);

      // ROOT ADMIN IMMUNITY: Secondary admins cannot suspend Root Admin!
      if (target.is_root_admin === 1 || target.username === 'admin') {
        return errorResponse('Forbidden: Root Lead Admin is permanently protected and cannot be suspended or disabled.', 403);
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET account_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(status, studentId),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'UPDATE_STUDENT_STATUS', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Set status to ${status} for ${studentId}`),
      ]);

      return successResponse({ studentId, status }, `Account status updated to ${status}`);
    } catch (err) {
      return errorResponse(`Status update error: ${err.message}`, 500);
    }
  }

  // POST /api/admin/change-role - Lead Admin promotes user to Admin or Teacher (Root Admin only)
  if (path === '/api/admin/change-role' && method === 'POST') {
    try {
      const body = await request.json();
      const { userId, newRole } = body;

      if (!userId || !['student', 'teacher', 'admin'].includes(newRole)) {
        return errorResponse('Valid userId and newRole (student|teacher|admin) are required', 400);
      }

      // ONLY Root Lead Admin can promote or demote someone to Admin!
      if (!auth.user.isRootAdmin) {
        return errorResponse('Forbidden: Only the Lead Root Admin (@admin) has authority to promote or modify admin privileges.', 403);
      }

      const target = await env.DB.prepare(
        `SELECT id, username, is_root_admin FROM profiles WHERE id = ?`
      ).bind(userId).first();

      if (!target) return errorResponse('Target user not found', 404);

      // Target cannot be Root Admin
      if (target.is_root_admin === 1 || target.username === 'admin') {
        return errorResponse('Forbidden: Lead Root Admin role cannot be modified or demoted.', 403);
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(newRole, userId),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'ROLE_PROMOTED', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Changed role of @${target.username} to ${newRole}`),
      ]);

      return successResponse({ userId, newRole }, `User @${target.username} has been updated to ${newRole}!`);
    } catch (err) {
      return errorResponse(`Change role error: ${err.message}`, 500);
    }
  }

  // GET /api/admin/stats - Quick overview dashboard stats
  if (path === '/api/admin/stats' && method === 'GET') {
    const [pendingStudents, totalStudents, totalNotes, totalQuestions, activePolls, totalExams] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as count FROM profiles WHERE role = 'student' AND account_status = 'pending'`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM profiles WHERE role = 'student' AND account_status = 'active'`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM notes`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM questions`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM polls`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM exams`).first().catch(() => ({ count: 0 })),
    ]);

    return successResponse({
      stats: {
        pendingRegistrations: pendingStudents ? pendingStudents.count : 0,
        totalStudents: totalStudents ? totalStudents.count : 0,
        totalNotes: totalNotes ? totalNotes.count : 0,
        totalQuestions: totalQuestions ? totalQuestions.count : 0,
        totalPolls: activePolls ? activePolls.count : 0,
        totalExams: totalExams ? totalExams.count : 0,
      }
    });
  }

  // GET /api/admin/settings - View school settings
  if (path === '/api/admin/settings' && method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT * FROM school_settings`).all();
    const settingsMap = {};
    (results || []).forEach(r => { settingsMap[r.key] = r.value; });
    return successResponse({ settings: settingsMap });
  }

  // POST /api/admin/settings - Update school settings (e.g. academic_year)
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
