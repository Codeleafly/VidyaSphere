/**
 * Admin Routes: Approvals, Student Roster, Account Controls, Statistics
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { generateId, generateActivationCode, sha256 } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';
import { sendActivationEmail } from '../utils/email.js';

export async function handleAdminRoutes(request, env, path, method) {
  // All admin routes require admin role
  const auth = await authenticate(request, env, ['admin']);
  if (auth.error) return auth.error;

  // GET /api/admin/registrations?status=pending|approved|rejected
  if (path === '/api/admin/registrations' && method === 'GET') {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    let query = `
      SELECT r.*, ac.assigned_username, ac.is_used as code_used
      FROM registrations r
      LEFT JOIN activation_codes ac ON r.tracking_token = ac.tracking_token
    `;
    const params = [];

    if (status) {
      query += ` WHERE r.review_status = ?`;
      params.push(status);
    }

    query += ` ORDER BY r.created_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ registrations: results || [] });
  }

  // POST /api/admin/approve - Approve registration and generate activation code
  if (path === '/api/admin/approve' && method === 'POST') {
    try {
      const body = await request.json();
      const { trackingToken } = body;

      if (!trackingToken) return errorResponse('trackingToken is required');

      const reg = await env.DB.prepare(
        `SELECT * FROM registrations WHERE tracking_token = ?`
      ).bind(trackingToken).first();

      if (!reg) return errorResponse('Registration not found', 404);

      // Generate a clean username e.g. "rohit_10a_12"
      const cleanName = reg.full_name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
      const cleanClass = reg.class_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const assignedUsername = `${cleanName}_${cleanClass}${reg.division.toLowerCase()}_${reg.roll_number}`;

      const rawCode = generateActivationCode(6);
      const codeHash = await sha256(rawCode);
      const codeId = generateId('code', 8);

      // 7 days expiration for activation code
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE registrations SET review_status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE tracking_token = ?`
        ).bind(trackingToken),
        env.DB.prepare(
          `INSERT INTO activation_codes (id, code_hash, tracking_token, assigned_username, expires_at, is_used)
           VALUES (?, ?, ?, ?, ?, 0)`
        ).bind(codeId, codeHash, trackingToken, assignedUsername, expiresAt),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'APPROVE_STUDENT', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Approved ${reg.full_name} (${assignedUsername})`),
      ]);

      // If optional student email was provided, dispatch activation email with username and 6-digit access code
      let emailResult = null;
      if (reg.email) {
        try {
          emailResult = await sendActivationEmail(env, {
            email: reg.email,
            fullName: reg.full_name,
            username: assignedUsername,
            code: rawCode,
            trackingToken,
          });
        } catch (mailErr) {
          console.error('Email dispatch error on approve:', mailErr);
        }
      }

      const emailMsg = reg.email
        ? ` & access details emailed to ${reg.email}`
        : '';

      return successResponse({
        assignedUsername,
        activationCode: rawCode,
        expiresAt,
        email: reg.email || null,
        emailDispatched: emailResult ? emailResult.success : false,
      }, `Registration approved! Activation code generated${emailMsg}.`);
    } catch (err) {
      return errorResponse(`Approve error: ${err.message}`, 500);
    }
  }

  // POST /api/admin/reject - Reject registration with reason
  if (path === '/api/admin/reject' && method === 'POST') {
    try {
      const body = await request.json();
      const { trackingToken, reason } = body;

      if (!trackingToken) return errorResponse('trackingToken is required');

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE registrations SET review_status = 'rejected', review_reason = ?, updated_at = CURRENT_TIMESTAMP
           WHERE tracking_token = ?`
        ).bind(reason || 'Application details did not match school records', trackingToken),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'REJECT_STUDENT', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Rejected token ${trackingToken}: ${reason}`),
      ]);

      return successResponse({}, 'Registration marked as rejected');
    } catch (err) {
      return errorResponse(`Reject error: ${err.message}`, 500);
    }
  }

  // GET /api/admin/students - Search and filter roster
  if (path === '/api/admin/students' && method === 'GET') {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const className = url.searchParams.get('className') || '';
    const status = url.searchParams.get('status') || '';

    let query = `
      SELECT id, username, full_name, class_name, division, roll_number, role, account_status, created_at
      FROM profiles
      WHERE role = 'student'
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

    query += ` ORDER BY class_name ASC, division ASC, CAST(roll_number AS INTEGER) ASC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ students: results || [] });
  }

  // POST /api/admin/student-status - Suspend or activate a student
  if (path === '/api/admin/student-status' && method === 'POST') {
    try {
      const body = await request.json();
      const { studentId, status } = body;

      if (!studentId || !['active', 'suspended'].includes(status)) {
        return errorResponse('Valid studentId and status (active|suspended) required');
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET account_status = ? WHERE id = ?`
        ).bind(status, studentId),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details)
           VALUES (?, 'UPDATE_STUDENT_STATUS', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `Set status to ${status} for ${studentId}`),
      ]);

      return successResponse({ studentId, status }, `Student status updated to ${status}`);
    } catch (err) {
      return errorResponse(`Status update error: ${err.message}`, 500);
    }
  }

  // GET /api/admin/stats - Quick overview dashboard stats
  if (path === '/api/admin/stats' && method === 'GET') {
    const [pendingRegs, totalStudents, totalNotes, totalQuestions, activePolls] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as count FROM registrations WHERE review_status = 'pending'`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM profiles WHERE role = 'student'`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM notes`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM questions`).first(),
      env.DB.prepare(`SELECT COUNT(*) as count FROM polls`).first(),
    ]);

    return successResponse({
      stats: {
        pendingRegistrations: pendingRegs ? pendingRegs.count : 0,
        totalStudents: totalStudents ? totalStudents.count : 0,
        totalNotes: totalNotes ? totalNotes.count : 0,
        totalQuestions: totalQuestions ? totalQuestions.count : 0,
        totalPolls: activePolls ? activePolls.count : 0,
      }
    });
  }

  return errorResponse('Admin route not found', 404);
}
