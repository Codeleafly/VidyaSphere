/**
 * Study Groups & Consent-First Membership Routes
 */

import { errorResponse, successResponse } from '../../utils/response.js';
import { generateId } from '../../auth/crypto.js';
import { authenticate } from '../../auth/middleware.js';

async function findActiveStudent(env, cleanTarget, className) {
  const cleanUsername = cleanTarget.replace(/^@/, '').toLowerCase();

  let target = await env.DB.prepare(
    `SELECT * FROM profiles WHERE id = ? AND account_status = 'active'`
  ).bind(cleanTarget).first();

  if (!target) {
    target = await env.DB.prepare(
      `SELECT * FROM profiles WHERE LOWER(username) = ? AND account_status = 'active'`
    ).bind(cleanUsername).first();
  }

  if (!target && /^\d+$/.test(cleanTarget)) {
    if (className && className !== 'all') {
      target = await env.DB.prepare(
        `SELECT * FROM profiles WHERE roll_number = ? AND class_name = ? AND account_status = 'active'`
      ).bind(cleanTarget, className).first();
    }
    if (!target) {
      target = await env.DB.prepare(
        `SELECT * FROM profiles WHERE roll_number = ? AND account_status = 'active'`
      ).bind(cleanTarget).first();
    }
  }

  if (!target) {
    target = await env.DB.prepare(
      `SELECT * FROM profiles WHERE LOWER(full_name) = ? AND account_status = 'active'`
    ).bind(cleanTarget.toLowerCase()).first();
  }

  return target;
}

