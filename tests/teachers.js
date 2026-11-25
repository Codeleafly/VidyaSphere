/**
 * Verification Modules 51-62: Phase 6 Teachers Ecosystem
 * - Subject Teacher & Class Teacher Registration (Zero Staff Codes)
 * - Approval & Teacher Protection Hierarchy (Only Root Admin can suspend/demote/delete active Teachers)
 * - 20/day Teacher Notes Quota + Teacher Verified Badge
 * - Scoped Class Notices (30-day expiry)
 * - Class Teacher Scoped Student Approvals & Unit/Class Tests (Board exams Admin-only)
 * - Chapter Lessons, 5-Min Auto-Graded MCQ Quizzes (Anti-Cheat), Homework
 * - Q&A Faculty Endorsement, Chat Pinning/Moderation & Teacher DM Privacy Toggle
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

export async function runTeacherEcosystemTests({ worker, mockEnv, adminToken, secAdminToken, studentToken, studentId }) {
  // 51. Register Subject Teacher & Class Teacher (No Staff Codes)
  const rRegSub = await req(worker, mockEnv, '/api/auth/register', 'POST', null, {
    role: 'teacher',
    teacherType: 'subject',
    fullName: 'Prof. Sunita Verma',
    username: 'prof_verma',
    password: 'teacherPassword123',
    assignedClasses: ['Class 10'],
    assignedSubjects: ['Mathematics', 'Physics'],
    email: 'verma@school.edu',
  });
  const dRegSub = await rRegSub.json();
  const subTeacherId = dRegSub.user?.id;
  const subTeacherPendingToken = dRegSub.token;

  const rRegCls = await req(worker, mockEnv, '/api/auth/register', 'POST', null, {
    role: 'teacher',
    teacherType: 'class',
    fullName: 'Mrs. Kavita Deshmukh',
    username: 'mrs_deshmukh',
    password: 'teacherPassword123',
    className: 'Class 10',
    division: 'A',
    assignedClasses: ['Class 10'],
    assignedSubjects: ['General Science'],
  });
  const dRegCls = await rRegCls.json();
  const clsTeacherId = dRegCls.user?.id;
  const clsTeacherPendingToken = dRegCls.token;

  const rPendingBlocked = await req(worker, mockEnv, '/api/lessons', 'POST', subTeacherPendingToken, {
    title: 'Blocked Draft',
    className: 'Class 10',
    subject: 'Mathematics',
  });

  assertCheck(
    'Phase 6 - Teacher Registration (Subject & Class) & Pending Block (403)',
    rRegSub.status === 201 && dRegSub.user.role === 'teacher' && dRegSub.user.teacherType === 'subject' &&
    rRegCls.status === 201 && dRegCls.user.teacherType === 'class' && rPendingBlocked.status === 403
  );

  // 52. Secondary Admin Approves & Adjusts Teacher Assignments; Active Teacher Protected from Secondary Admin
  const rApproveSub = await req(worker, mockEnv, '/api/admin/approve', 'POST', secAdminToken, {
    userId: subTeacherId,
    assignedClasses: ['Class 9', 'Class 10'],
    assignedSubjects: ['Mathematics', 'Physics'],
  });
  const rApproveCls = await req(worker, mockEnv, '/api/admin/approve', 'POST', secAdminToken, {
    userId: clsTeacherId,
  });
  const rEditScope = await req(worker, mockEnv, '/api/admin/teacher-profile', 'POST', secAdminToken, {
    userId: subTeacherId,
    teacherType: 'subject',
    assignedClasses: ['Class 9', 'Class 10'],
    assignedSubjects: ['Mathematics', 'Physics', 'Algebra (Maths I)'],
  });

  const rSecSuspendTch = await req(worker, mockEnv, '/api/admin/student-status', 'POST', secAdminToken, {
    studentId: subTeacherId,
    status: 'suspended',
  });
  const rSecDemoteTch = await req(worker, mockEnv, '/api/admin/change-role', 'POST', secAdminToken, {
    userId: subTeacherId,
    newRole: 'student',
  });
  const rSecDeleteTch = await req(worker, mockEnv, `/api/admin/users/${subTeacherId}`, 'DELETE', secAdminToken);

  assertCheck(
    'Phase 6 - Secondary Admin Approves/Edits Teacher, Blocked from Suspend/Demote/Delete (403)',
    rApproveSub.status === 200 && rApproveCls.status === 200 && rEditScope.status === 200 &&
    rSecSuspendTch.status === 403 && rSecDemoteTch.status === 403 && rSecDeleteTch.status === 403
  );

  // Login active teachers
  const subTeacherToken = (await (await req(worker, mockEnv, '/api/auth/login', 'POST', null, {
    username: 'prof_verma',
    password: 'teacherPassword123',
  })).json()).token;
  const clsTeacherToken = (await (await req(worker, mockEnv, '/api/auth/login', 'POST', null, {
    username: 'mrs_deshmukh',
    password: 'teacherPassword123',
  })).json()).token;

  // Lead Root Admin CAN suspend & reactivate Teacher
  const rRootSuspendTch = await req(worker, mockEnv, '/api/admin/student-status', 'POST', adminToken, {
    studentId: subTeacherId,
    status: 'suspended',
  });
  const rRootReactivateTch = await req(worker, mockEnv, '/api/admin/student-status', 'POST', adminToken, {
    studentId: subTeacherId,
    status: 'active',
  });
  assertCheck(
    'Phase 6 - Lead Root Admin Can Suspend & Reactivate Teacher (200)',
    rRootSuspendTch.status === 200 && rRootReactivateTch.status === 200
  );

  // 53. Teacher 20 Direct Uploads / 24h Quota + Teacher Verified Badge
  let noteOkCount = 0;
  let lastVerified = false;
  for (let i = 1; i <= 6; i++) {
    const r = await req(worker, mockEnv, '/api/notes/upload', 'POST', subTeacherToken, {
      title: `Verified Formula Sheet ${i}`,
      className: 'Class 10',
      subject: 'Mathematics',
    });
    const d = await r.json();
    if (r.status === 201) noteOkCount++;
    if (i === 1) lastVerified = d.isTeacherVerified === true;
  }
  assertCheck(
    'Phase 6 - Teacher Exceeds Student 4/day Limit (6/20 Uploads + Verified Badge)',
    noteOkCount === 6 && lastVerified
  );

  // 54. Scoped Notices (Taught Classes Only; Cannot Post All or Unassigned Class; Cannot Delete Admin Notice)
  const rNoticeAll = await req(worker, mockEnv, '/api/admin/announcements', 'POST', subTeacherToken, {
    title: 'Global Attempt',
    content: 'Should be blocked',
    targetClass: 'all',
  });
  const rNoticeUnassigned = await req(worker, mockEnv, '/api/admin/announcements', 'POST', subTeacherToken, {
    title: 'Class 4 Notice',
    content: 'Unassigned',
    targetClass: 'Class 4',
  });
  const rNoticeOk = await req(worker, mockEnv, '/api/admin/announcements', 'POST', subTeacherToken, {
    title: 'Class 10 Maths Extra Class',
    content: 'Bring geometry box tomorrow.',
    targetClass: 'Class 10',
  });
  const tNoticeId = (await rNoticeOk.json()).id;

  const rAdminNotice = await req(worker, mockEnv, '/api/admin/announcements', 'POST', adminToken, {
    title: 'Admin Class 10 Circular',
    content: 'Official directive',
    targetClass: 'Class 10',
  });
  const adminNoticeId = (await rAdminNotice.json()).id;

  const rTchDelAdminNotice = await req(worker, mockEnv, `/api/admin/announcements/${adminNoticeId}`, 'DELETE', subTeacherToken);
  const rTchDelOwnNotice = await req(worker, mockEnv, `/api/admin/announcements/${tNoticeId}`, 'DELETE', subTeacherToken);
  await req(worker, mockEnv, `/api/admin/announcements/${adminNoticeId}`, 'DELETE', adminToken);

  assertCheck(
    'Phase 6 - Scoped Class Notices Enforced (403 Outside Scope, 200 Scoped)',
    rNoticeAll.status === 403 && rNoticeUnassigned.status === 403 && rNoticeOk.status === 201 &&
    rTchDelAdminNotice.status === 403 && rTchDelOwnNotice.status === 200
  );

  // 55. Class Teacher Scoped Student Approvals (Subject Teacher Blocked, Other Class Blocked)
  const rRegS1 = await req(worker, mockEnv, '/api/auth/register', 'POST', null, {
    fullName: 'Rohan Kulkarni',
    className: 'Class 10',
    division: 'A',
    rollNumber: '15',
    username: 'rohan_10a_15',
    password: 'studentPassword123',
  });
  const rohanId = (await rRegS1.json()).user.id;

  const rRegS2 = await req(worker, mockEnv, '/api/auth/register', 'POST', null, {
    fullName: 'Meera Joshi',
    className: 'Class 9',
    division: 'B',
    rollNumber: '08',
    username: 'meera_9b_08',
    password: 'studentPassword123',
  });
  const meeraId = (await rRegS2.json()).user.id;

  const rSubTryApprove = await req(worker, mockEnv, '/api/teacher/students/approve', 'POST', subTeacherToken, { userId: rohanId });
  const rClsWrongClass = await req(worker, mockEnv, '/api/teacher/students/approve', 'POST', clsTeacherToken, { userId: meeraId });
  const rClsRightClass = await req(worker, mockEnv, '/api/teacher/students/approve', 'POST', clsTeacherToken, { userId: rohanId });

  assertCheck(
    'Phase 6 - Class Teacher Scoped Student Approvals (403 Subject/Other Class, 200 Own Class)',
    rSubTryApprove.status === 403 && rClsWrongClass.status === 403 && rClsRightClass.status === 200
  );

  // 56. Class Teacher Unit Tests vs Admin Board Exams
  const rSubTryTest = await req(worker, mockEnv, '/api/teacher/exams', 'POST', subTeacherToken, {
    title: 'Subject Teacher Test',
    className: 'Class 10',
    subject: 'Mathematics',
    examDate: '2026-12-10',
  });
  const rClsTestWrong = await req(worker, mockEnv, '/api/teacher/exams', 'POST', clsTeacherToken, {
    title: 'Wrong Class Test',
    className: 'Class 9',
    subject: 'Science',
    examDate: '2026-12-10',
  });
  const rClsTestOk = await req(worker, mockEnv, '/api/teacher/exams', 'POST', clsTeacherToken, {
    title: 'Class 10 Unit Test 1',
    className: 'Class 10',
    subject: 'General Science',
    examDate: '2026-12-12',
  });
  const unitTestId = (await rClsTestOk.json()).id;

  const rBoardExam = await req(worker, mockEnv, '/api/admin/exams', 'POST', adminToken, {
    title: 'Final Board Prelim',
    className: 'Class 10',
    subject: 'General Science',
    examDate: '2027-01-15',
  });
  const boardExamId = (await rBoardExam.json()).id;
  const rClsDelBoard = await req(worker, mockEnv, `/api/teacher/exams/${boardExamId}`, 'DELETE', clsTeacherToken);
  const rClsDelOwnTest = await req(worker, mockEnv, `/api/teacher/exams/${unitTestId}`, 'DELETE', clsTeacherToken);
  await req(worker, mockEnv, `/api/admin/exams/${boardExamId}`, 'DELETE', adminToken);

  assertCheck(
    'Phase 6 - Class Teacher Unit Tests Scoped & Board Exams Protected (403)',
    rSubTryTest.status === 403 && rClsTestWrong.status === 403 && rClsTestOk.status === 201 &&
    rClsDelBoard.status === 403 && rClsDelOwnTest.status === 200
  );

  // 57. Chapter-Wise Lessons (XSS URL blocked, YouTube/Drive published & student readable)
  const rStuLesson = await req(worker, mockEnv, '/api/lessons', 'POST', studentToken, {
    title: 'Student Hacking Lesson',
    className: 'Class 10',
    subject: 'Mathematics',
  });
  const rUnsafeLesson = await req(worker, mockEnv, '/api/lessons', 'POST', subTeacherToken, {
    title: 'XSS Video',
    className: 'Class 10',
    subject: 'Mathematics',
    videoUrl: 'javascript:alert(1)',
  });
  const rGoodLesson = await req(worker, mockEnv, '/api/lessons', 'POST', subTeacherToken, {
    title: 'Trigonometry Identities Lecture',
    className: 'Class 10',
    subject: 'Mathematics',
    chapter: 'Chapter 8',
    videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
    resourceUrl: 'https://drive.google.com/file/d/trig_notes/view',
    summary: 'sin^2(x) + cos^2(x) = 1',
  });
  const rListLessons = await req(worker, mockEnv, '/api/lessons?className=Class%2010', 'GET', studentToken);
  const dListLessons = await rListLessons.json();

  assertCheck(
    'Phase 6 - Chapter Lessons CRUD & URL Sanitization',
    rStuLesson.status === 403 && rUnsafeLesson.status === 400 && rGoodLesson.status === 201 &&
    (dListLessons.lessons || []).length >= 1
  );

  // 58. 5-Minute Auto-Graded MCQ Quizzes (Anti-Cheat Stripping & Single-Attempt Lock)
  const rCreateQuiz = await req(worker, mockEnv, '/api/quizzes', 'POST', subTeacherToken, {
    title: 'Optics Quick Check',
    className: 'Class 10',
    subject: 'Physics',
    chapter: 'Chapter 10',
    questions: [
      { question: 'Unit of power of lens?', options: ['Watt', 'Dioptre', 'Newton', 'Joule'], correctIndex: 1, explanation: 'P = 1/f(m) is measured in Dioptre.' },
      { question: 'Speed of light in vacuum?', options: ['3x10^8 m/s', '3x10^6 m/s'], correctIndex: 0, explanation: 'c = 3x10^8 m/s' },
    ],
  });
  const quizId = (await rCreateQuiz.json()).id;

  const rStuGetQuiz = await req(worker, mockEnv, `/api/quizzes/${quizId}`, 'GET', studentToken);
  const dStuGetQuiz = await rStuGetQuiz.json();
  const leakedCorrect = dStuGetQuiz.quiz.questions.some(q => q.correctIndex !== undefined);

  const rAttempt1 = await req(worker, mockEnv, `/api/quizzes/${quizId}/attempt`, 'POST', studentToken, {
    answers: [1, 1], // 1 right, 1 wrong -> 1/2
  });
  const dAttempt1 = await rAttempt1.json();
  const rAttempt2 = await req(worker, mockEnv, `/api/quizzes/${quizId}/attempt`, 'POST', studentToken, {
    answers: [1, 0],
  });
  const rQuizResults = await req(worker, mockEnv, `/api/quizzes/${quizId}/results`, 'GET', subTeacherToken);
  const dQuizResults = await rQuizResults.json();

  assertCheck(
    'Phase 6 - MCQ Quiz Anti-Cheat, Auto-Grading & Single-Attempt Lock (409)',
    rCreateQuiz.status === 201 && !leakedCorrect &&
    rAttempt1.status === 201 && dAttempt1.score === 1 && dAttempt1.total === 2 &&
    rAttempt2.status === 409 && (dQuizResults.results || []).length === 1
  );

  // 59. Lightweight Daily Homework Feed
  const rStuHw = await req(worker, mockEnv, '/api/homework', 'POST', studentToken, {
    title: 'Fake HW',
    description: 'No',
    className: 'Class 10',
    subject: 'Mathematics',
  });
  const rTchHw = await req(worker, mockEnv, '/api/homework', 'POST', subTeacherToken, {
    title: 'Trigonometry Exercise 8.4',
    description: 'Solve Q1 to Q5 in fair notebook.',
    className: 'Class 10',
    subject: 'Mathematics',
    dueDate: '2026-12-05',
  });
  const rListHw = await req(worker, mockEnv, '/api/homework?className=Class%2010', 'GET', studentToken);

  assertCheck(
    'Phase 6 - Homework Feed (Student Blocked 403, Teacher Post & Read 200)',
    rStuHw.status === 403 && rTchHw.status === 201 && ((await rListHw.json()).homework || []).length >= 1
  );

  // 60. Q&A Teacher Verified Reply & Faculty Endorsement
  const rQ = await req(worker, mockEnv, '/api/qa/questions', 'POST', studentToken, {
    title: 'Why does sky look blue?',
    description: 'Need concise board-exam explanation.',
    subject: 'Physics',
    className: 'Class 10',
  });
  const qId = (await rQ.json()).id;
  const rStuAns = await req(worker, mockEnv, `/api/qa/questions/${qId}/answers`, 'POST', studentToken, {
    answerText: 'Because shorter blue wavelengths scatter more by Rayleigh scattering.',
  });
  const stuAnsId = (await rStuAns.json()).id;
  const rStuTryEndorse = await req(worker, mockEnv, `/api/qa/answers/${stuAnsId}/endorse`, 'POST', studentToken);
  const rTchEndorse = await req(worker, mockEnv, `/api/qa/answers/${stuAnsId}/endorse`, 'POST', subTeacherToken);
  const dQDetail = await (await req(worker, mockEnv, `/api/qa/questions/${qId}`, 'GET', studentToken)).json();

  assertCheck(
    'Phase 6 - Q&A Faculty Endorsement (Student 403, Teacher 200)',
    rStuTryEndorse.status === 403 && rTchEndorse.status === 200 &&
    dQDetail.answers[0].is_faculty_endorsed === 1
  );

  // 61. Teacher DM Privacy Toggle ("Allow Student DMs OFF/ON")
  const rToggleOff = await req(worker, mockEnv, '/api/teacher/settings', 'PUT', subTeacherToken, { allowStudentDms: false });
  const rDmBlocked = await req(worker, mockEnv, '/api/chat/dms/request', 'POST', studentToken, { targetUsername: 'prof_verma' });
  const rToggleOn = await req(worker, mockEnv, '/api/teacher/settings', 'PUT', subTeacherToken, { allowStudentDms: true });
  const rDmAllowed = await req(worker, mockEnv, '/api/chat/dms/request', 'POST', studentToken, { targetUsername: 'prof_verma' });

  assertCheck(
    'Phase 6 - Teacher DM Privacy Toggle Enforced (403 OFF, 201 ON)',
    rToggleOff.status === 200 && rDmBlocked.status === 403 && rToggleOn.status === 200 && rDmAllowed.status === 201
  );

  // 62. Scoped Chat Pinning & Moderation (#academics & taught #class_class_10 vs #school / admin msg)
  const rStuAcad = await req(worker, mockEnv, '/api/chat/messages', 'POST', studentToken, {
    channel: 'academics',
    content: 'Important formula discussion',
  });
  const acadMsgId = (await rStuAcad.json()).id;

  const rStuSchool = await req(worker, mockEnv, '/api/chat/messages', 'POST', studentToken, {
    channel: 'school',
    content: 'General hallway chat',
  });
  const schoolMsgId = (await rStuSchool.json()).id;

  const rPinAcad = await req(worker, mockEnv, `/api/chat/messages/${acadMsgId}/pin`, 'POST', subTeacherToken);
  const rPinSchool = await req(worker, mockEnv, `/api/chat/messages/${schoolMsgId}/pin`, 'POST', subTeacherToken);
  const rDelSchool = await req(worker, mockEnv, `/api/chat/messages/${schoolMsgId}`, 'DELETE', subTeacherToken);

  const rAdminAcad = await req(worker, mockEnv, '/api/chat/messages', 'POST', adminToken, {
    channel: 'academics',
    content: 'Admin directive in academics',
  });
  const adminAcadId = (await rAdminAcad.json()).id;
  const rTchDelAdmin = await req(worker, mockEnv, `/api/chat/messages/${adminAcadId}`, 'DELETE', subTeacherToken);
  const rTchDelStuAcad = await req(worker, mockEnv, `/api/chat/messages/${acadMsgId}`, 'DELETE', subTeacherToken);

  assertCheck(
    'Phase 6 - Scoped Chat Pinning & Moderation (#academics 200, #school/Admin 403)',
    rPinAcad.status === 200 && rPinSchool.status === 403 && rDelSchool.status === 403 &&
    rTchDelAdmin.status === 403 && rTchDelStuAcad.status === 200
  );
}
