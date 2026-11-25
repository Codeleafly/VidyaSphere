/**
 * Phase 6: 5-Minute Auto-Graded MCQ Quizzes
 * - Strips answer key & explanations until student has submitted an attempt
 * - Enforces UNIQUE(quiz_id, student_id) single-attempt ledger
 */

import { errorResponse, successResponse } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';
import { sanitizeProfileRow } from '../utils/teacherScope.js';

function sanitizeQuizQuestions(rawQuestions) {
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return { error: 'At least 1 MCQ question is required' };
  }
  if (rawQuestions.length > 25) {
    return { error: 'Maximum 25 questions allowed per quick quiz' };
  }

  const cleaned = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const q = rawQuestions[i] || {};
    const text = String(q.question || q.text || '').trim();
    const options = Array.isArray(q.options) ? q.options.map(o => String(o || '').trim()).filter(Boolean) : [];
    const correctIndex = Number(q.correctIndex);
    const explanation = String(q.explanation || '').trim();

    if (!text) return { error: `Question ${i + 1} text cannot be empty` };
    if (options.length < 2) return { error: `Question ${i + 1} must have at least 2 options` };
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { error: `Question ${i + 1} has an invalid correctIndex` };
    }

    cleaned.push({ question: text, options, correctIndex, explanation });
  }
  return { questions: cleaned };
}

function stripAnswersForStudent(questions) {
  return questions.map((q, idx) => ({
    index: idx,
    question: q.question,
    options: q.options,
  }));
}