export async function handleGroupRoutes(request, env, path, method) {
  // GET /api/chat/groups - List study groups for current user
  if (path === '/api/chat/groups' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const { results } = await env.DB.prepare(`
      SELECT g.*, gm.role as my_role, gm.invite_status,
             p.full_name as creator_name, p.username as creator_username,
             p.class_name as creator_class, p.division as creator_division, p.roll_number as creator_roll,
             (SELECT COUNT(*) FROM group_members WHERE group_id = g.id AND invite_status = 'accepted') as member_count
      FROM chat_groups g
      JOIN group_members gm ON g.id = gm.group_id
      JOIN profiles p ON g.creator_id = p.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `).bind(auth.user.id).all();

    return successResponse({ groups: results || [] });
  }

  // POST /api/chat/groups - Create study group
  if (path === '/api/chat/groups' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { name, description = '', className = 'all' } = body;

      if (!name || name.trim().length < 2) {
        return errorResponse('Group name must be at least 2 characters long', 400);
      }

      const groupId = generateId('grp', 8);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO chat_groups (id, name, description, class_name, creator_id)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(groupId, name.trim(), description.trim(), className, auth.user.id),
        env.DB.prepare(
          `INSERT INTO group_members (group_id, user_id, role, invite_status)
           VALUES (?, ?, 'admin', 'accepted')`
        ).bind(groupId, auth.user.id)
      ]);

      return successResponse({ id: groupId, name: name.trim() }, 'Study group created successfully!', 201);
    } catch (err) {
      return errorResponse(`Create group error: ${err.message}`, 500);
    }
  }

  // GET /api/chat/groups/:id/members
  if (path.startsWith('/api/chat/groups/') && path.endsWith('/members') && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const groupId = path.split('/')[4];
    const callerMember = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).first();

    if (!callerMember && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You are not a member of this study group', 403);
    }

    const { results } = await env.DB.prepare(`
      SELECT gm.group_id, gm.user_id, gm.role as member_role, gm.invite_status,
             strftime('%Y-%m-%dT%H:%M:%SZ', gm.joined_at) as joined_at,
             p.username, p.full_name, p.class_name, p.division, p.roll_number, p.is_root_admin
      FROM group_members gm
      JOIN profiles p ON gm.user_id = p.id
      WHERE gm.group_id = ?
      ORDER BY (CASE WHEN gm.role = 'admin' THEN 0 ELSE 1 END), (CASE WHEN gm.invite_status = 'accepted' THEN 0 ELSE 1 END), p.full_name ASC
    `).bind(groupId).all();

    return successResponse({ members: results || [] });
  }

  // POST /api/chat/groups/:id/members - Invite classmate
  if (path.startsWith('/api/chat/groups/') && path.endsWith('/members') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const groupId = path.split('/')[4];
    const group = await env.DB.prepare(`SELECT * FROM chat_groups WHERE id = ?`).bind(groupId).first();
    if (!group) return errorResponse('Study group not found', 404);

    const callerMember = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ? AND invite_status = 'accepted'`
    ).bind(groupId, auth.user.id).first();

    if (!callerMember && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only active study group members can add classmates', 403);
    }

    try {
      const body = await request.json();
      const { targetUserId, targetUsername, targetRollNumber, query } = body;
      const cleanTarget = (targetUserId || targetUsername || targetRollNumber || query || '').toString().trim();

      if (!cleanTarget) {
        return errorResponse('Please enter a roll number, username, or select a student', 400);
      }

      const targetUser = await findActiveStudent(env, cleanTarget, group.class_name);
      if (!targetUser) {
        return errorResponse(`Student "${cleanTarget}" not found. Verify the roll number or username.`, 404);
      }

      const existing = await env.DB.prepare(
        `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
      ).bind(groupId, targetUser.id).first();

      const memberPayload = {
        id: targetUser.id,
        username: targetUser.username,
        fullName: targetUser.full_name,
        className: targetUser.class_name,
        division: targetUser.division,
        rollNumber: targetUser.roll_number,
        role: 'member',
        inviteStatus: 'pending'
      };

      if (existing) {
        if (existing.invite_status === 'accepted') {
          return errorResponse(`${targetUser.full_name} is already an active member of this study group`, 400);
        }
        if (existing.invite_status === 'pending') {
          return errorResponse(`An invitation has already been sent to ${targetUser.full_name} and is awaiting approval`, 400);
        }
        await env.DB.prepare(
          `UPDATE group_members SET invite_status = 'pending' WHERE group_id = ? AND user_id = ?`
        ).bind(groupId, targetUser.id).run();
        return successResponse({ member: memberPayload }, `Invitation re-sent to ${targetUser.full_name}!`, 201);
      }

      await env.DB.prepare(
        `INSERT INTO group_members (group_id, user_id, role, invite_status) VALUES (?, ?, 'member', 'pending')`
      ).bind(groupId, targetUser.id).run();

      return successResponse(
        { member: memberPayload },
        `Invitation sent to ${targetUser.full_name}! They can accept to join.`,
        201
      );
    } catch (err) {
      return errorResponse(`Add member error: ${err.message}`, 500);
    }
  }

  // POST /api/chat/groups/:id/accept
  if (path.startsWith('/api/chat/groups/') && path.endsWith('/accept') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const groupId = path.split('/')[4];
    const membership = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).first();

    if (!membership) return errorResponse('Group invitation not found or you were not invited', 404);

    await env.DB.prepare(
      `UPDATE group_members SET invite_status = 'accepted', joined_at = CURRENT_TIMESTAMP WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).run();

    return successResponse({ groupId, inviteStatus: 'accepted' }, 'Group invitation accepted! Welcome to the group.');
  }

  // POST /api/chat/groups/:id/decline
  if (path.startsWith('/api/chat/groups/') && path.endsWith('/decline') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const groupId = path.split('/')[4];
    await env.DB.prepare(
      `DELETE FROM group_members WHERE group_id = ? AND user_id = ? AND invite_status = 'pending'`
    ).bind(groupId, auth.user.id).run();

    return successResponse({ groupId, inviteStatus: 'declined' }, 'Group invitation declined.');
  }

  // DELETE /api/chat/groups/:id/members/:userId
  if (path.startsWith('/api/chat/groups/') && path.includes('/members/') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const groupId = parts[4];
    const targetUserId = parts[6];

    const group = await env.DB.prepare(`SELECT * FROM chat_groups WHERE id = ?`).bind(groupId).first();
    if (!group) return errorResponse('Study group not found', 404);

    const callerMember = await env.DB.prepare(
      `SELECT * FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, auth.user.id).first();

    if (!callerMember && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You are not a member of this group', 403);
    }

    const isSelfLeaving = targetUserId === auth.user.id;
    const isGroupAdmin = callerMember && callerMember.role === 'admin';
    const isSystemAdmin = auth.user.role === 'admin';

    if (!isSelfLeaving && !isGroupAdmin && !isSystemAdmin) {
      return errorResponse('Forbidden: Only group admins can remove other members', 403);
    }

    await env.DB.prepare(
      `DELETE FROM group_members WHERE group_id = ? AND user_id = ?`
    ).bind(groupId, targetUserId).run();

    return successResponse({ groupId, userId: targetUserId }, isSelfLeaving ? 'You left the study group' : 'Member removed from group');
  }

  // DELETE /api/chat/groups/:id
  if (path.startsWith('/api/chat/groups/') && !path.includes('/members') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const groupId = path.split('/')[4];
    const group = await env.DB.prepare(`SELECT * FROM chat_groups WHERE id = ?`).bind(groupId).first();
    if (!group) return errorResponse('Study group not found', 404);

    if (group.creator_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: Only the group creator or admin can delete the study group', 403);
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE channel = ?)`).bind(`grp_${groupId}`),
      env.DB.prepare(`DELETE FROM group_members WHERE group_id = ?`).bind(groupId),
      env.DB.prepare(`DELETE FROM messages WHERE channel = ?`).bind(`grp_${groupId}`),
      env.DB.prepare(`DELETE FROM chat_groups WHERE id = ?`).bind(groupId)
    ]);

    return successResponse({ groupId }, 'Study group deleted');
  }

  return null;
}
