/**
 * Auth Routes: Registration, Tracking, Activation, Login, Profile
 * Pure Cloudflare D1 + Web Crypto
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import {
  generateId,
  generateSecureSessionToken,
  timingSafeEqual,
  hashPassword,
  verifyPassword,
  sha256,
} from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleAuthRoutes(request, env, path, method) {
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'local_client';

  // POST /api/auth/register - Student admission queue submission
  if (path === '/api/auth/register' && method === 'POST') {
    try {
      // Production Rate Limiting (Max 5 registration requests per minute per IP)
      const rate = await checkRateLimit(env, `reg_${clientIp}`, 5, 60);
      if (!rate.allowed) {
        return errorResponse(`Too many registration requests. Please wait ${rate.retryAfter} seconds.`, 429);
      }

      const body = await request.json();
      const { fullName, className, division, rollNumber, reason } = body;

      if (!fullName || !className || !division || !rollNumber) {
        return errorResponse('Missing required fields: fullName, className, division, rollNumber');
      }

      const trackingToken = generateId('track', 12);

      await env.DB.prepare(
        `INSERT INTO registrations (tracking_token, full_name, class_name, division, roll_number, reason, review_status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`
      )
        .bind(trackingToken, fullName.trim(), className.trim(), division.trim().toUpperCase(), rollNumber.trim(), (reason || '').trim())
        .run();

      return successResponse(
        {
          trackingToken,
          status: 'pending',
          fullName: fullName.trim(),
          className: className.trim(),
          division: division.trim().toUpperCase(),
          rollNumber: rollNumber.trim()
        },
        'Registration submitted successfully! Please save your tracking token to check status.',
        201
      );
    } catch (err) {
      return errorResponse(`Registration error: ${err.message}`, 500);
    }
  }

  // GET /api/auth/status?token=... - Check registration status
  if (path === '/api/auth/status' && method === 'GET') {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return errorResponse('tracking token is required');
    }

    const reg = await env.DB.prepare(
      `SELECT * FROM registrations WHERE tracking_token = ?`
    )
      .bind(token.trim())
      .first();

    if (!reg) {
      return errorResponse('Registration not found with provided tracking token', 404);
    }

    let activationInfo = null;
    if (reg.review_status === 'approved') {
      const codeRecord = await env.DB.prepare(
        `SELECT id, assigned_username, expires_at, is_used FROM activation_codes 
         WHERE tracking_token = ? 
         ORDER BY created_at DESC LIMIT 1`
      )
        .bind(token.trim())
        .first();

      if (codeRecord) {
        activationInfo = {
          assignedUsername: codeRecord.assigned_username,
          expiresAt: codeRecord.expires_at,
          canActivate: codeRecord.is_used === 0,
          isUsed: codeRecord.is_used === 1,
        };
      }
    }

    return successResponse({
      trackingToken: reg.tracking_token,
      fullName: reg.full_name,
      className: reg.class_name,
      division: reg.division,
      rollNumber: reg.roll_number,
      reviewStatus: reg.review_status,
      reviewReason: reg.review_reason,
      createdAt: reg.created_at,
      activation: activationInfo,
    });
  }

  // POST /api/auth/activate - Activate account using activation code and set password
  if (path === '/api/auth/activate' && method === 'POST') {
    try {
      const body = await request.json();
      const { code, password } = body;

      if (!code || !password) {
        return errorResponse('Activation code and new password are required');
      }

      if (password.length < 6) {
        return errorResponse('Password must be at least 6 characters long');
      }

      const cleanCode = code.trim().toUpperCase();
      const codeHash = await sha256(cleanCode);

      const codeRow = await env.DB.prepare(
        `SELECT ac.*, r.full_name, r.class_name, r.division, r.roll_number
         FROM activation_codes ac
         JOIN registrations r ON ac.tracking_token = r.tracking_token
         WHERE ac.code_hash = ? AND ac.is_used = 0`
      )
        .bind(codeHash)
        .first();

      if (!codeRow) {
        return errorResponse('Invalid or already used activation code', 400);
      }

      const now = new Date().toISOString();
      if (new Date(codeRow.expires_at) < new Date(now)) {
        return errorResponse('Activation code has expired. Please contact admin.', 400);
      }

      const userId = generateId('usr', 12);
      const { hash: passwordHash, salt } = await hashPassword(password);

      const sessionToken = generateSecureSessionToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      // Atomic batch to create profile, mark activation code used, and create secure session
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO profiles (id, username, password_hash, salt, full_name, class_name, division, roll_number, role, account_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'student', 'active')`
        ).bind(
          userId,
          codeRow.assigned_username,
          passwordHash,
          salt,
          codeRow.full_name,
          codeRow.class_name,
          codeRow.division,
          codeRow.roll_number
        ),
        env.DB.prepare(
          `UPDATE activation_codes SET is_used = 1 WHERE id = ?`
        ).bind(codeRow.id),
        env.DB.prepare(
          `INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, 'student', ?)`
        ).bind(sessionToken, userId, expiresAt),
      ]);

      return successResponse(
        {
          token: sessionToken,
          user: {
            id: userId,
            username: codeRow.assigned_username,
            fullName: codeRow.full_name,
            role: 'student',
            className: codeRow.class_name,
            division: codeRow.division,
            rollNumber: codeRow.roll_number,
          },
        },
        'Account successfully activated! Welcome to VidyaSphere.'
      );
    } catch (err) {
      return errorResponse(`Activation error: ${err.message}`, 500);
    }
  }

  // POST /api/auth/login - Unified Student, Teacher, Admin Login
  if (path === '/api/auth/login' && method === 'POST') {
    try {
      const body = await request.json();
      const { username, password } = body;

      if (!username || !password) {
        return errorResponse('Username and password are required');
      }

      // Production Rate Limiting on Login (Max 5 attempts per 60 seconds per IP & Username)
      const loginRate = await checkRateLimit(env, `login_${clientIp}_${username.trim().toLowerCase()}`, 5, 60);
      if (!loginRate.allowed) {
        return errorResponse(`Too many login attempts. Please wait ${loginRate.retryAfter} seconds.`, 429);
      }

      const user = await env.DB.prepare(
        `SELECT * FROM profiles WHERE username = ?`
      )
        .bind(username.trim().toLowerCase())
        .first();

      if (!user) {
        return errorResponse('Invalid username or password', 401);
      }

      if (user.account_status !== 'active') {
        return errorResponse(`Account is ${user.account_status}. Please contact school office.`, 403);
      }

      let isValid = false;
      const configuredAdminPass = env.ADMIN_PASSWORD;
      if (user.role === 'admin' && configuredAdminPass) {
        isValid = timingSafeEqual(password, configuredAdminPass);
      }
      if (!isValid) {
        isValid = await verifyPassword(password, user.password_hash, user.salt);
      }

      if (!isValid) {
        return errorResponse('Invalid username or password', 401);
      }

      // Generate 256-bit secure random session token
      const sessionToken = generateSecureSessionToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

      await env.DB.prepare(
        `INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, ?, ?)`
      ).bind(sessionToken, user.id, user.role, expiresAt).run();

      return successResponse({
        token: sessionToken,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          role: user.role,
          className: user.class_name,
          division: user.division,
          rollNumber: user.roll_number,
        },
      }, 'Logged in successfully');
    } catch (err) {
      return errorResponse(`Login error: ${err.message}`, 500);
    }
  }

  // POST /api/auth/logout - Invalidate session token
  if (path === '/api/auth/logout' && method === 'POST') {
    const authHeader = request.headers.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    }
    return successResponse({}, 'Logged out successfully');
  }

  // GET /api/auth/me - Current user session profile
  if (path === '/api/auth/me' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const user = await env.DB.prepare(
      `SELECT id, username, full_name, class_name, division, roll_number, role, account_status, created_at
       FROM profiles WHERE id = ?`
    )
      .bind(auth.user.id)
      .first();

    if (!user) return errorResponse('User profile not found', 404);

    return successResponse({ user });
  }

  // PUT /api/auth/change-password
  if (path === '/api/auth/change-password' && method === 'PUT') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { currentPassword, newPassword } = body;

      if (!currentPassword || !newPassword) {
        return errorResponse('Current and new password are required');
      }

      if (newPassword.length < 6) {
        return errorResponse('New password must be at least 6 characters long');
      }

      const user = await env.DB.prepare(
        `SELECT password_hash, salt FROM profiles WHERE id = ?`
      )
        .bind(auth.user.id)
        .first();

      const isValid = await verifyPassword(currentPassword, user.password_hash, user.salt);
      if (!isValid) {
        return errorResponse('Incorrect current password', 400);
      }

      const { hash: newHash, salt: newSalt } = await hashPassword(newPassword);

      await env.DB.prepare(
        `UPDATE profiles SET password_hash = ?, salt = ? WHERE id = ?`
      )
        .bind(newHash, newSalt, auth.user.id)
        .run();

      return successResponse({}, 'Password updated successfully');
    } catch (err) {
      return errorResponse(`Change password error: ${err.message}`, 500);
    }
  }

  return errorResponse('Auth route not found', 404);
}
