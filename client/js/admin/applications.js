/**
 * Admin Core: Student & Teacher Account Verification Queue
 * Shows concise compact summary by default; "More" button reveals full additional teacher details.
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDate, initIcons, showToast } from '/js/ui.js';

function parseList(val) {
  try {
    const arr = JSON.parse(val || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function summarizeList(list, fallback = '-') {
  if (!list || list.length === 0) return fallback;
  if (list.length === 1) return list[0];
  return `${list[0]} +${list.length - 1}`;
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
        <div class="m3-card p-8 text-center text-slate-400">
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
        ? 'bg-amber-100 text-amber-900'
        : (isApproved ? 'bg-emerald-100 text-emerald-900' : 'bg-rose-100 text-rose-900');

      const compactLine = isTeacher
        ? [
            reg.teacher_type === 'class' ? `Home: ${reg.class_name}${reg.division ? ' (' + reg.division + ')' : ''}` : `Classes: ${summarizeList(classes, reg.class_name || '-')}`,
            `Subjects: ${summarizeList(subjects)}`
          ].filter(Boolean).join(' • ')
        : `${reg.class_name || ''}${reg.division ? ' • Div ' + reg.division : ''}${reg.roll_number ? ' • Roll #' + reg.roll_number : ''}`;

      const hasExtraInfo = isTeacher || Boolean(reg.email) || Boolean(reg.teacher_designation) || Boolean(reg.teacher_info);

      return `
        <div class="m3-card p-4 sm:p-5 space-y-3 w-full break-words">
          <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div class="space-y-1.5 w-full sm:w-auto">
              <div class="flex items-center gap-2 flex-wrap">
                <h4 class="font-extrabold text-sm sm:text-base">${escapeHtml(reg.full_name)}</h4>
                <span class="font-mono text-xs text-[var(--md-primary)] font-bold bg-[var(--md-primary-container)]/60 px-2.5 py-0.5 rounded-full">@${escapeHtml(reg.username)}</span>
                ${isTeacher ? `<span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-sky-100 text-sky-900">${reg.teacher_type === 'class' ? 'Class Teacher' : 'Subject Teacher'}</span>` : ''}
                <span class="text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase ${badgeClass}">
                  ${escapeHtml(reg.account_status)}
                </span>
              </div>
              <p class="text-xs text-[var(--md-on-surface-variant)] tabular-nums">${escapeHtml(compactLine)}</p>
            </div>

            <div class="flex items-center gap-2 w-full sm:w-auto shrink-0 flex-wrap">
              ${hasExtraInfo ? `
                <button type="button" class="toggle-more-btn px-3 py-2 rounded-full bg-[var(--md-surface-container)] hover:brightness-95 text-xs font-bold inline-flex items-center gap-1 transition" data-id="${escapeHtml(reg.id)}">
                  <i data-lucide="chevron-down" class="w-3.5 h-3.5"></i> <span>More</span>
                </button>
              ` : ''}
              ${isPending ? `
                <button class="approve-btn m3-btn-primary px-4 py-2 text-xs flex items-center justify-center gap-1"
                  data-id="${escapeHtml(reg.id)}" data-username="${escapeHtml(reg.username)}" data-role="${isTeacher ? 'teacher' : 'student'}">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i> Approve ${isTeacher ? 'Teacher' : ''}
                </button>
                ${isViewerRootAdmin && !isTeacher ? `
                  <button class="approve-btn m3-btn-tonal px-3.5 py-2 text-xs flex items-center justify-center gap-1"
                    data-id="${escapeHtml(reg.id)}" data-username="${escapeHtml(reg.username)}" data-role="admin">
                    <i data-lucide="crown" class="w-3.5 h-3.5 text-amber-600"></i> Admin
                  </button>
                ` : ''}
                <button class="reject-btn px-3.5 py-2 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs transition"
                  data-id="${escapeHtml(reg.id)}">
                  Reject
                </button>
              ` : (isApproved ? `
                <span class="text-xs text-emerald-800 font-bold bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200">
                  Active • ${escapeHtml(reg.role)}
                </span>
              ` : `
                <span class="text-xs text-rose-700 bg-rose-50 px-3 py-1.5 rounded-full border border-rose-200">Rejected</span>
              `)}
            </div>
          </div>

          <!-- Expandable More Details Drawer -->
          <div id="app-more-${escapeHtml(reg.id)}" class="hidden pt-3 border-t border-[var(--md-outline)] bg-[var(--md-surface-container)]/60 rounded-2xl p-3.5 text-xs space-y-2">
            ${isTeacher ? `
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><span class="font-bold text-slate-600">Assigned Classes:</span> ${escapeHtml(classes.join(', ') || reg.class_name || '-')}</div>
                <div><span class="font-bold text-slate-600">Assigned Subjects:</span> ${escapeHtml(subjects.join(', ') || '-')}</div>
              </div>
              ${reg.teacher_designation ? `<div><span class="font-bold text-slate-600">Qualification / Designation:</span> ${escapeHtml(reg.teacher_designation)}</div>` : ''}
              <div>
                <span class="font-bold text-slate-600">Purpose &amp; Additional Info:</span>
                <p class="mt-0.5 text-[var(--md-on-surface-variant)] whitespace-pre-line">${escapeHtml(reg.teacher_info || 'No additional description provided.')}</p>
              </div>
            ` : ''}
            <div class="flex items-center flex-wrap gap-4 text-[11px] text-slate-500 pt-1">
              ${reg.email ? `<span class="flex items-center gap-1 text-[var(--md-primary)] font-semibold"><i data-lucide="mail" class="w-3 h-3"></i> ${escapeHtml(reg.email)}</span>` : ''}
              <span>Applied: ${escapeHtml(formatDate(reg.created_at))}</span>
              <span class="font-mono">ID: ${escapeHtml(reg.id)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    initIcons();

    appsContainer.querySelectorAll('.toggle-more-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = document.getElementById(`app-more-${btn.dataset.id}`);
        if (!panel) return;
        const hidden = panel.classList.toggle('hidden');
        btn.querySelector('span').textContent = hidden ? 'More' : 'Less';
      });
    });

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
    appsContainer.innerHTML = `<div class="m3-card p-6 text-center text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}
