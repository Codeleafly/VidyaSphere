/**
 * Admin Core: School Examination Scheduler & Timetable Manager
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, safeUrl, initIcons, showToast } from '/js/ui.js';

let adminExamsList = [];

function getLocalTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resetExamForm() {
  const form = document.getElementById('manage-exam-form');
  form?.reset();
  document.getElementById('exam-id').value = '';
  document.getElementById('exam-form-heading').innerHTML = '<span class="w-2 h-2 rounded-full bg-purple-600"></span> Schedule New Exam';
  document.getElementById('exam-submit-text').textContent = 'Publish Exam Schedule';
  document.getElementById('exam-cancel-edit-btn')?.classList.add('hidden');
  document.getElementById('exam-broadcast-wrapper')?.classList.remove('hidden');
}

export async function loadExamsAdmin() {
  const container = document.getElementById('admin-exams-container');
  const countBadge = document.getElementById('exam-count-badge');

  try {
    const res = await apiRequest('/exams');
    adminExamsList = res.exams || [];
    if (countBadge) countBadge.textContent = `${adminExamsList.length} scheduled`;

    if (adminExamsList.length === 0) {
      container.innerHTML = `
        <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80">
          <i data-lucide="calendar-x" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p class="text-sm font-semibold text-slate-700">No exams scheduled yet</p>
          <p class="text-xs text-slate-400 mt-1">Use the form above to announce unit tests or board exams.</p>
        </div>
      `;
      initIcons();
      return;
    }

    const todayStr = getLocalTodayIso();

    container.innerHTML = adminExamsList.map(ex => {
      const isPassed = ex.exam_date < todayStr;
      const isToday = ex.exam_date === todayStr;
      const safeDrive = safeUrl(ex.drive_link);

      return `
        <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 w-full break-words">
          <div class="space-y-1.5 w-full sm:w-auto">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                isToday ? 'bg-rose-50 text-rose-700 border-rose-200' : (isPassed ? 'bg-slate-100 text-slate-500 border-slate-200' : 'bg-purple-50 text-purple-700 border-purple-200')
              }">
                ${isToday ? 'TODAY' : (isPassed ? 'Completed' : 'Upcoming')}
              </span>
              <span class="text-xs sm:text-sm font-bold text-slate-900">${escapeHtml(ex.title)}</span>
              <span class="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-md">${escapeHtml(ex.class_name)}</span>
              <span class="text-[10px] bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5 rounded-md border border-indigo-100">${escapeHtml(ex.subject)}</span>
            </div>

            <div class="text-xs text-slate-600 flex items-center gap-3 flex-wrap tabular-nums">
              <span class="font-semibold text-slate-800 flex items-center gap-1">
                <i data-lucide="calendar" class="w-3.5 h-3.5 text-purple-600"></i> ${escapeHtml(ex.exam_date)}
              </span>
              ${ex.start_time ? `<span class="flex items-center gap-1 text-slate-500"><i data-lucide="clock" class="w-3.5 h-3.5"></i> ${escapeHtml(ex.start_time)}${ex.end_time ? ' - ' + escapeHtml(ex.end_time) : ''}</span>` : ''}
              ${ex.room_or_hall ? `<span class="flex items-center gap-1 text-slate-500"><i data-lucide="map-pin" class="w-3.5 h-3.5"></i> ${escapeHtml(ex.room_or_hall)}</span>` : ''}
            </div>

            ${ex.syllabus ? `<p class="text-xs text-slate-500 mt-1 line-clamp-2"><strong>Syllabus:</strong> ${escapeHtml(ex.syllabus)}</p>` : ''}

            ${safeDrive ? `
              <a href="${escapeHtml(safeDrive)}" target="_blank" rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 hover:underline mt-0.5">
                <i data-lucide="cloud" class="w-3.5 h-3.5"></i> Google Drive Timetable PDF
              </a>
            ` : ''}
          </div>

          <div class="flex items-center gap-2 w-full sm:w-auto shrink-0 border-t sm:border-t-0 pt-2.5 sm:pt-0">
            <button class="edit-exam-btn flex-1 sm:flex-none px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs flex items-center justify-center gap-1 transition"
              data-id="${escapeHtml(ex.id)}">
              <i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit
            </button>
            <button class="delete-exam-btn flex-1 sm:flex-none px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs flex items-center justify-center gap-1 transition"
              data-id="${escapeHtml(ex.id)}" data-title="${escapeHtml(ex.title)}">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete
            </button>
          </div>
        </div>
      `;
    }).join('');

    initIcons();

    container.querySelectorAll('.edit-exam-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ex = adminExamsList.find(item => item.id === btn.dataset.id);
        if (!ex) return;

        document.getElementById('exam-id').value = ex.id;
        document.getElementById('exam-title').value = ex.title || '';
        document.getElementById('exam-class').value = ex.class_name || 'All Classes';
        document.getElementById('exam-subject').value = ex.subject || '';
        document.getElementById('exam-date').value = ex.exam_date || '';
        document.getElementById('exam-start-time').value = ex.start_time || '';
        document.getElementById('exam-end-time').value = ex.end_time || '';
        document.getElementById('exam-room').value = ex.room_or_hall || '';
        document.getElementById('exam-syllabus').value = ex.syllabus || '';
        document.getElementById('exam-drive-link').value = ex.drive_link || '';

        document.getElementById('exam-form-heading').innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500"></span> Edit Exam Schedule & Details';
        document.getElementById('exam-submit-text').textContent = 'Update Exam Details';
        document.getElementById('exam-cancel-edit-btn')?.classList.remove('hidden');
        document.getElementById('exam-broadcast-wrapper')?.classList.add('hidden');
        document.getElementById('manage-exam-form')?.scrollIntoView({ behavior: 'smooth' });
      });
    });

    container.querySelectorAll('.delete-exam-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete the scheduled exam "${btn.dataset.title || 'this exam'}"?`)) return;
        try {
          await apiRequest(`/admin/exams/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Exam schedule deleted', 'info');
          loadExamsAdmin();
          onRefreshStats();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-rose-600 bg-rose-50 rounded-2xl text-xs">${escapeHtml(err.message)}</div>`;
  }
}

let onRefreshStats = () => {};

export function initExamsManager(refreshStatsFn) {
  onRefreshStats = refreshStatsFn || (() => {});
  const form = document.getElementById('manage-exam-form');
  document.getElementById('exam-cancel-edit-btn')?.addEventListener('click', resetExamForm);

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const examId = document.getElementById('exam-id').value.trim();
    const payload = {
      title: document.getElementById('exam-title').value.trim(),
      className: document.getElementById('exam-class').value,
      subject: document.getElementById('exam-subject').value.trim(),
      examDate: document.getElementById('exam-date').value,
      startTime: document.getElementById('exam-start-time').value.trim(),
      endTime: document.getElementById('exam-end-time').value.trim(),
      roomOrHall: document.getElementById('exam-room').value.trim(),
      syllabus: document.getElementById('exam-syllabus').value.trim(),
      driveLink: document.getElementById('exam-drive-link').value.trim(),
      broadcastNotice: document.getElementById('exam-broadcast').checked,
    };

    try {
      if (examId) {
        await apiRequest(`/admin/exams/${encodeURIComponent(examId)}`, { method: 'PUT', body: payload });
        showToast('Exam schedule updated successfully!', 'success');
      } else {
        await apiRequest('/admin/exams', { method: 'POST', body: payload });
        showToast('New exam announced and scheduled!', 'success');
      }
      resetExamForm();
      loadExamsAdmin();
      onRefreshStats();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
