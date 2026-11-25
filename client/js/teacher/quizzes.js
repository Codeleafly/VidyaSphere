/**
 * Teacher Studio: 5-Minute MCQ Quiz Builder, Results & Homework Module
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, safeUrl, formatDate, initIcons, showToast, bindModalBackdropAndEsc } from '/js/ui.js';

let teacherUser = null;
let onRefreshOverview = () => {};

function addQuestionBlock(defaults = null) {
  const container = document.getElementById('quiz-questions-builder');
  const idx = container.querySelectorAll('.qz-q-card').length;
  const block = document.createElement('div');
  block.className = 'qz-q-card p-3.5 rounded-2xl bg-[var(--md-surface-container)] border border-[var(--md-outline)] space-y-2';
  const opts = defaults?.options || ['', '', '', ''];
  const correctIdx = defaults?.correctIndex ?? 0;

  block.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-extrabold text-[11px] uppercase text-[var(--md-primary)]">Question ${idx + 1}</span>
      <button type="button" class="remove-q-btn text-[11px] font-bold text-rose-600 hover:underline">Remove</button>
    </div>
    <input type="text" class="qz-q-text m3-input w-full px-3 py-2 rounded-xl border border-[var(--md-outline)] bg-white text-xs" placeholder="Enter question..." value="${escapeHtml(defaults?.question || '')}" required>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
      ${[0, 1, 2, 3].map(o => `
        <label class="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-xl border border-[var(--md-outline)]">
          <input type="radio" name="qz-correct-${idx}" value="${o}" ${correctIdx === o ? 'checked' : ''} class="qz-correct-radio">
          <input type="text" class="qz-opt-input flex-1 text-xs outline-none" placeholder="Option ${o + 1}${o >= 2 ? ' (Optional)' : ''}" value="${escapeHtml(opts[o] || '')}" ${o < 2 ? 'required' : ''}>
        </label>
      `).join('')}
    </div>
    <input type="text" class="qz-q-exp m3-input w-full px-3 py-1.5 rounded-xl border border-[var(--md-outline)] bg-white text-[11px]" placeholder="Short explanation (shown after submit)..." value="${escapeHtml(defaults?.explanation || '')}">
  `;

  block.querySelector('.remove-q-btn').addEventListener('click', () => {
    if (container.querySelectorAll('.qz-q-card').length <= 1) {
      showToast('Quiz must have at least 1 question', 'warning');
      return;
    }
    block.remove();
  });
  container.appendChild(block);
}

export function openQuizModal() {
  const modal = document.getElementById('quiz-modal');
  const builder = document.getElementById('quiz-questions-builder');
  builder.innerHTML = '';
  addQuestionBlock();
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeQuizModal() {
  const modal = document.getElementById('quiz-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function closeHwModal() {
  const modal = document.getElementById('hw-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function closeResultsModal() {
  const modal = document.getElementById('quiz-results-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

export async function loadTeacherQuizzes(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-quizzes-list');
  try {
    const res = await apiRequest(`/quizzes?teacherId=${encodeURIComponent(user.id)}`);
    const quizzes = res.quizzes || [];
    if (quizzes.length === 0) {
      listEl.innerHTML = `<div class="col-span-full m3-card p-6 text-center text-xs text-slate-400">No MCQ quizzes yet. Build a 5-minute quick check above!</div>`;
      return;
    }

    listEl.innerHTML = quizzes.map(q => `
      <article class="m3-card p-4 space-y-2.5 flex flex-col justify-between">
        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">${escapeHtml(q.className)} • ${escapeHtml(q.subject)}</span>
            <span class="text-[10px] font-bold text-slate-500 tabular-nums">${q.questionCount} Qs • ${q.attemptCount} attempts</span>
          </div>
          <h4 class="font-extrabold text-sm">${escapeHtml(q.title)}</h4>
          ${q.chapter ? `<p class="text-[11px] text-[var(--md-on-surface-variant)]">${escapeHtml(q.chapter)}</p>` : ''}
        </div>
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
          <button class="view-qr-btn m3-btn-tonal px-3 py-1 text-[11px]" data-id="${escapeHtml(q.id)}">View Scores</button>
          <button class="del-qz-btn px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold" data-id="${escapeHtml(q.id)}">Delete</button>
        </div>
      </article>
    `).join('');

    listEl.querySelectorAll('.view-qr-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const data = await apiRequest(`/quizzes/${encodeURIComponent(btn.dataset.id)}/results`);
          document.getElementById('qr-title').textContent = `Scores: ${data.quizTitle}`;
          const qrList = document.getElementById('qr-list');
          const rows = data.results || [];
          qrList.innerHTML = rows.length === 0
            ? `<p class="text-center text-slate-400 py-6">No student attempts yet.</p>`
            : rows.map(r => `
                <div class="p-3 rounded-2xl bg-[var(--md-surface-container)] flex items-center justify-between">
                  <div>
                    <p class="font-bold">${escapeHtml(r.full_name)} <span class="font-mono text-slate-500">@${escapeHtml(r.username)}</span></p>
                    <p class="text-[10px] text-slate-500">${escapeHtml(r.class_name)} ${escapeHtml(r.division)} • Roll #${escapeHtml(r.roll_number)}</p>
                  </div>
                  <span class="px-3 py-1 rounded-full bg-white font-extrabold text-[var(--md-primary)] tabular-nums border border-[var(--md-outline)]">${r.score}/${r.total}</span>
                </div>
              `).join('');
          document.getElementById('quiz-results-modal').classList.remove('hidden');
          document.getElementById('quiz-results-modal').classList.add('flex');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    listEl.querySelectorAll('.del-qz-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this quiz and all student attempts?')) return;
        try {
          await apiRequest(`/quizzes/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Quiz deleted', 'info');
          loadTeacherQuizzes(teacherUser);
          onRefreshOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="col-span-full m3-card p-4 text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export async function loadTeacherHomework(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-homework-list');
  try {
    const res = await apiRequest(`/homework?teacherId=${encodeURIComponent(user.id)}`);
    const items = res.homework || [];
    if (items.length === 0) {
      listEl.innerHTML = `<div class="col-span-full m3-card p-6 text-center text-xs text-slate-400">No homework posted yet.</div>`;
      return;
    }

    listEl.innerHTML = items.map(hw => {
      const link = safeUrl(hw.resource_url);
      return `
        <article class="m3-card p-4 space-y-2 flex flex-col justify-between">
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">${escapeHtml(hw.class_name)} • ${escapeHtml(hw.subject)}</span>
              ${hw.due_date ? `<span class="text-[10px] font-bold text-slate-500 tabular-nums">Due ${escapeHtml(hw.due_date)}</span>` : ''}
            </div>
            <h4 class="font-extrabold text-sm">${escapeHtml(hw.title)}</h4>
            <p class="text-xs text-[var(--md-on-surface-variant)] line-clamp-2">${escapeHtml(hw.description)}</p>
          </div>
          <div class="pt-2 border-t border-slate-100 flex items-center justify-between">
            ${link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-bold text-[var(--md-primary)] hover:underline">Reference Link</a>` : `<span class="text-[10px] text-slate-400">${escapeHtml(formatDate(hw.created_at))}</span>`}
            <button class="del-hw-btn px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-bold" data-id="${escapeHtml(hw.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('.del-hw-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this homework assignment?')) return;
        try {
          await apiRequest(`/homework/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Homework deleted', 'info');
          loadTeacherHomework(teacherUser);
          onRefreshOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="col-span-full m3-card p-4 text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export function initQuizzesAndHomework(user, refreshFn) {
  teacherUser = user;
  onRefreshOverview = refreshFn || (() => {});

  const qzModal = document.getElementById('quiz-modal');
  const hwModal = document.getElementById('hw-modal');
  const qrModal = document.getElementById('quiz-results-modal');

  document.getElementById('open-quiz-modal-btn')?.addEventListener('click', openQuizModal);
  document.getElementById('close-quiz-modal')?.addEventListener('click', closeQuizModal);
  bindModalBackdropAndEsc(qzModal, closeQuizModal);

  document.getElementById('open-hw-modal-btn')?.addEventListener('click', () => { hwModal.classList.remove('hidden'); hwModal.classList.add('flex'); });
  document.getElementById('close-hw-modal')?.addEventListener('click', closeHwModal);
  bindModalBackdropAndEsc(hwModal, closeHwModal);

  document.getElementById('close-qr-modal')?.addEventListener('click', closeResultsModal);
  bindModalBackdropAndEsc(qrModal, closeResultsModal);

  document.getElementById('add-quiz-question-btn')?.addEventListener('click', () => addQuestionBlock());

  document.getElementById('quiz-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cards = Array.from(document.querySelectorAll('.qz-q-card'));
    const questions = cards.map(card => {
      const qText = card.querySelector('.qz-q-text').value.trim();
      const optInputs = Array.from(card.querySelectorAll('.qz-opt-input'));
      const radios = Array.from(card.querySelectorAll('.qz-correct-radio'));
      const options = [];
      let correctIndex = 0;
      optInputs.forEach((inp, idx) => {
        const val = inp.value.trim();
        if (val) {
          if (radios[idx]?.checked) correctIndex = options.length;
          options.push(val);
        }
      });
      return {
        question: qText,
        options,
        correctIndex,
        explanation: card.querySelector('.qz-q-exp').value.trim(),
      };
    });

    try {
      await apiRequest('/quizzes', {
        method: 'POST',
        body: {
          title: document.getElementById('qz-title').value.trim(),
          className: document.getElementById('qz-class').value,
          subject: document.getElementById('qz-subject').value,
          chapter: document.getElementById('qz-chapter').value.trim(),
          questions,
          isPublished: true,
        }
      });
      showToast('MCQ Quiz published!', 'success');
      e.target.reset();
      closeQuizModal();
      loadTeacherQuizzes(teacherUser);
      onRefreshOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('hw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/homework', {
        method: 'POST',
        body: {
          title: document.getElementById('hw-title').value.trim(),
          className: document.getElementById('hw-class').value,
          subject: document.getElementById('hw-subject').value,
          dueDate: document.getElementById('hw-due').value,
          description: document.getElementById('hw-desc').value.trim(),
          resourceUrl: document.getElementById('hw-resource').value.trim(),
        }
      });
      showToast('Homework posted!', 'success');
      e.target.reset();
      closeHwModal();
      loadTeacherHomework(teacherUser);
      onRefreshOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
