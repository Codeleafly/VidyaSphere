/**
 * Teacher Studio: Scoped Notices, Class Teacher/Admin Unit Tests & Class Student Approvals
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDate, initIcons, showToast } from '/js/ui.js';

let teacherUser = null;
let onRefreshOverview = () => {};

export async function loadTeacherNotices(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-notices-list');
  try {
    const res = await apiRequest('/announcements');
    const isAdmin = user.role === 'admin';
    const allowed = new Set([...(user.assignedClasses || []), ...(user.teacherType === 'class' && user.className ? [user.className] : [])]);
    const notices = isAdmin
      ? (res.announcements || [])
      : (res.announcements || []).filter(a => allowed.has(a.target_class));

    if (notices.length === 0) {
      listEl.innerHTML = `<div class="m3-card p-6 text-center text-xs text-slate-400">No active notices in your scope.</div>`;
      return;
    }

    listEl.innerHTML = notices.map(a => `
      <div class="m3-card p-4 flex items-start justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${a.target_class === 'all' ? 'All Classes' : escapeHtml(a.target_class)}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 text-slate-700">${escapeHtml(a.priority)}</span>
            <span class="text-[10px] text-slate-400">${escapeHtml(formatDate(a.created_at))}</span>
          </div>
          <h4 class="font-bold text-sm">${escapeHtml(a.title)}</h4>
          <p class="text-xs text-[var(--md-on-surface-variant)]">${escapeHtml(a.content)}</p>
        </div>
        ${isAdmin || a.author_role !== 'admin' || a.author_id === user.id ? `
          <button class="del-t-ann-btn px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 text-[11px] font-bold shrink-0" data-id="${escapeHtml(a.id)}">Delete</button>
        ` : ''}
      </div>
    `).join('');

    listEl.querySelectorAll('.del-t-ann-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this notice?')) return;
        try {
          await apiRequest(`/admin/announcements/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Notice deleted', 'info');
          loadTeacherNotices(teacherUser);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="m3-card p-4 text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export async function loadTeacherUnitTests(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-unit-tests-list');
  const isAdmin = user.role === 'admin';
  if (!listEl || (!isAdmin && user.teacherType !== 'class')) return;

  try {
    const url = isAdmin ? '/exams' : `/exams?class=${encodeURIComponent(user.className)}`;
    const res = await apiRequest(url);
    const tests = (res.exams || []).filter(e =>
      e.exam_type === 'unit_test' && (isAdmin || e.class_name === user.className)
    );
    if (tests.length === 0) {
      listEl.innerHTML = `<div class="m3-card p-6 text-center text-xs text-slate-400">No unit tests scheduled yet.</div>`;
      return;
    }

    listEl.innerHTML = tests.map(ex => `
      <div class="m3-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="space-y-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">Unit Test</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--md-surface-container)]">${escapeHtml(ex.class_name)}</span>
            <span class="font-bold text-sm">${escapeHtml(ex.title)} (${escapeHtml(ex.subject)})</span>
          </div>
          <p class="text-xs text-slate-500 tabular-nums">${escapeHtml(ex.exam_date)} ${ex.start_time ? '• ' + escapeHtml(ex.start_time) : ''} ${ex.syllabus ? '• ' + escapeHtml(ex.syllabus) : ''}</p>
        </div>
        <div class="flex gap-1.5">
          <button class="edit-ut-btn px-3 py-1 rounded-full bg-slate-100 text-xs font-bold"
            data-id="${escapeHtml(ex.id)}" data-title="${escapeHtml(ex.title)}" data-subject="${escapeHtml(ex.subject)}"
            data-date="${escapeHtml(ex.exam_date)}" data-start="${escapeHtml(ex.start_time || '')}"
            data-syllabus="${escapeHtml(ex.syllabus || '')}" data-class="${escapeHtml(ex.class_name || '')}">Edit</button>
          <button class="del-ut-btn px-3 py-1 rounded-full bg-rose-50 text-rose-700 text-xs font-bold" data-id="${escapeHtml(ex.id)}">Delete</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.edit-ut-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('t-exam-id').value = btn.dataset.id;
        document.getElementById('t-exam-title').value = btn.dataset.title;
        document.getElementById('t-exam-subject').value = btn.dataset.subject;
        document.getElementById('t-exam-date').value = btn.dataset.date;
        document.getElementById('t-exam-start').value = btn.dataset.start;
        document.getElementById('t-exam-syllabus').value = btn.dataset.syllabus;
        const clsSel = document.getElementById('t-exam-class-select');
        if (clsSel && btn.dataset.class) clsSel.value = btn.dataset.class;
        document.getElementById('t-exam-cancel-btn').classList.remove('hidden');
      });
    });

    listEl.querySelectorAll('.del-ut-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this unit test?')) return;
        try {
          await apiRequest(`/teacher/exams/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Unit test deleted', 'info');
          loadTeacherUnitTests(teacherUser);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="m3-card p-4 text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export async function loadClassRoster(user) {
  teacherUser = user;
  const listEl = document.getElementById('teacher-roster-list');
  const filter = document.getElementById('t-roster-filter')?.value || '';
  const classFilter = document.getElementById('t-roster-class-filter')?.value || '';
  const isAdmin = user.role === 'admin';
  if (!listEl || (!isAdmin && user.teacherType !== 'class')) return;

  document.getElementById('roster-scope-subtitle').textContent = isAdmin
    ? 'School-wide student approvals & roster (Admin access)'
    : `Scoped to ${user.className}${user.division ? ' • Division ' + user.division : ''}`;

  try {
    const params = new URLSearchParams();
    if (filter) params.append('status', filter);
    if (isAdmin && classFilter) params.append('className', classFilter);
    const res = await apiRequest(`/teacher/students${params.toString() ? '?' + params.toString() : ''}`);
    const students = res.students || [];
    if (students.length === 0) {
      listEl.innerHTML = `<div class="m3-card p-8 text-center text-xs text-slate-400">No students matching this filter.</div>`;
      return;
    }

    listEl.innerHTML = students.map(s => {
      const isPending = s.account_status === 'pending';
      return `
        <div class="m3-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-bold text-sm">${escapeHtml(s.full_name)}</span>
              <span class="font-mono text-xs text-[var(--md-primary)]">@${escapeHtml(s.username)}</span>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${isPending ? 'bg-amber-100 text-amber-800' : (s.account_status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800')}">${escapeHtml(s.account_status)}</span>
            </div>
            <p class="text-xs text-slate-500 tabular-nums mt-0.5">${escapeHtml(s.class_name)} • Div ${escapeHtml(s.division || '-')} • Roll #${escapeHtml(s.roll_number || '-')}</p>
          </div>
          ${isPending ? `
            <div class="flex gap-2 shrink-0">
              <button class="ct-approve-btn m3-btn-primary px-3.5 py-2 text-xs flex items-center gap-1" data-id="${escapeHtml(s.id)}">
                <i data-lucide="check" class="w-3.5 h-3.5"></i> Approve
              </button>
              <button class="ct-reject-btn px-3 py-2 rounded-full bg-rose-50 text-rose-700 font-bold text-xs" data-id="${escapeHtml(s.id)}">Reject</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    initIcons();

    listEl.querySelectorAll('.ct-approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await apiRequest('/teacher/students/approve', { method: 'POST', body: { userId: btn.dataset.id } });
          showToast('Student approved!', 'success');
          loadClassRoster(teacherUser);
          onRefreshOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    listEl.querySelectorAll('.ct-reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Rejection reason (optional):');
        if (reason === null) return;
        try {
          await apiRequest('/teacher/students/reject', { method: 'POST', body: { userId: btn.dataset.id, reason: reason.trim() } });
          showToast('Student request rejected', 'info');
          loadClassRoster(teacherUser);
          onRefreshOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="m3-card p-4 text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export function initClassRoomModule(user, refreshFn) {
  teacherUser = user;
  onRefreshOverview = refreshFn || (() => {});

  document.getElementById('teacher-notice-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/admin/announcements', {
        method: 'POST',
        body: {
          title: document.getElementById('t-ann-title').value.trim(),
          targetClass: document.getElementById('t-ann-class').value,
          priority: document.getElementById('t-ann-priority').value,
          content: document.getElementById('t-ann-content').value.trim(),
        }
      });
      showToast('Scoped notice published (30-day expiry)!', 'success');
      e.target.reset();
      loadTeacherNotices(teacherUser);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('t-exam-cancel-btn')?.addEventListener('click', () => {
    document.getElementById('teacher-exam-form').reset();
    document.getElementById('t-exam-id').value = '';
    document.getElementById('t-exam-cancel-btn').classList.add('hidden');
  });

  document.getElementById('teacher-exam-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('t-exam-id').value.trim();
    const isAdmin = teacherUser.role === 'admin';
    const selectedAdminClass = document.getElementById('t-exam-class-select')?.value;
    const payload = {
      title: document.getElementById('t-exam-title').value.trim(),
      subject: document.getElementById('t-exam-subject').value.trim(),
      examDate: document.getElementById('t-exam-date').value,
      startTime: document.getElementById('t-exam-start').value.trim(),
      syllabus: document.getElementById('t-exam-syllabus').value.trim(),
      className: isAdmin ? (selectedAdminClass || 'All Classes') : teacherUser.className,
    };
    try {
      if (id) {
        await apiRequest(`/teacher/exams/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
        showToast('Unit test updated!', 'success');
      } else {
        await apiRequest('/teacher/exams', { method: 'POST', body: payload });
        showToast('Unit test scheduled!', 'success');
      }
      e.target.reset();
      document.getElementById('t-exam-id').value = '';
      document.getElementById('t-exam-cancel-btn').classList.add('hidden');
      loadTeacherUnitTests(teacherUser);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('t-roster-filter')?.addEventListener('change', () => loadClassRoster(teacherUser));
  document.getElementById('t-roster-class-filter')?.addEventListener('change', () => loadClassRoster(teacherUser));
}
