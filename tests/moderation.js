/**
 * Verification Modules 45-50:
 * - 30-Day Notice Auto-Expiry & Manual Delete (Lead + Secondary Admin)
 * - Secondary Admin Chat Moderation vs Lead Admin Superiority
 * - Strict Personal DM & Unjoined Study Group Privacy (Even from Lead Admin)
 */

function assertCheck(label, condition) {
  console.log(`✓ [${label}]:`, condition ? 'PASS' : 'FAIL');
  if (!condition) {
    throw new Error(`Verification failed: ${label}`);
  }
}

async function req(worker, mockEnv, path, method = 'GET', token = null, body = null) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  return await worker.fetch(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }), mockEnv);
}

export async function runModerationAndNoticeTests({ worker, mockEnv, db, adminToken, studentId }) {
  // Register and approve a second student (Priya) and promote existing student Aarav to Secondary Admin
  const rReg2 = await req(worker, mockEnv, '/api/auth/register', 'POST', null, {
    fullName: 'Priya Sharma',
    className: 'Class 10',
    division: 'A',
    rollNumber: '22',
    username: 'priya_10a_22',
    password: 'priyaPassword123'
  });
  const dReg2 = await rReg2.json();
  const priyaId = dReg2.user.id;
  await req(worker, mockEnv, '/api/admin/approve', 'POST', adminToken, { userId: priyaId });
  const rPriyaLogin = await req(worker, mockEnv, '/api/auth/login', 'POST', null, {
    username: 'priya_10a_22',
    password: 'priyaPassword123'
  });
  const priyaToken = (await rPriyaLogin.json()).token;

  await req(worker, mockEnv, '/api/admin/change-role', 'POST', adminToken, { userId: studentId, newRole: 'admin' });
  const rSecLogin = await req(worker, mockEnv, '/api/auth/login', 'POST', null, {
    username: 'aarav_10a_21',
    password: 'studentSecurePassword123'
  });
  const secAdminToken = (await rSecLogin.json()).token;

  // 45. Notices: Both Lead Admin & Secondary Admin can publish (30-day expiry) and delete notices
  const rLeadAnn = await req(worker, mockEnv, '/api/admin/announcements', 'POST', adminToken, {
    title: 'Diwali Vacation Circular',
    content: 'School closed for 5 days.',
    priority: 'holiday',
    targetClass: 'all'
  });
  const dLeadAnn = await rLeadAnn.json();
  const rSecAnn = await req(worker, mockEnv, '/api/admin/announcements', 'POST', secAdminToken, {
    title: 'Science Club Holiday Workshop',
    content: 'Optional session on Friday.',
    priority: 'general',
    targetClass: 'Class 10'
  });
  const dSecAnn = await rSecAnn.json();

  const rSecDelLeadAnn = await req(worker, mockEnv, `/api/admin/announcements/${dLeadAnn.id}`, 'DELETE', secAdminToken);
  const rLeadDelSecAnn = await req(worker, mockEnv, `/api/admin/announcements/${dSecAnn.id}`, 'DELETE', adminToken);
  assertCheck(
    'Phase 1 - Notice 30-Day Expiry Set & Manual Delete (Lead + Sec Admin)',
    rLeadAnn.status === 201 && Boolean(dLeadAnn.expiresAt) && rSecDelLeadAnn.status === 200 && rLeadDelSecAnn.status === 200
  );

  // 46. Notices: 1-Month (30-Day) Auto-Expiry Hide & Cron Purge
  db.prepare(`
    INSERT INTO announcements (id, title, content, priority, target_class, author_id, expires_at, created_at)
    VALUES ('ann_exp_1', 'Old Holiday Notice', 'Expired by expires_at', 'holiday', 'all', 'admin-root-001', datetime('now', '-1 day'), datetime('now', '-31 days'))
  `).run();
  db.prepare(`
    INSERT INTO announcements (id, title, content, priority, target_class, author_id, expires_at, created_at)
    VALUES ('ann_exp_2', 'Legacy 31-Day Notice', 'Expired by created_at', 'general', 'all', 'admin-root-001', NULL, datetime('now', '-31 days'))
  `).run();

  const rAnnList = await req(worker, mockEnv, '/api/announcements');
  const dAnnList = await rAnnList.json();
  const leakedExpired = (dAnnList.announcements || []).some(a => a.id === 'ann_exp_1' || a.id === 'ann_exp_2');

  await worker.scheduled({}, mockEnv);
  const remainingExpired = db.prepare(`SELECT COUNT(*) as c FROM announcements WHERE id IN ('ann_exp_1', 'ann_exp_2')`).get();
  assertCheck('Phase 1 - Notice 30-Day Auto-Expiry & Cron Purge', !leakedExpired && remainingExpired.c === 0);

  // 47. Secondary Admin CAN delete another user's public chat message
  const rPriyaPublic = await req(worker, mockEnv, '/api/chat/messages', 'POST', priyaToken, {
    channel: 'school',
    content: 'Spam link from student'
  });
  const priyaPublicId = (await rPriyaPublic.json()).id;
  const rSecDelPriya = await req(worker, mockEnv, `/api/chat/messages/${priyaPublicId}`, 'DELETE', secAdminToken);
  assertCheck('Moderation - Secondary Admin Deletes Other User Public Chat (200)', rSecDelPriya.status === 200);

  // 48. Lead Admin Power Superiority: Secondary Admin CANNOT delete Lead Admin message, Lead Admin CAN delete Secondary Admin message
  const rLeadPublic = await req(worker, mockEnv, '/api/chat/messages', 'POST', adminToken, {
    channel: 'school',
    content: 'Official Lead Admin directive'
  });
  const leadPublicId = (await rLeadPublic.json()).id;
  const rSecAttackLeadMsg = await req(worker, mockEnv, `/api/chat/messages/${leadPublicId}`, 'DELETE', secAdminToken);

  const rSecPublic = await req(worker, mockEnv, '/api/chat/messages', 'POST', secAdminToken, {
    channel: 'school',
    content: 'Secondary admin post'
  });
  const secPublicId = (await rSecPublic.json()).id;
  const rLeadDelSecMsg = await req(worker, mockEnv, `/api/chat/messages/${secPublicId}`, 'DELETE', adminToken);
  assertCheck(
    'Moderation Hierarchy - Lead Admin Chat Protected from Sec Admin (403)',
    rSecAttackLeadMsg.status === 403 && rLeadDelSecMsg.status === 200
  );

  // 49. Personal DM Privacy: Even Lead Root Admin CANNOT read, download, or delete someone else's DM
  const rDmReq = await req(worker, mockEnv, '/api/chat/dms/request', 'POST', secAdminToken, { targetUsername: 'priya_10a_22' });
  const dmId = (await rDmReq.json()).id;
  await req(worker, mockEnv, `/api/chat/dms/${dmId}/accept`, 'POST', priyaToken);

  const secretB64 = btoa('Private personal DM attachment');
  const rDmMsg = await req(worker, mockEnv, '/api/chat/messages', 'POST', priyaToken, {
    channel: `dm_${dmId}`,
    content: 'Private personal conversation',
    fileName: 'personal.txt',
    fileType: 'text/plain',
    fileBase64: secretB64
  });
  const priyaDmMsgId = (await rDmMsg.json()).id;

  const rLeadReadDm = await req(worker, mockEnv, `/api/chat/messages?channel=dm_${dmId}`, 'GET', adminToken);
  const rLeadDmAtt = await req(worker, mockEnv, `/api/chat/attachments/${priyaDmMsgId}`, 'GET', adminToken);
  const rLeadDelDm = await req(worker, mockEnv, `/api/chat/messages/${priyaDmMsgId}`, 'DELETE', adminToken);
  assertCheck(
    'Strict DM Privacy - Even Lead Admin Blocked from Personal Chats (403)',
    rLeadReadDm.status === 403 && rLeadDmAtt.status === 403 && rLeadDelDm.status === 403
  );

  // 50. Private Study Group Privacy: Even Lead Root Admin CANNOT inspect/read/delete unjoined private group
  const rPrivGrp = await req(worker, mockEnv, '/api/chat/groups', 'POST', priyaToken, {
    name: 'Priya Secret Notes Group',
    description: 'Private peer group'
  });
  const privGrpId = (await rPrivGrp.json()).id;
  const rPrivGrpMsg = await req(worker, mockEnv, '/api/chat/messages', 'POST', priyaToken, {
    channel: `grp_${privGrpId}`,
    content: 'Private group message'
  });
  const privGrpMsgId = (await rPrivGrpMsg.json()).id;

  const rLeadGrpMsgs = await req(worker, mockEnv, `/api/chat/messages?channel=grp_${privGrpId}`, 'GET', adminToken);
  const rLeadGrpMembers = await req(worker, mockEnv, `/api/chat/groups/${privGrpId}/members`, 'GET', adminToken);
  const rLeadDelGrpMsg = await req(worker, mockEnv, `/api/chat/messages/${privGrpMsgId}`, 'DELETE', adminToken);
  const rLeadDelGrp = await req(worker, mockEnv, `/api/chat/groups/${privGrpId}`, 'DELETE', adminToken);
  assertCheck(
    'Strict Group Privacy - Even Lead Admin Blocked from Unjoined Groups (403)',
    rLeadGrpMsgs.status === 403 && rLeadGrpMembers.status === 403 && rLeadDelGrpMsg.status === 403 && rLeadDelGrp.status === 403
  );
}
