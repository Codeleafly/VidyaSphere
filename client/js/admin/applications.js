/**
 * Admin Core: Student & Teacher Account Verification Queue
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDate, initIcons, showToast } from '/js/ui.js';

function parseList(val) {
  try {
    const arr = JSON.parse(val || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export async function loadApplications(currentAdminUser, onRefreshAll) {
  const regFilter = document.getElementById('reg-status-filter');
  const roleFilter = document.getElementById('reg-role-filter');
  const appsContainer = document.getElementById('applications-container');
  const params = new URLSearchParams();
  if (regFilter?.value) params.append('status', regFilter.value);
  if (roleFilter?.value) params.append('role', roleFilter.value);
  const url = `/admin/registrations${params.toString() ? '?' + params.toString() : ''}`;

  try {
    const res = await apiRequest(url);
    const list = res.registrations || [];

    if (list.length === 0) {
      appsContainer.innerHTML = `
        <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80">
          <i data-lucide="check-check" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p class="text-sm font-semibold text-slate-700">No applications in this queue</p>
          <p class="text-xs text-slate-400 mt-1">Switch filter status above to view other records.</p>
        </div>
      `;
      initIcons();
      return;
    }

    const isViewerRootAdmin = currentAdminUser?.isRootAdmin || currentAdminUser?.username === 'admin';

    appsContainer.innerHTML = list.map(reg => {
      const isPending = reg.account_status === 'pending';
      const isApproved = reg.account_status === 'active';
      const isTeacher = reg.role === 'teacher';
      const classes = parseList(reg.assigned_classes);
      const subjects = parseList(reg.assigned_subjects);
      const badgeClass = isPending
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : (isApproved ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200');

      return `
        <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 w-full break-words">
          <div class="space-y-1.5 w-full sm:w-auto">
            <div class="flex items-center gap-2 flex-wrap">
              <h4 class="font-bold text-slate-900 text-sm sm:text-base">${escapeHtml(reg.full_name)}</h4>
              <span class="font-mono text-xs text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">@${escapeHtml(reg.username)}</span>
              ${isTeacher ? `<span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-sky-100 text-sky-800">${reg.teacher_type === 'class' ? 'Class Teacher' : 'Subject Teacher'}</span>` : ''}
              <span class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border ${badgeClass}">
                ${escapeHtml(reg.account_status)}
              </span>
            </div>
            ${isTeacher ? `
              <p class="text-xs text-slate-600">
                <strong>Classes:</strong> ${escapeHtml(classes.join(', ') || reg.class_name)}
                ${reg.division ? ` (Div ${escapeHtml(reg.division)})` : ''} •
                <strong>Subjects:</strong> ${escapeHtml(subjects.join(', ') || '-')}
              </p>
            ` : `
              <p class="text-xs text-slate-500 tabular-nums">
                ${escapeHtml(reg.class_name)} • Div ${escapeHtml(reg.division)} • Roll: <strong>${escapeHtml(reg.roll_number)}</strong>
              </p>
            `}
            ${reg.email ? `<p class="text-[11px] text-indigo-600 font-medium flex items-center gap-1"><i data-lucide="mail" class="w-3 h-3"></i> ${escapeHtml(reg.email)}</p>` : ''}
            <p class="text-[11px] text-slate-400">Applied: ${escapeHtml(formatDate(reg.created_at))}</p>
          </div>

          <div class="flex items-center gap-2 w-full sm:w-auto shrink-0 flex-wrap">
            ${isPending ? `
              <button class="approve-btn flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1 transition"
                data-id="${escapeHtml(reg.id)}" data-username="${escapeHtml(reg.username)}" data-role="${isTeacher ? 'teacher' : 'student'}">
                <i data-lucide="check" class="w-3.5 h-3.5"></i> Approve ${isTeacher ? 'Teacher' : ''}
              </button>
              ${isViewerRootAdmin && !isTeacher ? `
                <button class="approve-btn flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs flex items-center justify-center gap-1 transition"
                  data-id="${escapeHtml(reg.id)}" data-username="${escapeHtml(reg.username)}" data-role="admin">
                  <i data-lucide="crown" class="w-3.5 h-3.5 text-amber-300"></i> Approve as Admin
                </button>
              ` : ''}
              <button class="reject-btn px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs transition"
                data-id="${escapeHtml(reg.id)}">
                Reject
              </button>
            ` : (isApproved ? `
              <span class="text-xs text-emerald-700 font-semibold bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200">
                Active • ${escapeHtml(reg.role)}
              </span>
            ` : `
              <span class="text-xs text-rose-600 bg-rose-50 px-3 py-1.5 rounded-xl border border-rose-200">Rejected</span>
            `)}
          </div>
        </div>
      `;
    }).join('');

    initIcons();

    appsContainer.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const uname = btn.dataset.username;
        const role = btn.dataset.role || 'student';
        try {
          await apiRequest('/admin/approve', { method: 'POST', body: { userId: id, role } });
          showToast(`User @${uname} approved as ${role}! Portal unlocked.`, 'success');
          onRefreshAll();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    appsContainer.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const reason = prompt('Enter reason for application rejection:');
        if (reason === null) return;
        try {
          await apiRequest('/admin/reject', {
            method: 'POST',
            body: { userId: id, reason: reason.trim() || 'Details did not match school records' }
          });
          showToast('Application marked as rejected', 'info');
          onRefreshAll();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    appsContainer.innerHTML = `<div class="p-6 text-center text-rose-600 bg-rose-50 rounded-2xl text-xs">${escapeHtml(err.message)}</div>`;
  }
}
