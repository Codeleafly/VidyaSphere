/**
 * Admin Core: Student Roster & Role Management
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, initIcons, showToast } from '/js/ui.js';

export async function loadStudentAccounts(currentAdminUser, onRefreshAll) {
  const container = document.getElementById('admin-students-table');
  const quickPromoterBox = document.getElementById('quick-promoter-box');
  const quickSelect = document.getElementById('quick-promote-select');
  const isViewerRootAdmin = currentAdminUser?.isRootAdmin || currentAdminUser?.username === 'admin';

  if (quickPromoterBox) {
    quickPromoterBox.classList.toggle('hidden', !isViewerRootAdmin);
  }

  try {
    const res = await apiRequest('/admin/students');
    const students = res.students || [];

    if (quickSelect && isViewerRootAdmin) {
      const eligible = students.filter(
        s => s.is_root_admin !== 1 && s.username !== 'admin' && s.role !== 'admin' && s.account_status === 'active'
      );
      quickSelect.innerHTML = eligible.length === 0
        ? '<option value="">No eligible active students available to promote</option>'
        : '<option value="">-- Choose active student to promote as Secondary Admin --</option>' +
          eligible.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.full_name)} (@${escapeHtml(s.username)}) - ${escapeHtml(s.class_name)} Div ${escapeHtml(s.division)}</option>`).join('');
    }

    if (students.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80 text-xs">No student profiles registered.</div>';
      return;
    }

    const mobileCardsHtml = students.map(s => {
      const isThisRootAdmin = s.is_root_admin === 1 || s.username === 'admin';
      const isThisAdmin = s.role === 'admin';
      const canManageStatus = !isThisRootAdmin && s.id !== currentAdminUser?.id && (!isThisAdmin || isViewerRootAdmin);

      return `
        <div class="bg-white p-4 rounded-2xl border ${isThisRootAdmin ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200/80'} shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <h4 class="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                ${escapeHtml(s.full_name)}
                ${isThisRootAdmin ? '<span class="text-[9px] font-bold uppercase bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full border border-amber-300">Root</span>' : ''}
              </h4>
              <p class="font-mono text-xs text-indigo-600 font-medium">@${escapeHtml(s.username)}</p>
            </div>
            <div>
              ${isThisRootAdmin
                ? '<span class="px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900 border border-amber-300">Lead Admin</span>'
                : (isThisAdmin
                  ? '<span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-rose-50 text-rose-700 border border-rose-200">Sec. Admin</span>'
                  : '<span class="px-2 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-600">Student</span>')}
            </div>
          </div>

          <div class="text-xs text-slate-500 flex items-center justify-between border-t border-slate-100 pt-2 tabular-nums">
            <span>${escapeHtml(s.class_name || 'HQ')} • Div ${escapeHtml(s.division || 'A')} • Roll: <strong>${escapeHtml(s.roll_number || '01')}</strong></span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${s.account_status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
              ${escapeHtml(s.account_status)}
            </span>
          </div>

          <div class="pt-2 border-t border-slate-100 flex items-center gap-2">
            ${isThisRootAdmin ? `
              <span class="w-full text-center py-2 text-xs font-bold text-amber-800 bg-amber-50 rounded-xl border border-amber-200">
                Lead Founder Admin (Protected)
              </span>
            ` : `
              ${isViewerRootAdmin ? (isThisAdmin ? `
                <button class="role-toggle-btn flex-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center gap-1 transition"
                  data-id="${escapeHtml(s.id)}" data-role="student" data-username="${escapeHtml(s.username)}">
                  <i data-lucide="user-minus" class="w-3.5 h-3.5"></i> Demote
                </button>
              ` : `
                <button class="role-toggle-btn flex-1 py-2 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-1 transition"
                  data-id="${escapeHtml(s.id)}" data-role="admin" data-username="${escapeHtml(s.username)}">
                  <i data-lucide="crown" class="w-3.5 h-3.5 text-amber-300"></i> Promote Admin
                </button>
              `) : ''}
              ${canManageStatus ? `
                <button class="status-toggle-btn py-2 px-3 rounded-xl text-xs font-bold transition ${s.account_status === 'active' ? 'bg-rose-50 text-rose-600 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}"
                  data-id="${escapeHtml(s.id)}" data-action="${s.account_status === 'active' ? 'suspended' : 'active'}">
                  ${s.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                </button>
              ` : '<span class="text-[11px] text-slate-400 italic">Admin Protected</span>'}
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
              <th class="p-3.5">Class</th>
              <th class="p-3.5">Role</th>
              <th class="p-3.5">Status</th>
              <th class="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            ${students.map(s => {
              const isThisRootAdmin = s.is_root_admin === 1 || s.username === 'admin';
              const isThisAdmin = s.role === 'admin';
              const canManageStatus = !isThisRootAdmin && s.id !== currentAdminUser?.id && (!isThisAdmin || isViewerRootAdmin);

              return `
                <tr class="hover:bg-slate-50/70 ${isThisRootAdmin ? 'bg-amber-50/30' : ''}">
                  <td class="p-3.5 font-bold text-slate-900">${escapeHtml(s.full_name)}</td>
                  <td class="p-3.5 font-mono text-indigo-600">@${escapeHtml(s.username)}</td>
                  <td class="p-3.5 tabular-nums">${escapeHtml(s.class_name || 'HQ')} - ${escapeHtml(s.division || 'A')}</td>
                  <td class="p-3.5">
                    ${isThisRootAdmin
                      ? '<span class="px-2 py-0.5 rounded-full font-bold text-[10px] bg-amber-100 text-amber-900 border border-amber-300">Lead Admin (Root)</span>'
                      : (isThisAdmin
                        ? '<span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] bg-rose-50 text-rose-700 border border-rose-200">Secondary Admin</span>'
                        : '<span class="px-2 py-0.5 rounded-full font-semibold text-[10px] bg-slate-100 text-slate-600">Student</span>')}
                  </td>
                  <td class="p-3.5">
                    <span class="px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${s.account_status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}">
                      ${escapeHtml(s.account_status)}
                    </span>
                  </td>
                  <td class="p-3.5 text-right space-x-2">
                    ${isThisRootAdmin ? '<span class="text-[11px] text-amber-700 font-bold italic">Protected</span>' : `
                      ${canManageStatus ? `
                        <button class="status-toggle-btn text-rose-600 font-bold hover:underline" data-id="${escapeHtml(s.id)}" data-action="${s.account_status === 'active' ? 'suspended' : 'active'}">
                          ${s.account_status === 'active' ? 'Suspend' : 'Reactivate'}
                        </button>
                      ` : '<span class="text-[11px] text-slate-400 italic">Protected</span>'}
                      ${isViewerRootAdmin ? (isThisAdmin ? `
                        <button class="role-toggle-btn px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold ml-1 transition" data-id="${escapeHtml(s.id)}" data-role="student" data-username="${escapeHtml(s.username)}">
                          Demote to Student
                        </button>
                      ` : `
                        <button class="role-toggle-btn px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-bold ml-1 transition" data-id="${escapeHtml(s.id)}" data-role="admin" data-username="${escapeHtml(s.username)}">
                          Promote to Admin
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
        const msg = newRole === 'admin'
          ? `Promote @${username} to Secondary Admin?`
          : `Demote @${username} back to Student?`;
        if (!confirm(msg)) return;
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
  document.getElementById('quick-promote-btn')?.addEventListener('click', async () => {
    const select = document.getElementById('quick-promote-select');
    const userId = select?.value;
    if (!userId) {
      showToast('Please select an active student from the dropdown first.', 'error');
      return;
    }
    const label = select.options[select.selectedIndex]?.text || '';
    if (!confirm(`Promote ${label} to Secondary Admin?`)) return;

    try {
      const res = await apiRequest('/admin/change-role', { method: 'POST', body: { userId, newRole: 'admin' } });
      showToast(res.message || 'User promoted to Secondary Admin!', 'success');
      onRefreshAll();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}
