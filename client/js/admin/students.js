/**
 * Admin Core: School Roster, Teacher Assignments, Delete & Role Protection Hierarchy
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, initIcons, showToast, bindModalBackdropAndEsc } from '/js/ui.js';

function parseList(val) {
  try {
    const arr = JSON.parse(val || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

let rosterCache = [];

function getScopeDisplay(s) {
  const isRoot = s.is_root_admin === 1 || s.username === 'admin';
  if (isRoot || s.role === 'admin') {
    return 'Admin';
  }
  if (s.role === 'teacher') {
    const classes = parseList(s.assigned_classes);
    if (s.teacher_designation) return s.teacher_designation;
    if (classes.length > 1) return `${classes[0]} +${classes.length - 1}`;
    return classes[0] || s.class_name || 'Faculty';
  }
  return `${s.class_name || '-'}${s.division ? ' - ' + s.division : ''}${s.roll_number ? ' • #' + s.roll_number : ''}`;
}

export async function loadStudentAccounts(currentAdminUser, onRefreshAll) {
  const container = document.getElementById('admin-students-table');
  const quickPromoterBox = document.getElementById('quick-promoter-box');
  const quickSelect = document.getElementById('quick-promote-select');
  const roleFilter = document.getElementById('roster-role-filter')?.value || '';
  const searchQuery = document.getElementById('roster-search-input')?.value.trim() || '';
  const isViewerRootAdmin = currentAdminUser?.isRootAdmin || currentAdminUser?.username === 'admin';

  if (quickPromoterBox) {
    quickPromoterBox.classList.toggle('hidden', !isViewerRootAdmin);
  }

  try {
    const params = new URLSearchParams();
    if (roleFilter) params.append('role', roleFilter);
    if (searchQuery) params.append('search', searchQuery);
    const res = await apiRequest(`/admin/students${params.toString() ? '?' + params.toString() : ''}`);
    const students = res.students || [];
    rosterCache = students;

    if (quickSelect && isViewerRootAdmin) {
      const eligible = students.filter(
        s => s.is_root_admin !== 1 && s.username !== 'admin' && s.role !== 'admin' && s.account_status === 'active'
      );
      quickSelect.innerHTML = eligible.length === 0
        ? '<option value="">No eligible active users available</option>'
        : '<option value="">-- Choose active user --</option>' +
          eligible.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name)} (@${escapeHtml(s.username)}) - ${escapeHtml(s.role)}</option>`).join('');
    }

    if (students.length === 0) {
      container.innerHTML = '<div class="m3-card p-8 text-center text-slate-400 text-xs">No accounts found.</div>';
      return;
    }

    const mobileCardsHtml = students.map(s => {
      const isThisRootAdmin = s.is_root_admin === 1 || s.username === 'admin';
      const isThisAdmin = s.role === 'admin';
      const isThisTeacher = s.role === 'teacher';
      const canManageStatus = !isThisRootAdmin && s.id !== currentAdminUser?.id && ((!isThisAdmin && !isThisTeacher) || isViewerRootAdmin);
      const canDeleteUser = !isThisRootAdmin && s.id !== currentAdminUser?.id && ((!isThisAdmin && !isThisTeacher) || isViewerRootAdmin);

      return `
        <div class="m3-card p-4 ${isThisRootAdmin ? 'border-amber-300 bg-amber-50/20' : ''} space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h4 class="font-extrabold text-sm">${escapeHtml(s.full_name)}</h4>
              <p class="font-mono text-xs text-[var(--md-primary)] font-semibold">@${escapeHtml(s.username)}</p>
            </div>
            <div>
              ${isThisRootAdmin
                ? '<span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900">Admin (Lead)</span>'
                : (isThisAdmin
                  ? '<span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-rose-100 text-rose-800">Admin</span>'
                  : (isThisTeacher
                    ? `<span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${s.teacher_type === 'class' ? 'Class Teacher' : 'Teacher'}</span>`
                    : '<span class="px-2.5 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-700">Student</span>'))}
            </div>
          </div>
          <div class="text-xs text-[var(--md-on-surface-variant)] flex items-center justify-between border-t border-[var(--md-outline)] pt-2 tabular-nums">
            <span class="truncate pr-2">${escapeHtml(getScopeDisplay(s))}</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.account_status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${escapeHtml(s.account_status)}</span>
          </div>
          <div class="pt-2 border-t border-[var(--md-outline)] flex items-center gap-2 flex-wrap">
            ${isThisTeacher ? `
              <button class="edit-teacher-btn m3-btn-tonal py-1.5 px-3 text-xs" data-id="${escapeHtml(s.id)}">Edit Scope</button>
            ` : ''}
            ${isThisRootAdmin ? `<span class="text-xs font-bold text-amber-800">Admin (Protected)</span>` : `
              ${canManageStatus ? `
                <button class="status-toggle-btn py-1.5 px-3 rounded-full text-xs font-bold ${s.account_status === 'active' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}"
                  data-id="${escapeHtml(s.id)}" data-action="${s.account_status === 'active' ? 'suspended' : 'active'}">
                  ${s.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                </button>
              ` : `<span class="text-[11px] text-slate-400 italic">Protected (Lead Admin Only)</span>`}
              ${isViewerRootAdmin ? `
                <button class="role-toggle-btn py-1.5 px-3 rounded-full bg-[var(--md-surface-container)] text-xs font-bold"
                  data-id="${escapeHtml(s.id)}" data-role="${isThisAdmin || isThisTeacher ? 'student' : 'admin'}" data-username="${escapeHtml(s.username)}">
                  ${isThisAdmin || isThisTeacher ? 'Demote to Student' : 'Promote Admin'}
                </button>
              ` : ''}
              ${canDeleteUser ? `
                <button class="delete-user-btn py-1.5 px-3 rounded-full bg-rose-600 text-white text-xs font-bold"
                  data-id="${escapeHtml(s.id)}" data-username="${escapeHtml(s.username)}">Delete</button>
              ` : ''}
            `}
          </div>
        </div>
      `;
    }).join('');

    const desktopTableHtml = `
      <div class="overflow-x-auto m3-card">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-[var(--md-surface-container)] text-[var(--md-on-surface-variant)] font-bold uppercase tracking-wider border-b border-[var(--md-outline)]">
              <th class="p-3.5">User / Name</th>
              <th class="p-3.5">Username</th>
              <th class="p-3.5">Class / Scope</th>
              <th class="p-3.5">Role</th>
              <th class="p-3.5">Status</th>
              <th class="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--md-outline)]">
            ${students.map(s => {
              const isThisRootAdmin = s.is_root_admin === 1 || s.username === 'admin';
              const isThisAdmin = s.role === 'admin';
              const isThisTeacher = s.role === 'teacher';
              const canManageStatus = !isThisRootAdmin && s.id !== currentAdminUser?.id && ((!isThisAdmin && !isThisTeacher) || isViewerRootAdmin);
              const canDeleteUser = !isThisRootAdmin && s.id !== currentAdminUser?.id && ((!isThisAdmin && !isThisTeacher) || isViewerRootAdmin);

              return `
                <tr class="hover:bg-[var(--md-surface-container)]/50 ${isThisRootAdmin ? 'bg-amber-50/30' : ''}">
                  <td class="p-3.5 font-bold">${escapeHtml(s.full_name)}</td>
                  <td class="p-3.5 font-mono text-[var(--md-primary)] font-semibold">@${escapeHtml(s.username)}</td>
                  <td class="p-3.5 tabular-nums">${escapeHtml(getScopeDisplay(s))}</td>
                  <td class="p-3.5">
                    ${isThisRootAdmin
                      ? '<span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900">Admin (Lead)</span>'
                      : (isThisAdmin
                        ? '<span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-rose-100 text-rose-800">Admin</span>'
                        : (isThisTeacher
                          ? `<span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${s.teacher_type === 'class' ? 'Class Teacher' : 'Subject Teacher'}</span>`
                          : '<span class="px-2.5 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-700">Student</span>'))}
                  </td>
                  <td class="p-3.5">
                    <span class="px-2.5 py-0.5 rounded-full font-bold uppercase text-[10px] ${s.account_status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                      ${escapeHtml(s.account_status)}
                    </span>
                  </td>
                  <td class="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                    ${isThisTeacher ? `
                      <button class="edit-teacher-btn px-2.5 py-1 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] font-bold" data-id="${escapeHtml(s.id)}">Edit Scope</button>
                    ` : ''}
                    ${isThisRootAdmin ? '<span class="text-[11px] text-amber-800 font-bold italic">Protected</span>' : `
                      ${canManageStatus ? `
                        <button class="status-toggle-btn text-rose-600 font-bold hover:underline" data-id="${escapeHtml(s.id)}" data-action="${s.account_status === 'active' ? 'suspended' : 'active'}">
                          ${s.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      ` : '<span class="text-[11px] text-slate-400 italic">Protected (Root Only)</span>'}
                      ${isViewerRootAdmin ? (isThisAdmin || isThisTeacher ? `
                        <button class="role-toggle-btn px-2.5 py-1 rounded-full bg-[var(--md-surface-container)] hover:brightness-95 font-bold ml-1" data-id="${escapeHtml(s.id)}" data-role="student" data-username="${escapeHtml(s.username)}">
                          Demote
                        </button>
                      ` : `
                        <button class="role-toggle-btn px-2.5 py-1 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-bold ml-1" data-id="${escapeHtml(s.id)}" data-role="admin" data-username="${escapeHtml(s.username)}">
                          Promote Admin
                        </button>
                      `) : ''}
                      ${canDeleteUser ? `
                        <button class="delete-user-btn px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold ml-1" data-id="${escapeHtml(s.id)}" data-username="${escapeHtml(s.username)}">Delete</button>
                      ` : ''}
                    `}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.innerHTML = `
      <div class="block md:hidden space-y-3">${mobileCardsHtml}</div>
      <div class="hidden md:block">${desktopTableHtml}</div>
    `;

    initIcons();

    container.querySelectorAll('.edit-teacher-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = rosterCache.find(u => u.id === btn.dataset.id);
        if (!t) return;
        document.getElementById('et-user-id').value = t.id;
        document.getElementById('et-heading').textContent = `Edit Teacher: ${t.full_name} (@${t.username})`;
        document.getElementById('et-type').value = t.teacher_type === 'class' ? 'class' : 'subject';
        document.getElementById('et-class').value = t.class_name || '';
        document.getElementById('et-div').value = t.division || '';
        document.getElementById('et-classes').value = parseList(t.assigned_classes).join(', ');
        document.getElementById('et-subjects').value = parseList(t.assigned_subjects).join(', ');
        document.getElementById('et-designation').value = t.teacher_designation || '';
        document.getElementById('et-info').value = t.teacher_info || '';
        const m = document.getElementById('edit-teacher-modal');
        m.classList.remove('hidden');
        m.classList.add('flex');
      });
    });

    container.querySelectorAll('.status-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await apiRequest('/admin/student-status', {
            method: 'POST',
            body: { studentId: btn.dataset.id, status: btn.dataset.action }
          });
          showToast(`Account status updated to ${btn.dataset.action}`, 'success');
          onRefreshAll();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.role-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.id;
        const newRole = btn.dataset.role;
        const username = btn.dataset.username || 'this user';
        if (!confirm(`Change @${username}'s role to ${newRole}?`)) return;
        try {
          const res = await apiRequest('/admin/change-role', { method: 'POST', body: { userId, newRole } });
          showToast(res.message || `User @${username} role updated!`, 'success');
          onRefreshAll();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const username = btn.dataset.username || 'this account';
        if (!confirm(`Permanently delete @${username}? This action cannot be undone.`)) return;
        try {
          const res = await apiRequest(`/admin/users/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast(res.message || `Removed @${username}`, 'info');
          onRefreshAll();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="m3-card p-6 text-center text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export function initQuickPromoter(onRefreshAll) {
  const etModal = document.getElementById('edit-teacher-modal');
  const closeEt = () => { etModal?.classList.add('hidden'); etModal?.classList.remove('flex'); };
  document.getElementById('close-et-modal')?.addEventListener('click', closeEt);
  bindModalBackdropAndEsc(etModal, closeEt);

  const roleSel = document.getElementById('quick-promote-role');
  const teacherOpts = document.getElementById('quick-promote-teacher-opts');
  roleSel?.addEventListener('change', () => {
    teacherOpts?.classList.toggle('hidden', roleSel.value !== 'teacher');
  });

  document.getElementById('edit-teacher-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiRequest('/admin/teacher-profile', {
        method: 'POST',
        body: {
          userId: document.getElementById('et-user-id').value,
          teacherType: document.getElementById('et-type').value,
          className: document.getElementById('et-class').value.trim(),
          division: document.getElementById('et-div').value.trim().toUpperCase(),
          assignedClasses: document.getElementById('et-classes').value.split(',').map(s => s.trim()).filter(Boolean),
          assignedSubjects: document.getElementById('et-subjects').value.split(',').map(s => s.trim()).filter(Boolean),
          teacherDesignation: document.getElementById('et-designation').value.trim(),
          teacherInfo: document.getElementById('et-info').value.trim(),
        }
      });
      showToast(res.message || 'Teacher assignments updated!', 'success');
      closeEt();
      onRefreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('quick-promote-btn')?.addEventListener('click', async () => {
    const select = document.getElementById('quick-promote-select');
    const userId = select?.value;
    const newRole = roleSel?.value || 'admin';
    if (!userId) {
      showToast('Please select a user from the dropdown first.', 'error');
      return;
    }
    const label = select.options[select.selectedIndex]?.text || '';
    if (!confirm(`Update ${label} to ${newRole}?`)) return;

    const body = { userId, newRole };
    if (newRole === 'teacher') {
      body.teacherType = document.getElementById('qp-teacher-type')?.value || 'subject';
      const clss = (document.getElementById('qp-teacher-classes')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      const subs = (document.getElementById('qp-teacher-subjects')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
      if (clss.length) {
        body.assignedClasses = clss;
        body.className = clss[0];
      }
      if (subs.length) body.assignedSubjects = subs;
    }

    try {
      const res = await apiRequest('/admin/change-role', { method: 'POST', body });
      showToast(res.message || `User updated to ${newRole}!`, 'success');
      onRefreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
