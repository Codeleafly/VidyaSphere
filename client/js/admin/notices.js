/**
 * Admin Core: Published Notices & Manual Delete Manager
 * Both Lead Root Admin and Secondary Admins can publish and delete notices.
 * All notices auto-expire after 30 days (1 month).
 */

import { apiRequest } from '/js/api.js';
import { escapeHtml, formatDate, initIcons, showToast } from '/js/ui.js';

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
        <div class="p-8 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/80">
          <i data-lucide="bell-off" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
          <p class="text-sm font-semibold text-slate-700">No active notices published</p>
          <p class="text-xs text-slate-400 mt-1">Published circulars stay active for 30 days unless deleted manually.</p>
        </div>
      `;
      initIcons();
      return;
    }

    const priorityColors = {
      urgent: 'bg-rose-50 text-rose-700 border-rose-200',
      exam: 'bg-amber-50 text-amber-700 border-amber-200',
      holiday: 'bg-purple-50 text-purple-700 border-purple-200',
      general: 'bg-indigo-50 text-indigo-700 border-indigo-200'
    };

    container.innerHTML = list.map(ann => {
      const badgeColor = priorityColors[ann.priority] || priorityColors.general;
      return `
        <div class="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 w-full break-words">
          <div class="space-y-1.5 flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${badgeColor}">${escapeHtml(ann.priority)}</span>
              <span class="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-md">
                ${ann.target_class === 'all' ? 'All Classes' : escapeHtml(ann.target_class)}
              </span>
              ${ann.is_pinned ? '<span class="text-[10px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Pinned</span>' : ''}
              <span class="text-[10px] text-slate-400 tabular-nums">Auto-deletes ${escapeHtml(formatDate(ann.expires_at))}</span>
            </div>
            <h4 class="font-bold text-slate-900 text-sm sm:text-base">${escapeHtml(ann.title)}</h4>
            <p class="text-xs text-slate-500 line-clamp-2">${escapeHtml(ann.content)}</p>
            <p class="text-[11px] text-slate-400">By <strong class="text-slate-600">${escapeHtml(ann.author_name || 'Admin')}</strong> • ${escapeHtml(formatDate(ann.created_at))}</p>
          </div>
          <button class="delete-ann-btn shrink-0 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-xs flex items-center gap-1.5 transition"
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
    container.innerHTML = `<div class="p-6 text-center text-rose-600 bg-rose-50 rounded-2xl text-xs">${escapeHtml(err.message)}</div>`;
  }
}
