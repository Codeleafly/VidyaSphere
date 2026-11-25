/**
 * Student & Faculty Directory Routes
 * Accessible to all active students, teachers, and administrators
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { authenticate } from '../auth/middleware.js';

export async function handleStudentsRoutes(request, env, path, method) {
  const auth = await authenticate(request, env);
  if (auth.error) return auth.error;

  // GET /api/students - Search and list active school members (students, teachers, admins)
  if (path === '/api/students' && method === 'GET') {
    const url = new URL(request.url);
    const search = (url.searchParams.get('search') || '').trim();
    const className = (url.searchParams.get('className') || '').trim();
    const roleFilter = (url.searchParams.get('role') || '').trim();

    let query = `
      SELECT id, username, full_name, class_name, division, roll_number, role,
             teacher_type, assigned_classes, assigned_subjects, allow_student_dms,
             account_status, is_root_admin, created_at
      FROM profiles
      WHERE account_status = 'active'
    `;
    const params = [];

    if (search) {
      query += ` AND (full_name LIKE ? OR username LIKE ? OR roll_number LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (className) {
      query += ` AND (class_name = ? OR assigned_classes LIKE ?)`;
      params.push(className, `%${className}%`);
    }
    if (roleFilter) {
      query += ` AND role = ?`;
      params.push(roleFilter);
    }

    query += ` ORDER BY is_root_admin DESC, (CASE role WHEN 'admin' THEN 0 WHEN 'teacher' THEN 1 ELSE 2 END), class_name ASC, division ASC, CAST(roll_number AS INTEGER) ASC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ students: results || [] });
  }

  return errorResponse(`Method ${method} not allowed on ${path}`, 405);
}
