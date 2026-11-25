/**
 * Admin Core: School Roster, Teacher Assignments & Role Protection Hierarchy
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

export async function loadStudentAccounts(currentAdminUser, onRefreshAll) {
  const container = document.getElementById('admin-students-table');
  const quickPromoterBox = document.getElementById('quick-promoter-box');
  const quickSelect = document.getElementById('quick-promote-select');
  const roleFilter = document.getElementById('roster-role-filter')?.value || '';
  const isViewerRootAdmin = currentAdminUser?.isRootAdmin || currentAdminUser?.username === 'admin';

  if (quickPromoterBox) {
    quickPromoterBox.classList.toggle('hidden', !isViewerRootAdmin);
  }

  try {
    const res = await apiRequest(`/admin/students${roleFilter ? '?role=' + encodeURIComponent(roleFilter) : ''}`);
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
      container.innerHTML = '<div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80 text-xs">No accounts found.</div>';
      return;
    }

    const mobileCardsHtml = students.map(s => {
      const isThisRootAdmin = s.is_root_admin === 1 || s.username === 'admin';
      const isThisAdmin = s.role === 'admin';
      const isThisTeacher = s.role === 'teacher';
      const canManageStatus = !isThisRootAdmin && s.id !== currentAdminUser?.id && ((!isThisAdmin && !isThisTeacher) || isViewerRootAdmin);

      return `
        <div class="bg-white p-4 rounded-2xl border ${isThisRootAdmin ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200/80'} space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h4 class="font-bold text-slate-900 text-sm">${escapeHtml(s.full_name)}</h4>
              <p class="font-mono text-xs text-indigo-600">@${escapeHtml(s.username)}</p>
            </div>
            <div>
              ${isThisRootAdmin
                ? '<span class="px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900">Lead Admin</span>'
                : (isThisAdmin
                  ? '<span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-rose-50 text-rose-700 border border-rose-200">Sec. Admin</span>'
                  : (isThisTeacher
                    ? `<span class="px-2 py-0.5 rounded-full font-bold text-[10px] bg-sky-100 text-sky-800">${s.teacher_type === 'class' ? 'Class Teacher' : 'Teacher'}</span>`
                    : '<span class="px-2 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-600">Student</span>'))}
            </div>
          </div>
          <div class="text-xs text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2 tabular-nums">
            <span>${escapeHtml(s.class_name || 'HQ')} ${s.division ? '• Div ' + escapeHtml(s.division) : ''}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.account_status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">${escapeHtml(s.account_status)}</span>
          </div>
          <div class="pt-2 border-t border-slate-100 flex items-center gap-2 flex-wrap">
            ${isThisTeacher ? `
              <button class="edit-teacher-btn py-1.5 px-3 rounded-xl bg-sky-50 text-sky-700 font-bold text-xs" data-id="${escapeHtml(s.id)}">Edit Assignments</button>
            ` : ''}
            ${isThisRootAdmin ? `<span class="text-xs font-bold text-amber-800">Lead Founder Admin (Protected)</span>` : `
              ${canManageStatus ? `
                <button class="status-toggle-btn py-1.5 px-3 rounded-xl text-xs font-bold ${s.account_status === 'active' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}"
                  data-id="${escapeHtml(s.id)}" data-action="${s.account_status === 'active' ? 'suspended' : 'active'}">
                  ${s.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                </button>
              ` : `<span class="text-[11px] text-slate-400 italic">Protected (Lead Admin Only)</span>`}
              ${isViewerRootAdmin ? `
                <button class="role-toggle-btn py-1.5 px-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs"
                  data-id="${escapeHtml(s.id)}" data-role="${isThisAdmin || isThisTeacher ? 'student' : 'admin'}" data-username="${escapeHtml(s.username)}">
                  ${isThisAdmin || isThisTeacher ? 'Demote to Student' : 'Promote Admin'}
                </button>
              ` : ''}
            `}
          </div>
        </div>
      `;
    }).join('');

    const desktopTableHtml = `
      <div class="overflow-x-auto bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider border-b border-slate-200/80">
              <th class="p-3.5">User / Name</th>
              <th class="p-3.5">Username</th>
              <th class="p-3.5">Class / Scope</th>
              <th class="p-3.5">Role</th>
              <th class="p-3.5">Status</th>
              <th class="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${students.map(s => {
              const isThisRootAdmin = s.is_root_admin === 1 || s.username === 'admin';
              const isThisAdmin = s.role === 'admin';
              const isThisTeacher = s.role === 'teacher';
              const canManageStatus = !isThisRootAdmin && s.id !== currentAdminUser?.id && ((!isThisAdmin && !isThisTeacher) || isViewerRootAdmin);
              const classes = parseList(s.assigned_classes);

              return `
                <tr class="hover:bg-slate-50/70 ${isThisRootAdmin ? 'bg-amber-50/30' : ''}">
                  <td class="p-3.5 font-bold text-slate-900">${escapeHtml(s.full_name)}</td>
                  <td class="p-3.5 font-mono text-indigo-600">@${escapeHtml(s.username)}</td>
                  <td class="p-3.5 tabular-nums">${isThisTeacher ? escapeHtml(classes.join(', ') || s.class_name) : `${escapeHtml(s.class_name || 'HQ')} - ${escapeHtml(s.division || 'A')}`}</td>
                  <td class="p-3.5">
                    ${isThisRootAdmin
                      ? '<span class="px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900">Lead Admin (Root)</span>'
                      : (isThisAdmin
                        ? '<span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-rose-50 text-rose-700 border border-rose-200">Secondary Admin</span>'
                        : (isThisTeacher
                          ? `<span class="px-2 py-0.5 rounded-full font-bold text-[10px] bg-sky-100 text-sky-800">${s.teacher_type === 'class' ? 'Class Teacher' : 'Subject Teacher'}</span>`
                          : '<span class="px-2 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-600">Student</span>'))}
                  </td>
                  <td class="p-3.5">
                    <span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${s.account_status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                      ${escapeHtml(s.account_status)}
                    </span>
                  </td>
                  <td class="p-3.5 text-right space-x-1.5">
                    ${isThisTeacher ? `
                      <button class="edit-teacher-btn px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold" data-id="${escapeHtml(s.id)}">Edit Scope</button>
                    ` : ''}
                    ${isThisRootAdmin ? '<span class="text-[11px] text-amber-700 font-bold italic">Protected</span>' : `
                      ${canManageStatus ? `
                        <button class="status-toggle-btn text-rose-600 font-bold hover:underline" data-id="${escapeHtml(s.id)}" data-action="${s.account_status === 'active' ? 'suspended' : 'active'}">
                          ${s.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      ` : '<span class="text-[11px] text-slate-400 italic">Protected (Root Only)</span>'}
                      ${isViewerRootAdmin ? (isThisAdmin || isThisTeacher ? `
                        <button class="role-toggle-btn px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold ml-1" data-id="${escapeHtml(s.id)}" data-role="student" data-username="${escapeHtml(s.username)}">
                          Demote
                        </button>
                      ` : `
                        <button class="role-toggle-btn px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold ml-1" data-id="${escapeHtml(s.id)}" data-role="admin" data-username="${escapeHtml(s.username)}">
                          Promote Admin
                        </button>
                      `) : ''}
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
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-rose-600 bg-rose-50 rounded-2xl text-xs">${escapeHtml(err.message)}</div>`;
  }
}

export function initQuickPromoter(onRefreshAll) {
  const etModal = document.getElementById('edit-teacher-modal');
  const closeEt = () => { etModal?.classList.add('hidden'); etModal?.classList.remove('flex'); };
  document.getElementById('close-et-modal')?.addEventListener('click', closeEt);
  bindModalBackdropAndEsc(etModal, closeEt);

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
    const roleSel = document.getElementById('quick-promote-role');
    const userId = select?.value;
    const newRole = roleSel?.value || 'admin';
    if (!userId) {
      showToast('Please select a user from the dropdown first.', 'error');
      return;
    }
    const label = select.options[select.selectedIndex]?.text || '';
    if (!confirm(`Update ${label} to ${newRole}?`)) return;

    try {
      const res = await apiRequest('/admin/change-role', { method: 'POST', body: { userId, newRole } });
      showToast(res.message || `User updated to ${newRole}!`, 'success');
      onRefreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
