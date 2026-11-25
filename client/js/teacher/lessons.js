/**
 * Teacher Studio: Chapter-Wise Lessons & Verified Notes Module
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, safeUrl, formatDate, formatFileSize, initIcons, showToast, bindModalBackdropAndEsc } from '/js/ui.js';

let lessonsCache = [];
let onRefreshOverview = () => {};
let teacherUser = null;

export function openLessonModal(lesson = null) {
  const modal = document.getElementById('lesson-modal');
  document.getElementById('les-id').value = lesson?.id || '';
  document.getElementById('les-title').value = lesson?.title || '';
  if (lesson?.class_name) document.getElementById('les-class').value = lesson.class_name;
  if (lesson?.subject) document.getElementById('les-subject').value = lesson.subject;
  document.getElementById('les-chapter').value = lesson?.chapter || '';
  document.getElementById('les-video').value = lesson?.video_url || '';
  document.getElementById('les-resource').value = lesson?.resource_url || '';
  document.getElementById('les-summary').value = lesson?.summary || '';
  document.getElementById('lesson-modal-title').textContent = lesson ? 'Edit Chapter Lesson' : 'Publish Chapter Lesson';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeLessonModal() {
  const modal = document.getElementById('lesson-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function closeNoteModal() {
  const modal = document.getElementById('t-note-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

export async function loadTeacherLessons(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-lessons-list');
  try {
    const res = await apiRequest(`/lessons?teacherId=${encodeURIComponent(user.id)}`);
    lessonsCache = res.lessons || [];
    if (lessonsCache.length === 0) {
      listEl.innerHTML = `<div class="col-span-full m3-card p-8 text-center text-xs text-slate-400">No lessons published yet. Tap "Add Lesson" to share YouTube classes or Drive PDFs.</div>`;
      return;
    }

    listEl.innerHTML = lessonsCache.map(les => {
      const videoHref = safeUrl(les.video_url);
      const resHref = safeUrl(les.resource_url);
      return `
        <article class="m3-card p-4 space-y-2.5 flex flex-col justify-between">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="flex items-center gap-1.5">
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${escapeHtml(les.class_name)}</span>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${escapeHtml(les.subject)}</span>
              </div>
              <span class="text-[10px] text-slate-400 tabular-nums">${escapeHtml(formatDate(les.created_at))}</span>
            </div>
            <h4 class="font-extrabold text-sm">${escapeHtml(les.title)}</h4>
            ${les.chapter ? `<p class="text-[11px] font-semibold text-[var(--md-primary)]">${escapeHtml(les.chapter)}</p>` : ''}
            ${les.summary ? `<p class="text-xs text-[var(--md-on-surface-variant)] line-clamp-2">${escapeHtml(les.summary)}</p>` : ''}
          </div>
          <div class="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-[11px] font-bold">
              ${videoHref ? `<a href="${escapeHtml(videoHref)}" target="_blank" rel="noopener noreferrer" class="text-rose-600 hover:underline flex items-center gap-1"><i data-lucide="youtube" class="w-3.5 h-3.5"></i> Video</a>` : ''}
              ${resHref ? `<a href="${escapeHtml(resHref)}" target="_blank" rel="noopener noreferrer" class="text-emerald-700 hover:underline flex items-center gap-1"><i data-lucide="file-text" class="w-3.5 h-3.5"></i> PDF</a>` : ''}
            </div>
            <div class="flex items-center gap-1.5">
              <button class="edit-les-btn px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-xs font-bold" data-id="${escapeHtml(les.id)}">Edit</button>
              <button class="del-les-btn px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold" data-id="${escapeHtml(les.id)}">Delete</button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    initIcons();
    listEl.querySelectorAll('.edit-les-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const les = lessonsCache.find(l => l.id === btn.dataset.id);
        if (les) openLessonModal(les);
      });
    });
    listEl.querySelectorAll('.del-les-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this lesson?')) return;
        try {
          await apiRequest(`/lessons/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Lesson deleted', 'info');
          loadTeacherLessons(teacherUser);
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

export async function loadTeacherNotes(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-notes-list');
  if (!listEl) return;
  try {
    const res = await apiRequest(`/notes?uploaderId=${encodeURIComponent(user.id)}`);
    const notes = res.notes || [];
    if (notes.length === 0) {
      listEl.innerHTML = `<div class="col-span-full m3-card p-6 text-center text-xs text-slate-400">No verified notes uploaded yet.</div>`;
      return;
    }

    listEl.innerHTML = notes.map(n => {
      const isDrive = n.note_type === 'drive_link';
      const driveHref = safeUrl(n.drive_url);
      return `
        <article class="m3-card p-4 space-y-2 flex flex-col justify-between">
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${escapeHtml(n.class_name)} • ${escapeHtml(n.subject)}</span>
              <span class="text-[10px] font-bold text-slate-500 tabular-nums">${isDrive ? 'Drive' : formatFileSize(n.file_size)} • ${n.download_count} views</span>
            </div>
            <h4 class="font-extrabold text-sm">${escapeHtml(n.title)}</h4>
            ${n.chapter ? `<p class="text-[11px] font-semibold text-[var(--md-primary)]">${escapeHtml(n.chapter)}</p>` : ''}
            ${n.description ? `<p class="text-xs text-[var(--md-on-surface-variant)] line-clamp-2">${escapeHtml(n.description)}</p>` : ''}
          </div>
          <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
            ${isDrive && driveHref
              ? `<a href="${escapeHtml(driveHref)}" target="_blank" rel="noopener noreferrer" class="font-bold text-emerald-700 hover:underline">Open Drive</a>`
              : `<a href="/api/notes/${encodeURIComponent(n.id)}/file" target="_blank" class="font-bold text-[var(--md-primary)] hover:underline">Download PDF</a>`}
            <button class="del-tnote-btn px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold" data-id="${escapeHtml(n.id)}">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('.del-tnote-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this note permanently?')) return;
        try {
          await apiRequest(`/notes/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Note deleted', 'info');
          loadTeacherNotes(teacherUser);
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

export function initLessonsModule(user, refreshFn) {
  teacherUser = user;
  onRefreshOverview = refreshFn || (() => {});

  const lessonModal = document.getElementById('lesson-modal');
  const noteModal = document.getElementById('t-note-modal');
  document.getElementById('open-lesson-modal-btn')?.addEventListener('click', () => openLessonModal());
  document.getElementById('close-lesson-modal')?.addEventListener('click', closeLessonModal);
  bindModalBackdropAndEsc(lessonModal, closeLessonModal);

  document.getElementById('open-teacher-note-modal-btn')?.addEventListener('click', () => {
    noteModal.classList.remove('hidden');
    noteModal.classList.add('flex');
  });
  document.getElementById('close-t-note-modal')?.addEventListener('click', closeNoteModal);
  bindModalBackdropAndEsc(noteModal, closeNoteModal);

  const driveCard = document.getElementById('tn-card-drive');
  const fileCard = document.getElementById('tn-card-file');
  document.querySelectorAll('input[name="tn-mode"]').forEach(r => {
    r.addEventListener('change', (e) => {
      const isDrive = e.target.value === 'drive_link';
      document.getElementById('tn-drive-wrap').classList.toggle('hidden', !isDrive);
      document.getElementById('tn-file-wrap').classList.toggle('hidden', isDrive);
      if (driveCard) driveCard.className = `cursor-pointer ${isDrive ? 'border-2 border-[var(--md-primary)] bg-[var(--md-surface-container)]' : 'border border-[var(--md-outline)] bg-white'} p-2.5 rounded-2xl flex items-center gap-2 transition`;
      if (fileCard) fileCard.className = `cursor-pointer ${!isDrive ? 'border-2 border-[var(--md-primary)] bg-[var(--md-surface-container)]' : 'border border-[var(--md-outline)] bg-white'} p-2.5 rounded-2xl flex items-center gap-2 transition`;
    });
  });

  document.getElementById('lesson-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('les-id').value.trim();
    const payload = {
      title: document.getElementById('les-title').value.trim(),
      className: document.getElementById('les-class').value,
      subject: document.getElementById('les-subject').value,
      chapter: document.getElementById('les-chapter').value.trim(),
      videoUrl: document.getElementById('les-video').value.trim(),
      resourceUrl: document.getElementById('les-resource').value.trim(),
      summary: document.getElementById('les-summary').value.trim(),
    };
    try {
      if (id) {
        await apiRequest(`/lessons/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
        showToast('Lesson updated!', 'success');
      } else {
        await apiRequest('/lessons', { method: 'POST', body: payload });
        showToast('Chapter lesson published!', 'success');
      }
      closeLessonModal();
      loadTeacherLessons(teacherUser);
      onRefreshOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('t-note-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.querySelector('input[name="tn-mode"]:checked')?.value || 'drive_link';
    const chapter = document.getElementById('tn-chapter')?.value.trim() || '';
    const description = document.getElementById('tn-desc')?.value.trim() || '';
    try {
      if (mode === 'file') {
        const file = document.getElementById('tn-file').files[0];
        if (!file) { showToast('Select a file first', 'warning'); return; }
        const fd = new FormData();
        fd.append('title', document.getElementById('tn-title').value.trim());
        fd.append('className', document.getElementById('tn-class').value);
        fd.append('subject', document.getElementById('tn-subject').value);
        fd.append('chapter', chapter);
        fd.append('description', description);
        fd.append('noteType', 'file');
        fd.append('file', file);
        await apiRequest('/notes/upload', { method: 'POST', body: fd });
      } else {
        await apiRequest('/notes/upload', {
          method: 'POST',
          body: {
            title: document.getElementById('tn-title').value.trim(),
            className: document.getElementById('tn-class').value,
            subject: document.getElementById('tn-subject').value,
            chapter,
            description,
            noteType: 'drive_link',
            driveUrl: document.getElementById('tn-drive').value.trim(),
          }
        });
      }
      showToast('Verified Note published!', 'success');
      e.target.reset();
      closeNoteModal();
      loadTeacherNotes(teacherUser);
      onRefreshOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
