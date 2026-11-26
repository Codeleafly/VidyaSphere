/**
 * Verification Modules 63-71:
 * - Lead Root Admin (@admin) clean profile (no className, division, rollNumber)
 * - Lead Admin & Secondary Admin access to Teacher Studio (/api/teacher/*)
 * - Teacher Designation & Extra Info on Registration + Audit Logs
 * - Self-service password change & profile update
 * - Rebuilt Chat replyToId quotes, emoji reactions, and search
 * - Polls close/delete, Q&A search/delete, and Notes verified/uploader filters
 * - Google Search Console verification tag, dynamic /sitemap.xml & /robots.txt
 */

import fs from 'node:fs';

function assertCheck(label, condition) {
  console.log(`✓ [${label}]:`, condition ? 'PASS' : 'FAIL');
  if (!condition) {
    throw new Error(`Verification failed: ${label}`);
  }
}

async function req(worker, mockEnv, path, method = 'GET', token = null, body = null) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== null && body !== undefined) headers['Content-Type'] = 'application/json';
  return await worker.fetch(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body !== null && body !== undefined ? JSON.stringify(body) : undefined,
  }), mockEnv);
}

export async function runExtrasVerificationTests({ worker, mockEnv, adminToken, secAdminToken, studentToken }) {
  // 63. Lead Root Admin (@admin) must NEVER expose className, division, or rollNumber
  const rMeAdmin = await req(worker, mockEnv, '/api/auth/me', 'GET', adminToken);
  const dMeAdmin = await rMeAdmin.json();
  const rDir = await req(worker, mockEnv, '/api/students', 'GET', studentToken);
  const dDir = await rDir.json();
  const rootDirEntry = (dDir.students || []).find(s => s.username === 'admin' || s.is_root_admin === 1);

  assertCheck(
    'Root Admin Identity Clean (No class/division/roll)',
    rMeAdmin.status === 200 &&
    dMeAdmin.user.isRootAdmin === true &&
    dMeAdmin.user.className === '' &&
    dMeAdmin.user.division === '' &&
    dMeAdmin.user.rollNumber === '' &&
    !!rootDirEntry &&
    (rootDirEntry.class_name || '') === '' &&
    (rootDirEntry.division || '') === '' &&
    (rootDirEntry.roll_number || '') === ''
  );

  // 64. Lead Admin & Secondary Admin Unified Access to Teacher Studio
  const [rRootOv, rSecOv, rRootRoster, rSecExam] = await Promise.all([
    req(worker, mockEnv, '/api/teacher/overview', 'GET', adminToken),
    req(worker, mockEnv, '/api/teacher/overview', 'GET', secAdminToken),
    req(worker, mockEnv, '/api/teacher/students?status=active', 'GET', adminToken),
    req(worker, mockEnv, '/api/teacher/exams', 'POST', secAdminToken, {
      title: 'Admin-Scheduled Unit Check',
      className: 'Class 10',
      subject: 'Science',
      examDate: '2026-12-12',
    }),
  ]);
  const dRootOv = await rRootOv.json();
  const dSecOv = await rSecOv.json();
  const dRootRoster = await rRootRoster.json();
  assertCheck(
    'Lead & Secondary Admin Access Teacher Studio & Unit Exams',
    rRootOv.status === 200 && typeof dRootOv.overview?.activeClassStudents === 'number' &&
    rSecOv.status === 200 && typeof dSecOv.overview?.lessonsCount === 'number' &&
    rRootRoster.status === 200 && Array.isArray(dRootRoster.students) &&
    rSecExam.status === 201
  );

  // 65. Teacher Extended Registration (Designation + Extra Info) & Audit Logs
  const rRegExtra = await req(worker, mockEnv, '/api/auth/register', 'POST', null, {
    role: 'teacher',
    teacherType: 'subject',
    fullName: 'Dr. Ramesh Nair',
    username: 'dr_nair',
    password: 'teacherPassword123',
    assignedClasses: ['Class 9', 'Class 10'],
    assignedSubjects: ['Physics'],
    teacherDesignation: 'HOD Physics & Olympiad Mentor',
    teacherInfo: 'Handling CBSE Class 9-10 Physics labs and weekly Olympiad doubt sessions.',
    email: 'nair@school.edu',
  });
  const dRegExtra = await rRegExtra.json();

  const rRegs = await req(worker, mockEnv, '/api/admin/registrations?role=teacher', 'GET', adminToken);
  const dRegs = await rRegs.json();
  const nairRow = (dRegs.registrations || []).find(r => r.username === 'dr_nair');

  const rAudit = await req(worker, mockEnv, '/api/admin/audit-logs', 'GET', adminToken);
  const dAudit = await rAudit.json();

  assertCheck(
    'Teacher Extended Info Saved, Visible to Admin Review & Audit Logs Working',
    rRegExtra.status === 201 &&
    dRegExtra.user.teacherDesignation === 'HOD Physics & Olympiad Mentor' &&
    !!nairRow &&
    nairRow.teacher_designation === 'HOD Physics & Olympiad Mentor' &&
    nairRow.teacher_info.includes('Olympiad doubt sessions') &&
    rAudit.status === 200 && Array.isArray(dAudit.logs) && dAudit.logs.length > 0
  );

  // Clean up test teacher account via approve/delete so pending queue doesn't linger
  await req(worker, mockEnv, `/api/admin/students/${dRegExtra.user.id}`, 'DELETE', adminToken);

  // 66. Self-Service Password Change & Profile Update
  const rBadPw = await req(worker, mockEnv, '/api/auth/change-password', 'PUT', secAdminToken, {
    currentPassword: 'wrongPassword999',
    newPassword: 'newSecPassword123',
  });
  const rGoodPw = await req(worker, mockEnv, '/api/auth/change-password', 'PUT', secAdminToken, {
    currentPassword: 'studentSecurePassword123',
    newPassword: 'newSecPassword123',
  });
  const rNewLogin = await req(worker, mockEnv, '/api/auth/login', 'POST', null, {
    username: 'aarav_10a_21',
    password: 'newSecPassword123',
  });
  // Restore original password so downstream scripts remain consistent
  await req(worker, mockEnv, '/api/auth/change-password', 'PUT', secAdminToken, {
    currentPassword: 'newSecPassword123',
    newPassword: 'studentSecurePassword123',
  });
  const rProfUpdate = await req(worker, mockEnv, '/api/auth/profile', 'PUT', adminToken, {
    teacherDesignation: 'Principal & Lead Administrator',
    teacherInfo: 'Full school governance across Student, Teacher, and Admin portals.',
  });
  const dProfUpdate = await rProfUpdate.json();

  assertCheck(
    'Self-Service Change Password & Profile Update',
    rBadPw.status === 401 && rGoodPw.status === 200 && rNewLogin.status === 200 &&
    rProfUpdate.status === 200 &&
    dProfUpdate.user.teacherDesignation === 'Principal & Lead Administrator' &&
    dProfUpdate.user.className === ''
  );

  // 67. Material Chat Replies (replyToId), Emoji Reactions & Search
  const rParentMsg = await req(worker, mockEnv, '/api/chat/messages', 'POST', studentToken, {
    channel: 'school',
    content: 'Doubt: What is the formula for Ohm Law in Physics?',
  });
  const dParentMsg = await rParentMsg.json();
  const parentId = dParentMsg.id;

  const rReplyMsg = await req(worker, mockEnv, '/api/chat/messages', 'POST', adminToken, {
    channel: 'school',
    content: 'V = I × R! Always check SI units first.',
    replyToId: parentId,
  });
  const dReplyMsg = await rReplyMsg.json();

  const rReactOn = await req(worker, mockEnv, `/api/chat/messages/${parentId}/react`, 'POST', adminToken, {
    emoji: '💡',
  });
  const dReactOn = await rReactOn.json();

  const rReactOff = await req(worker, mockEnv, `/api/chat/messages/${parentId}/react`, 'POST', adminToken, {
    emoji: '💡',
  });
  const dReactOff = await rReactOff.json();

  const rChatSearch = await req(worker, mockEnv, '/api/chat/messages?channel=school&search=Ohm%20Law', 'GET', studentToken);
  const dChatSearch = await rChatSearch.json();

  assertCheck(
    'Chat Replies, Reaction Toggle & Message Search',
    rParentMsg.status === 201 &&
    rReplyMsg.status === 201 &&
    dReplyMsg.reply_to_id === parentId &&
    rReactOn.status === 200 && Array.isArray(dReactOn.reactions['💡']) && dReactOn.reactions['💡'].length === 1 &&
    rReactOff.status === 200 && !dReactOff.reactions['💡'] &&
    rChatSearch.status === 200 && (dChatSearch.messages || []).some(m => m.id === parentId)
  );

  // 68. Polls Close & Delete
  const rCreatePoll = await req(worker, mockEnv, '/api/polls', 'POST', adminToken, {
    question: 'Best revision slot for Science?',
    options: ['Morning 7 AM', 'Evening 6 PM'],
    isMultipleChoice: false,
  });
  const dCreatePoll = await rCreatePoll.json();
  const pollId = dCreatePoll.id;

  const rStudentCloseBlocked = await req(worker, mockEnv, `/api/polls/${pollId}/close`, 'POST', studentToken);
  const rClosePoll = await req(worker, mockEnv, `/api/polls/${pollId}/close`, 'POST', adminToken);
  const rDeletePoll = await req(worker, mockEnv, `/api/polls/${pollId}`, 'DELETE', adminToken);

  assertCheck(
    'Polls Early Close & Delete (With RBAC Guard)',
    rCreatePoll.status === 201 &&
    rStudentCloseBlocked.status === 403 &&
    rClosePoll.status === 200 &&
    rDeletePoll.status === 200
  );

  // 69. Q&A Search & Delete (Question & Answer)
  const rAskQ = await req(worker, mockEnv, '/api/qa/questions', 'POST', studentToken, {
    subject: 'Chemistry',
    className: 'Class 10',
    title: 'Balance Fe + H2O equation cleanly',
    description: 'Need coefficient balancing steps for exam.',
  });
  const dAskQ = await rAskQ.json();
  const qId = dAskQ.id;

  const rAnsQ = await req(worker, mockEnv, `/api/qa/questions/${qId}/answers`, 'POST', adminToken, {
    answerText: '3Fe + 4H2O -> Fe3O4 + 4H2',
  });
  const dAnsQ = await rAnsQ.json();
  const ansId = dAnsQ.id;

  const rSearchQ = await req(worker, mockEnv, '/api/qa/questions?search=Fe3O4_nope_Balance', 'GET', studentToken);
  const rSearchHit = await req(worker, mockEnv, '/api/qa/questions?search=Balance', 'GET', studentToken);
  const dSearchHit = await rSearchHit.json();

  const rDelAnsForbidden = await req(worker, mockEnv, `/api/qa/answers/${ansId}`, 'DELETE', studentToken);
  const rDelAnsOk = await req(worker, mockEnv, `/api/qa/answers/${ansId}`, 'DELETE', adminToken);
  const rDelQOk = await req(worker, mockEnv, `/api/qa/questions/${qId}`, 'DELETE', studentToken);

  assertCheck(
    'Q&A Search, Answer Delete & Question Delete',
    rAskQ.status === 201 &&
    rAnsQ.status === 201 &&
    rSearchQ.status === 200 &&
    (dSearchHit.questions || []).some(q => q.id === qId) &&
    rDelAnsForbidden.status === 403 &&
    rDelAnsOk.status === 200 &&
    rDelQOk.status === 200
  );

  // 70. Notes Verified & Uploader Filtering
  const rVerifiedNotes = await req(worker, mockEnv, '/api/notes?verified=1', 'GET', studentToken);
  const dVerifiedNotes = await rVerifiedNotes.json();
  const allVerifiedOk = (dVerifiedNotes.notes || []).every(
    n => n.is_teacher_verified === 1 || ['teacher', 'admin'].includes(n.uploader_role)
  );
  const rAdminNotes = await req(worker, mockEnv, `/api/notes?uploaderId=${dMeAdmin.user.id}`, 'GET', studentToken);
  const dAdminNotes = await rAdminNotes.json();
  const allAdminOwned = (dAdminNotes.notes || []).every(n => n.uploader_id === dMeAdmin.user.id);

  assertCheck(
    'Notes Verified-Only & UploaderId Queries',
    rVerifiedNotes.status === 200 && allVerifiedOk &&
    rAdminNotes.status === 200 && allAdminOwned
  );

  // 71. Google Site Verification Meta Tag + Dynamic Sitemap.xml & Robots.txt
  const expectedMeta = '<meta name="google-site-verification" content="3XYEbXoLsICQETuhAq5vufhJyrxTf3h_AjqzEMpNzbs" />';
  const publicPages = [
    './client/index.html',
    './client/guide.html',
    './client/auth/login.html',
    './client/auth/register.html',
    './client/auth/status.html',
    './client/auth/pending.html',
  ];
  const metaEverywhere = publicPages.every(p => fs.readFileSync(p, 'utf8').includes(expectedMeta));

  const rMainRobots = await worker.fetch(new Request('https://vidyasphere.ziprecovery2024-dbc.workers.dev/robots.txt'), mockEnv);
  const tMainRobots = await rMainRobots.text();
  const rPrevSitemap = await worker.fetch(new Request('https://vidyasphere-preview.ziprecovery2024-dbc.workers.dev/sitemap.xml'), mockEnv);
  const tPrevSitemap = await rPrevSitemap.text();

  assertCheck(
    'Google Search Verification Meta, Dynamic Robots.txt & Sitemap.xml',
    metaEverywhere &&
    rMainRobots.status === 200 &&
    tMainRobots.includes('Sitemap: https://vidyasphere.ziprecovery2024-dbc.workers.dev/sitemap.xml') &&
    tMainRobots.includes('Disallow: /api/') &&
    rPrevSitemap.status === 200 &&
    (rPrevSitemap.headers.get('content-type') || '').includes('application/xml') &&
    tPrevSitemap.includes('<loc>https://vidyasphere-preview.ziprecovery2024-dbc.workers.dev/</loc>') &&
    tPrevSitemap.includes('<loc>https://vidyasphere-preview.ziprecovery2024-dbc.workers.dev/guide</loc>')
  );
}