export async function handleQuizzesRoutes(request, env, path, method) {
  // GET /api/quizzes - List quizzes (published for students, all for teachers/admins)
  if (path === '/api/quizzes' && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const url = new URL(request.url);
    const className = (url.searchParams.get('className') || '').trim();
    const subject = (url.searchParams.get('subject') || '').trim();
    const teacherId = (url.searchParams.get('teacherId') || '').trim();
    const isStaff = auth.user.role === 'teacher' || auth.user.role === 'admin';

    let query = `
      SELECT q.id, q.teacher_id, q.title, q.class_name, q.subject, q.chapter, q.questions_json, q.is_published, q.created_at,
             p.full_name as teacher_name, p.role as teacher_role, p.teacher_type, p.is_root_admin as teacher_is_root_admin,
             (SELECT COUNT(*) FROM quiz_attempts qa WHERE qa.quiz_id = q.id) as attempt_count,
             qa_me.score as my_score, qa_me.total as my_total, qa_me.created_at as my_attempted_at
      FROM quizzes q
      LEFT JOIN profiles p ON q.teacher_id = p.id
      LEFT JOIN quiz_attempts qa_me ON qa_me.quiz_id = q.id AND qa_me.student_id = ?
      WHERE 1=1
    `;
    const params = [auth.user.id];

    if (!isStaff) {
      query += ` AND q.is_published = 1`;
    }
    if (className && className !== 'all' && className !== 'All Classes') {
      query += ` AND q.class_name = ?`;
      params.push(className);
    }
    if (subject) {
      query += ` AND q.subject = ?`;
      params.push(subject);
    }
    if (teacherId) {
      query += ` AND q.teacher_id = ?`;
      params.push(teacherId);
    }

    query += ` ORDER BY q.created_at DESC LIMIT 80`;
    const { results } = await env.DB.prepare(query).bind(...params).all();

    const quizzes = (results || []).map(row => {
      let questionCount = 0;
      try {
        questionCount = JSON.parse(row.questions_json || '[]').length;
      } catch { questionCount = 0; }

      return {
        id: row.id,
        teacherId: row.teacher_id,
        teacherName: row.teacher_name,
        teacherRole: row.teacher_role || 'teacher',
        teacherType: row.teacher_type,
        teacherIsRootAdmin: row.teacher_is_root_admin === 1,
        title: row.title,
        className: row.class_name,
        subject: row.subject,
        chapter: row.chapter,
        isPublished: row.is_published === 1,
        questionCount,
        attemptCount: row.attempt_count || 0,
        myAttempt: row.my_attempted_at ? {
          score: row.my_score,
          total: row.my_total,
          attemptedAt: row.my_attempted_at,
        } : null,
        createdAt: row.created_at,
      };
    });

    return successResponse({ quizzes });
  }

  // POST /api/quizzes - Teacher or Admin creates quiz
  if (path === '/api/quizzes' && method === 'POST') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    try {
      const body = await request.json();
      const { title, className, subject, chapter = '', questions, isPublished = true } = body;

      if (!title || !className || !subject) {
        return errorResponse('Quiz title, className, and subject are required', 400);
      }

      const check = sanitizeQuizQuestions(questions);
      if (check.error) return errorResponse(check.error, 400);

      const id = generateId('qiz', 8);
      await env.DB.prepare(
        `INSERT INTO quizzes (id, teacher_id, title, class_name, subject, chapter, questions_json, is_published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        auth.user.id,
        title.trim(),
        className.trim(),
        subject.trim(),
        String(chapter || '').trim(),
        JSON.stringify(check.questions),
        isPublished ? 1 : 0
      ).run();

      return successResponse({ id, questionCount: check.questions.length }, 'MCQ Quiz published!', 201);
    } catch (err) {
      return errorResponse(`Quiz creation failed: ${err.message}`, 500);
    }
  }

  // GET /api/quizzes/:id/results - Teacher author or Admin views student attempts
  if (path.startsWith('/api/quizzes/') && path.endsWith('/results') && method === 'GET') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const quizId = path.split('/')[3];
    const quiz = await env.DB.prepare(`SELECT * FROM quizzes WHERE id = ?`).bind(quizId).first();
    if (!quiz) return errorResponse('Quiz not found', 404);

    if (quiz.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only view results for quizzes you created', 403);
    }

    const { results } = await env.DB.prepare(
      `SELECT qa.id, qa.student_id, qa.score, qa.total, qa.created_at,
              p.full_name, p.username, p.class_name, p.division, p.roll_number, p.is_root_admin
       FROM quiz_attempts qa
       JOIN profiles p ON qa.student_id = p.id
       WHERE qa.quiz_id = ?
       ORDER BY qa.score DESC, qa.created_at ASC`
    ).bind(quizId).all();

    return successResponse({ quizTitle: quiz.title, results: (results || []).map(sanitizeProfileRow) });
  }

  // POST /api/quizzes/:id/attempt - Student submits quiz and gets instant auto-graded key
  if (path.startsWith('/api/quizzes/') && path.endsWith('/attempt') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const quizId = path.split('/')[3];
    const quiz = await env.DB.prepare(`SELECT * FROM quizzes WHERE id = ?`).bind(quizId).first();
    if (!quiz) return errorResponse('Quiz not found', 404);
    if (quiz.is_published !== 1 && auth.user.role === 'student') {
      return errorResponse('This quiz is not currently published', 403);
    }

    try {
      const body = await request.json();
      const answers = Array.isArray(body.answers) ? body.answers : [];
      const questions = JSON.parse(quiz.questions_json || '[]');
      const total = questions.length;

      if (answers.length !== total) {
        return errorResponse(`Please answer all ${total} questions before submitting`, 400);
      }

      let score = 0;
      const review = questions.map((q, idx) => {
        const selectedIndex = Number(answers[idx]);
        const isCorrect = selectedIndex === q.correctIndex;
        if (isCorrect) score++;
        return {
          index: idx,
          question: q.question,
          options: q.options,
          selectedIndex,
          correctIndex: q.correctIndex,
          isCorrect,
          explanation: q.explanation || '',
        };
      });

      const attemptId = generateId('atm', 8);
      try {
        await env.DB.prepare(
          `INSERT INTO quiz_attempts (id, quiz_id, student_id, answers_json, score, total)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(attemptId, quizId, auth.user.id, JSON.stringify(answers), score, total).run();
      } catch (dbErr) {
        if (dbErr.message.includes('UNIQUE') || dbErr.message.includes('constraint')) {
          return errorResponse('You have already submitted an attempt for this quiz.', 409);
        }
        throw dbErr;
      }

      return successResponse({
        attemptId,
        score,
        total,
        percentage: total > 0 ? Math.round((score / total) * 100) : 0,
        review,
      }, `Quiz graded! You scored ${score}/${total}.`, 201);
    } catch (err) {
      return errorResponse(`Quiz submission failed: ${err.message}`, 500);
    }
  }

  // GET /api/quizzes/:id - Fetch single quiz (hide correct answers until attempted for students)
  if (path.startsWith('/api/quizzes/') && method === 'GET') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const quizId = path.replace('/api/quizzes/', '').trim();
    const quiz = await env.DB.prepare(
      `SELECT q.*, p.full_name as teacher_name, p.teacher_type
       FROM quizzes q
       LEFT JOIN profiles p ON q.teacher_id = p.id
       WHERE q.id = ?`
    ).bind(quizId).first();
    if (!quiz) return errorResponse('Quiz not found', 404);

    const isStaff = auth.user.role === 'teacher' || auth.user.role === 'admin';
    if (quiz.is_published !== 1 && !isStaff) {
      return errorResponse('Quiz is currently unpublished', 403);
    }

    const questions = JSON.parse(quiz.questions_json || '[]');
    const attempt = await env.DB.prepare(
      `SELECT * FROM quiz_attempts WHERE quiz_id = ? AND student_id = ?`
    ).bind(quizId, auth.user.id).first();

    const canSeeAnswers = isStaff || Boolean(attempt);
    let myAttempt = null;
    if (attempt) {
      const selected = JSON.parse(attempt.answers_json || '[]');
      myAttempt = {
        id: attempt.id,
        score: attempt.score,
        total: attempt.total,
        percentage: attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0,
        selectedAnswers: selected,
        createdAt: attempt.created_at,
      };
    }

    return successResponse({
      quiz: {
        id: quiz.id,
        teacherId: quiz.teacher_id,
        teacherName: quiz.teacher_name,
        teacherType: quiz.teacher_type,
        title: quiz.title,
        className: quiz.class_name,
        subject: quiz.subject,
        chapter: quiz.chapter,
        isPublished: quiz.is_published === 1,
        questions: canSeeAnswers ? questions : stripAnswersForStudent(questions),
        myAttempt,
        createdAt: quiz.created_at,
      }
    });
  }

  // PUT /api/quizzes/:id - Author teacher or admin updates quiz
  if (path.startsWith('/api/quizzes/') && method === 'PUT') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const quizId = path.replace('/api/quizzes/', '').trim();
    const existing = await env.DB.prepare(`SELECT * FROM quizzes WHERE id = ?`).bind(quizId).first();
    if (!existing) return errorResponse('Quiz not found', 404);

    if (existing.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only edit your own quizzes', 403);
    }

    try {
      const body = await request.json();
      const questions = body.questions !== undefined ? body.questions : JSON.parse(existing.questions_json || '[]');
      const check = sanitizeQuizQuestions(questions);
      if (check.error) return errorResponse(check.error, 400);

      await env.DB.prepare(
        `UPDATE quizzes SET title = ?, class_name = ?, subject = ?, chapter = ?, questions_json = ?, is_published = ? WHERE id = ?`
      ).bind(
        String(body.title ?? existing.title).trim(),
        String(body.className ?? existing.class_name).trim(),
        String(body.subject ?? existing.subject).trim(),
        String(body.chapter ?? existing.chapter).trim(),
        JSON.stringify(check.questions),
        body.isPublished !== undefined ? (body.isPublished ? 1 : 0) : existing.is_published,
        quizId
      ).run();

      return successResponse({ id: quizId }, 'Quiz updated successfully');
    } catch (err) {
      return errorResponse(`Quiz update failed: ${err.message}`, 500);
    }
  }

  // DELETE /api/quizzes/:id
  if (path.startsWith('/api/quizzes/') && method === 'DELETE') {
    const auth = await authenticate(request, env, ['teacher', 'admin']);
    if (auth.error) return auth.error;

    const quizId = path.replace('/api/quizzes/', '').trim();
    const existing = await env.DB.prepare(`SELECT * FROM quizzes WHERE id = ?`).bind(quizId).first();
    if (!existing) return errorResponse('Quiz not found', 404);

    if (existing.teacher_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only delete your own quizzes', 403);
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM quiz_attempts WHERE quiz_id = ?`).bind(quizId),
      env.DB.prepare(`DELETE FROM quizzes WHERE id = ?`).bind(quizId),
    ]);
    return successResponse({ id: quizId }, 'Quiz deleted successfully');
  }

  return errorResponse('Quizzes route not found', 404);
}
