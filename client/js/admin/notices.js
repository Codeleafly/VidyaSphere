/**
 * Admin Core: Published Notices & Manual Delete Manager (Material You)
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDate, initIcons, showToast, renderRoleBadgeHtml } from '/js/ui.js';

export async function loadAdminNotices() {
  const container = document.getElementById('admin-notices-container');
  const countBadge = document.getElementById('notice-count-badge');
  if (!container) return;

  try {
    const res = await apiRequest('/announcements');
    const list = res.announcements || [];
    if (countBadge) countBadge.textContent = `${list.length} active`;

    if (list.length === 0) {
      container.innerHTML = `
        <div class="m3-card p-8 text-center text-slate-400">
          <i data-lucide="bell-off" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p class="text-sm font-semibold text-slate-700">No active notices published</p>
          <p class="text-xs text-slate-400 mt-1">Published circulars stay active for 30 days unless deleted manually.</p>
        </div>
      `;
      initIcons();
      return;
    }

    const priorityColors = {
      urgent: 'bg-rose-100 text-rose-800',
      exam: 'bg-amber-100 text-amber-800',
      holiday: 'bg-purple-100 text-purple-800',
      general: 'bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]'
    };

    container.innerHTML = list.map(ann => {
      const badgeColor = priorityColors[ann.priority] || priorityColors.general;
      return `
        <div class="m3-card p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 w-full break-words">
          <div class="space-y-1.5 flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${badgeColor}">${escapeHtml(ann.priority)}</span>
              <span class="text-[10px] bg-[var(--md-surface-container)] font-bold px-2.5 py-0.5 rounded-full">
                ${ann.target_class === 'all' ? 'All Classes' : escapeHtml(ann.target_class)}
              </span>
              ${ann.is_pinned ? '<span class="text-[10px] text-amber-800 font-bold bg-amber-100 px-2.5 py-0.5 rounded-full">Pinned</span>' : ''}
              <span class="text-[10px] text-slate-400 tabular-nums">Auto-deletes ${escapeHtml(formatDate(ann.expires_at))}</span>
            </div>
            <h4 class="font-extrabold text-sm sm:text-base">${escapeHtml(ann.title)}</h4>
            <p class="text-xs text-[var(--md-on-surface-variant)] line-clamp-2">${escapeHtml(ann.content)}</p>
            <p class="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
              By <strong>${escapeHtml(ann.author_name || 'Admin')}</strong>
              ${renderRoleBadgeHtml(ann.author_role, ann.author_teacher_type, ann.author_is_root_admin === 1)}
              <span>• ${escapeHtml(formatDate(ann.created_at))}</span>
            </p>
          </div>
          <button class="delete-ann-btn shrink-0 px-3.5 py-2 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs flex items-center gap-1.5 transition"
            data-id="${escapeHtml(ann.id)}" data-title="${escapeHtml(ann.title)}">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete
          </button>
        </div>
      `;
    }).join('');

    initIcons();

    container.querySelectorAll('.delete-ann-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete notice "${btn.dataset.title || 'this notice'}"?`)) return;
        try {
          btn.disabled = true;
          await apiRequest(`/admin/announcements/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Announcement deleted', 'info');
          loadAdminNotices();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="m3-card p-6 text-center text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}
