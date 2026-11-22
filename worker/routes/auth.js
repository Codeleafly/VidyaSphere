/**
 * VidyaSphere Re-Architected Authentication & Identity Engine
 * Zero npm dependencies, 100% native Web Standards.
 * 
 * Flow:
 * 1. Student registers with personal details, chooses username, and SETS PASSWORD immediately.
 * 2. Account is created in profiles with account_status = 'pending'.
 * 3. Student can log in immediately; pending screen informs that admin approval is awaited.
 * 4. Admin approves with 1 click; status becomes 'active'. Student portal unlocks automatically without any code!
 */

import { jsonResponse, errorResponse, successResponse } from '../utils/response.js';
import { checkRateLimit } from '../utils/rateLimit.js';
import {
  generateId,
  generateSecureSessionToken,
  hashPassword,
  verifyPassword,
} from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleAuthRoutes(request, env, path, method) {
  const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'local_client';

  // POST /api/auth/register - Direct account creation with password
  if (path === '/api/auth/register' && method === 'POST') {
    try {
      const rate = await checkRateLimit(env, `reg_${clientIp}`, 10, 60);
      if (!rate.allowed) {
        return errorResponse(`Too many registration attempts. Please wait ${rate.retryAfter} seconds.`, 429);
      }

      const body = await request.json();
      const {
        fullName,
        className,
        division,
        rollNumber,
        username,
        password,
        email = null
      } = body;

      if (!fullName || !className || !division || !rollNumber || !username || !password) {
        return errorResponse('Missing required fields: fullName, className, division, rollNumber, username, password', 400);
      }

      // Username normalization & validation (3 to 20 chars, lowercase alphanumeric + underscores)
      const cleanUsername = username.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUsername)) {
        return errorResponse('Username must be 3-20 characters long and contain only letters, numbers, or underscores.', 400);
      }

      // Password length check
      if (password.length < 6) {
        return errorResponse('Password must be at least 6 characters long.', 400);
      }

      // Check unique username
      const existingUser = await env.DB.prepare(
        `SELECT id FROM profiles WHERE username = ?`
      ).bind(cleanUsername).first();

      if (existingUser) {
        return errorResponse('Username is already taken. Please choose another username.', 409);
      }

      const cleanEmail = email ? email.trim().toLowerCase() : null;
      const { hash: passwordHash, salt } = await hashPassword(password);
      const userId = generateId('usr', 8);

      await env.DB.prepare(
        `INSERT INTO profiles (id, username, password_hash, salt, full_name, class_name, division, roll_number, email, role, account_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'student', 'pending')`
      ).bind(
        userId,
        cleanUsername,
        passwordHash,
        salt,
        fullName.trim(),
        className.trim(),
        division.trim().toUpperCase(),
        rollNumber.trim(),
        cleanEmail
      ).run();

      // Issue session token so student is logged in immediately in pending state
      const sessionToken = generateSecureSessionToken();
      const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

      await env.DB.prepare(
        `INSERT INTO sessions (token, user_id, role, expires_at) VALUES (?, ?, 'student', ?)`
      ).bind(sessionToken, userId, expiresAt).run();

      return successResponse(
        {
          token: sessionToken,
          isPending: true,
          user: {
            id: userId,
            username: cleanUsername,
            fullName: fullName.trim(),
            className: className.trim(),
            division: division.trim().toUpperCase(),
            rollNumber: rollNumber.trim(),
            email: cleanEmail,
            role: 'student',
            accountStatus: 'pending'
          }
        },
        'Account created successfully! Your request is pending school administrator approval.',
        201
      );
    } catch (err) {
      return errorResponse(`Registration error: ${err.message}`, 500);
    }
  }

  // POST /api/auth/login - Universal student & admin login
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

      // Check account status
      if (user.account_status === 'suspended') {
        return errorResponse('Your account has been suspended by school administration. Please contact school office.', 403);
      }

      if (user.account_status === 'rejected') {
        return errorResponse(user.rejection_reason || 'Your admission request was rejected by school administration.', 403);
      }

      // Generate session token (30 days validity)
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
          user: {
            id: user.id,
            username: user.username,
            fullName: user.full_name,
            className: user.class_name,
            division: user.division,
            rollNumber: user.roll_number,
            email: user.email,
            role: user.role,
            accountStatus: user.account_status,
            isRootAdmin: user.is_root_admin === 1 || user.username === 'admin',
          }
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

    // Fetch live profile from DB so pending -> active switch is reflected instantly
    const profile = await env.DB.prepare(
      `SELECT id, username, full_name, class_name, division, roll_number, email, role, account_status, rejection_reason, is_root_admin
       FROM profiles WHERE id = ?`
    ).bind(auth.user.id).first();

    if (!profile) {
      return errorResponse('User profile not found or deleted', 404);
    }

    if (profile.account_status === 'suspended') {
      return errorResponse('Account suspended', 403);
    }

    const isRootAdmin = profile.is_root_admin === 1 || profile.username === 'admin';

    return successResponse({
      user: {
        id: profile.id,
        username: profile.username,
        fullName: profile.full_name,
        className: profile.class_name,
        division: profile.division,
        rollNumber: profile.roll_number,
        email: profile.email,
        role: profile.role,
        accountStatus: profile.account_status,
        rejectionReason: profile.rejection_reason || null,
        isRootAdmin,
      }
    });
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
