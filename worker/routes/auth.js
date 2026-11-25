/**
 * VidyaSphere Authentication & Identity Engine (Students, Teachers & Admins)
 * Zero npm dependencies, 100% native Web Standards.
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import {
  generateId,
  generateSecureSessionToken,
  hashPassword,
  verifyPassword,
} from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';
import { formatUserProfile, parseStringList } from '../utils/teacherScope.js';

export async function handleAuthRoutes(request, env, path, method) {
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'local_client';

  // POST /api/auth/register - Direct account creation for Students & Teachers
  if (path === '/api/auth/register' && method === 'POST') {
    try {
      const rate = await checkRateLimit(env, `reg_${clientIp}`, 10, 60);
      if (!rate.allowed) {
        return errorResponse(`Too many registration attempts. Please wait ${rate.retryAfter} seconds.`, 429);
      }

      const body = await request.json();
      const {
        fullName,
        className = '',
        division = '',
        rollNumber = '',
        username,
        password,
        email = null,
        role = 'student',
        teacherType = null,
        assignedClasses = [],
        assignedSubjects = [],
        teacherDesignation = '',
        teacherInfo = '',
      } = body;

      const requestedRole = role === 'teacher' ? 'teacher' : 'student';
      if (role === 'admin') {
        return errorResponse('Admin accounts cannot be self-registered.', 403);
      }

      if (!fullName || !username || !password) {
        return errorResponse('Missing required fields: fullName, username, password', 400);
      }

      let finalClassName = String(className || '').trim();
      let finalDivision = String(division || '').trim().toUpperCase();
      let finalRollNumber = String(rollNumber || '').trim();
      let finalTeacherType = null;
      let cleanClasses = [];
      let cleanSubjects = [];
      let cleanDesignation = '';
      let cleanTeacherInfo = '';

      if (requestedRole === 'student') {
        if (!finalClassName || !finalDivision || !finalRollNumber) {
          return errorResponse('Missing required fields: className, division, rollNumber', 400);
        }
      } else {
        // Teacher onboarding validation (No Staff/Invite Code required)
        if (!['subject', 'class'].includes(teacherType)) {
          return errorResponse('Teacher Type must be "subject" (Subject Teacher) or "class" (Class Teacher).', 400);
        }
        finalTeacherType = teacherType;
        cleanClasses = parseStringList(assignedClasses);
        cleanSubjects = parseStringList(assignedSubjects);
        cleanDesignation = String(teacherDesignation || body.designation || '').trim().slice(0, 140);
        cleanTeacherInfo = String(teacherInfo || body.additionalInfo || body.bio || '').trim().slice(0, 600);

        if (finalTeacherType === 'class' && finalClassName && !cleanClasses.includes(finalClassName)) {
          cleanClasses.unshift(finalClassName);
        }
        if (cleanClasses.length === 0) {
          return errorResponse('Please select at least one assigned class.', 400);
        }
        if (cleanSubjects.length === 0) {
          return errorResponse('Please select at least one assigned subject.', 400);
        }
        if (!finalClassName) {
          finalClassName = cleanClasses[0];
        }
      }

      const cleanUsername = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
        return errorResponse('Username must be 3-20 characters long and contain only letters, numbers, or underscores.', 400);
      }

      if (password.length < 6) {
        return errorResponse('Password must be at least 6 characters long.', 400);
      }

      const existingUser = await env.DB.prepare(
        `SELECT id FROM profiles WHERE username = ?`
      ).bind(cleanUsername).first();

      if (existingUser) {
        return errorResponse('Username is already taken. Please choose another username.', 409);
      }

      const cleanEmail = email ? email.trim().toLowerCase() : null;
      const { hash: passwordHash, salt } = await hashPassword(password);
      const userId = generateId(requestedRole === 'teacher' ? 'tch' : 'usr', 8);

      await env.DB.prepare(
        `INSERT INTO profiles (
           id, username, password_hash, salt, full_name, class_name, division, roll_number,
           email, role, account_status, teacher_type, assigned_classes, assigned_subjects,
           teacher_designation, teacher_info, allow_student_dms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 1)`
      ).bind(
        userId,
        cleanUsername,
        passwordHash,
        salt,
        fullName.trim(),
        finalClassName,
        finalDivision,
        finalRollNumber,
        cleanEmail,
        requestedRole,
        finalTeacherType,
        JSON.stringify(cleanClasses),
        JSON.stringify(cleanSubjects),
        cleanDesignation,
        cleanTeacherInfo
      ).run();

      const sessionToken = generateSecureSessionToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

      await env.DB.prepare(
        `INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)`
      ).bind(sessionToken, userId, requestedRole, expiresAt).run();

      return successResponse(
        {
          token: sessionToken,
          isPending: true,
          user: {
            id: userId,
            username: cleanUsername,
            fullName: fullName.trim(),
            className: finalClassName,
            division: finalDivision,
            rollNumber: finalRollNumber,
            email: cleanEmail,
            role: requestedRole,
            accountStatus: 'pending',
            teacherType: finalTeacherType,
            assignedClasses: cleanClasses,
            assignedSubjects: cleanSubjects,
            teacherDesignation: cleanDesignation,
            teacherInfo: cleanTeacherInfo,
            allowStudentDms: true,
          }
        },
        `${requestedRole === 'teacher' ? 'Teacher' : 'Student'} account created! Your request is pending administrator approval.`,
        201
      );
    } catch (err) {
      return errorResponse(`Registration error: ${err.message}`, 500);
    }
  }

  // POST /api/auth/login - Universal student, teacher & admin login
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const rate = await checkRateLimit(env, `login_${clientIp}`, 15, 60);
      if (!rate.allowed) {
        return errorResponse(`Too many login attempts. Please wait ${rate.retryAfter} seconds.`, 429);
      }

      const body = await request.json();
      const { username, password } = body;

      if (!username || !password) {
        return errorResponse('Username and password are required', 400);
      }

      const cleanUsername = username.trim().toLowerCase();
      const user = await env.DB.prepare(
        `SELECT * FROM profiles WHERE username = ?`
      ).bind(cleanUsername).first();

      if (!user) {
        return errorResponse('Invalid username or password', 401);
      }

      const isPwValid = await verifyPassword(password, user.password_hash, user.salt);
      if (!isPwValid) {
        return errorResponse('Invalid username or password', 401);
      }

      if (user.account_status === 'suspended') {
        return errorResponse('Your account has been suspended by school administration. Please contact school office.', 403);
      }

      if (user.account_status === 'rejected') {
        return errorResponse(user.rejection_reason || 'Your registration request was rejected by school administration.', 403);
      }

      const sessionToken = generateSecureSessionToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

      await env.DB.prepare(
        `INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)`
      ).bind(sessionToken, user.id, user.role, expiresAt).run();

      const isPending = user.account_status === 'pending';

      return successResponse(
        {
          token: sessionToken,
          isPending,
          user: formatUserProfile(user),
        },
        isPending ? 'Logged in! Request is pending admin approval.' : 'Login successful'
      );
    } catch (err) {
      return errorResponse(`Login error: ${err.message}`, 500);
    }
  }

  // GET /api/auth/me - Real-time profile & live status verification
  if (path === '/api/auth/me' && method === 'GET') {
    const auth = await authenticate(request, env, [], true);
    if (auth.error) return auth.error;

    const profile = await env.DB.prepare(
      `SELECT id, username, full_name, class_name, division, roll_number, email, role, account_status,
              rejection_reason, is_root_admin, teacher_type, assigned_classes, assigned_subjects,
              teacher_designation, teacher_info, allow_student_dms
       FROM profiles WHERE id = ?`
    ).bind(auth.user.id).first();

    if (!profile) {
      return errorResponse('User profile not found or deleted', 404);
    }

    if (profile.account_status === 'suspended') {
      return errorResponse('Account suspended', 403);
    }

    return successResponse({ user: formatUserProfile(profile) });
  }

  // PUT /api/auth/change-password - Secure self-service password update
  if (path === '/api/auth/change-password' && (method === 'PUT' || method === 'POST')) {
    const auth = await authenticate(request, env, [], true);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return errorResponse('Current password and new password are required', 400);
      }
      if (String(newPassword).length < 6) {
        return errorResponse('New password must be at least 6 characters long', 400);
      }

      const row = await env.DB.prepare(
        `SELECT password_hash, salt FROM profiles WHERE id = ?`
      ).bind(auth.user.id).first();

      if (!row) return errorResponse('Account not found', 404);

      const valid = await verifyPassword(currentPassword, row.password_hash, row.salt);
      if (!valid) {
        return errorResponse('Current password is incorrect', 401);
      }

      const { hash, salt } = await hashPassword(newPassword);
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE profiles SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(hash, salt, auth.user.id),
        env.DB.prepare(
          `INSERT INTO audit_logs (id, action, actor_id, details) VALUES (?, 'PASSWORD_CHANGED', ?, ?)`
        ).bind(generateId('log', 8), auth.user.id, `User @${auth.user.username} changed password`),
      ]);

      return successResponse({}, 'Password updated successfully!');
    } catch (err) {
      return errorResponse(`Password change error: ${err.message}`, 500);
    }
  }

  // PUT /api/auth/profile - Update own optional email / teacher bio & designation
  if (path === '/api/auth/profile' && (method === 'PUT' || method === 'POST')) {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const email = body.email !== undefined ? (body.email ? String(body.email).trim().toLowerCase() : null) : undefined;
      const teacherDesignation = body.teacherDesignation !== undefined ? String(body.teacherDesignation || '').trim().slice(0, 140) : undefined;
      const teacherInfo = body.teacherInfo !== undefined ? String(body.teacherInfo || '').trim().slice(0, 600) : undefined;

      const row = await env.DB.prepare(`SELECT * FROM profiles WHERE id = ?`).bind(auth.user.id).first();
      if (!row) return errorResponse('Profile not found', 404);

      const nextEmail = email !== undefined ? email : row.email;
      const nextDesig = teacherDesignation !== undefined ? teacherDesignation : (row.teacher_designation || '');
      const nextInfo = teacherInfo !== undefined ? teacherInfo : (row.teacher_info || '');

      await env.DB.prepare(
        `UPDATE profiles SET email = ?, teacher_designation = ?, teacher_info = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(nextEmail, nextDesig, nextInfo, auth.user.id).run();

      const updated = await env.DB.prepare(`SELECT * FROM profiles WHERE id = ?`).bind(auth.user.id).first();
      return successResponse({ user: formatUserProfile(updated) }, 'Profile updated successfully!');
    } catch (err) {
      return errorResponse(`Profile update error: ${err.message}`, 500);
    }
  }

  // PUT /api/auth/preferences - Update user privacy settings (e.g., Teacher Allow Student DMs)
  if (path === '/api/auth/preferences' && (method === 'PUT' || method === 'POST')) {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const allowStudentDms = body.allowStudentDms === false || body.allowStudentDms === 0 ? 0 : 1;

      await env.DB.prepare(
        `UPDATE profiles SET allow_student_dms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(allowStudentDms, auth.user.id).run();

      return successResponse(
        { allowStudentDms: allowStudentDms === 1 },
        `Student direct messages ${allowStudentDms === 1 ? 'enabled' : 'disabled'}`
      );
    } catch (err) {
      return errorResponse(`Preferences error: ${err.message}`, 500);
    }
  }

  // POST /api/auth/logout - Invalidate session
  if (path === '/api/auth/logout' && method === 'POST') {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    }
    return successResponse({}, 'Successfully logged out');
  }

  return errorResponse('Auth endpoint not found', 404);
}
