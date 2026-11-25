/**
 * Admin Core Portal Entrypoint (Material You M3)
 */

import { apiRequest } from '/js/api.js';
import { logout, setCurrentUser } from '/js/auth.js';
import { openAccountModal } from '/js/layout.js';
import {
  CLASS_LIST, escapeHtml, formatDateTime, initIcons, initM3Theme,
  renderThemePickerHtml, bindThemePicker, showToast, renderRoleBadgeHtml
} from '/js/ui.js';
import { loadApplications } from '/js/admin/applications.js';
import { loadStudentAccounts, initQuickPromoter } from '/js/admin/students.js';
import { loadExamsAdmin, initExamsManager } from '/js/admin/exams.js';
import { loadAdminNotices } from '/js/admin/notices.js';

initM3Theme();

let currentAdminUser = null;

function populateClassDropdowns() {
  const examClass = document.getElementById('exam-class');
  const annClass = document.getElementById('ann-target-class');
  if (examClass) {
    examClass.innerHTML = `<option value="All Classes">All Classes</option>` +
      CLASS_LIST.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
  if (annClass) {
    annClass.innerHTML = `<option value="all">School-Wide (All Classes)</option>` +
      CLASS_LIST.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
}

async function verifyAdminSession() {
  try {
    const res = await apiRequest('/auth/me');
    if (!res.user || res.user.role !== 'admin') {
      alert('Access Denied: You must be an authorized School Administrator.');
      window.location.replace('/auth/login.html');
      return false;
    }
    currentAdminUser = res.user;
    setCurrentUser(res.user);
    const displayName = res.user.fullName || res.user.username;
    document.getElementById('admin-display-name').textContent = displayName;
    const avatar = document.getElementById('admin-avatar-initial');
    if (avatar) avatar.textContent = displayName.charAt(0).toUpperCase();

    const isRoot = res.user.isRootAdmin || res.user.username === 'admin';
    const roleText = isRoot ? 'Admin (Lead)' : 'Admin';
    const roleLabelEl = document.getElementById('admin-display-role');
    if (roleLabelEl) roleLabelEl.textContent = roleText;
    const mobBadge = document.getElementById('admin-mob-badge');
    if (mobBadge) mobBadge.textContent = roleText;

    return true;
  } catch {
    alert('Session expired or unauthorized. Please log in.');
    window.location.replace('/auth/login.html');
    return false;
  }
}

async function loadStats() {
  try {
    const res = await apiRequest('/admin/stats');
    const s = res.stats || {};
    document.getElementById('stat-pending').textContent = s.pendingRegistrations ?? 0;
    document.getElementById('stat-students').textContent = s.totalStudents ?? 0;
    const teachersEl = document.getElementById('stat-teachers');
    if (teachersEl) teachersEl.textContent = s.totalTeachers ?? 0;
    document.getElementById('stat-notes').textContent = s.totalNotes ?? 0;
    document.getElementById('stat-polls').textContent = s.totalPolls ?? 0;
    document.getElementById('stat-exams').textContent = s.totalExams ?? 0;

    const pill = document.getElementById('admin-pending-pill');
    if (pill) {
      const cnt = s.pendingRegistrations || 0;
      pill.textContent = cnt;
      pill.classList.toggle('hidden', cnt === 0);
    }
  } catch (e) {
    console.error('Stats error', e);
  }
}

async function loadSettings() {
  try {
    const res = await apiRequest('/admin/settings');
    if (res.settings?.academic_year) {
      document.getElementById('set-academic-year').value = res.settings.academic_year;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function loadAuditLogs() {
  const container = document.getElementById('admin-audit-container');
  if (!container) return;
  try {
    const res = await apiRequest('/admin/audit-logs');
    const logs = res.logs || [];
    if (logs.length === 0) {
      container.innerHTML = `<div class="m3-card p-8 text-center text-slate-400 text-xs">No audit logs recorded yet.</div>`;
      return;
    }
    container.innerHTML = logs.map(l => `
      <div class="m3-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${escapeHtml(l.action)}</span>
            <span class="font-bold">${escapeHtml(l.actor_name || 'System')}</span>
            ${l.actor_role ? renderRoleBadgeHtml(l.actor_role, null, l.actor_is_root_admin === 1) : ''}
          </div>
          <p class="text-[var(--md-on-surface-variant)] break-words">${escapeHtml(l.details || '')}</p>
        </div>
        <span class="text-[11px] text-slate-400 tabular-nums shrink-0">${escapeHtml(formatDateTime(l.created_at))}</span>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="m3-card p-6 text-rose-600 text-xs">${escapeHtml(err.message)}</div>`;
  }
}

function refreshAllData() {
  loadStats();
  loadApplications(currentAdminUser, refreshAllData);
  loadStudentAccounts(currentAdminUser, refreshAllData);
}

function switchTab(tabId) {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  document.querySelectorAll('.admin-bottom-tab').forEach(btn => {
    const pill = btn.querySelector('.a-pill');
    const label = btn.querySelector('span:last-child');
    const active = btn.dataset.tab === tabId;
    if (pill) {
      pill.className = active
        ? 'a-pill px-3 py-1 rounded-full bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]'
        : 'a-pill px-3 py-1 rounded-full text-[var(--md-on-surface-variant)]';
    }
    if (label) label.className = active ? 'font-bold' : 'font-medium';
  });

  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`)?.classList.remove('hidden');

  if (tabId === 'applications') loadApplications(currentAdminUser, refreshAllData);
  if (tabId === 'students') loadStudentAccounts(currentAdminUser, refreshAllData);
  if (tabId === 'exams') loadExamsAdmin();
  if (tabId === 'announcements') loadAdminNotices();
  if (tabId === 'audit') loadAuditLogs();
  if (tabId === 'settings') loadSettings();
}

// Theme pickers
const deskTheme = document.getElementById('admin-theme-desktop');
const mobTheme = document.getElementById('admin-theme-mob');
if (deskTheme) { deskTheme.innerHTML = `<span class="text-[10px] font-bold uppercase text-[var(--md-on-surface-variant)]">Theme</span>` + renderThemePickerHtml(); bindThemePicker(deskTheme); }
if (mobTheme) { mobTheme.innerHTML = renderThemePickerHtml(); bindThemePicker(mobTheme); }

populateClassDropdowns();

document.getElementById('logout-btn')?.addEventListener('click', logout);
document.getElementById('logout-btn-mob')?.addEventListener('click', logout);
document.getElementById('reg-status-filter')?.addEventListener('change', () => loadApplications(currentAdminUser, refreshAllData));
document.getElementById('reg-role-filter')?.addEventListener('change', () => loadApplications(currentAdminUser, refreshAllData));
document.getElementById('roster-role-filter')?.addEventListener('change', () => loadStudentAccounts(currentAdminUser, refreshAllData));
document.getElementById('roster-search-input')?.addEventListener('input', () => {
  clearTimeout(window._adminRosterTimer);
  window._adminRosterTimer = setTimeout(() => loadStudentAccounts(currentAdminUser, refreshAllData), 250);
});
document.getElementById('refresh-audit-btn')?.addEventListener('click', loadAuditLogs);

document.querySelectorAll('.admin-tab-btn, .admin-bottom-tab, .admin-sheet-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('admin-more-sheet')?.classList.add('hidden');
    document.getElementById('admin-more-sheet')?.classList.remove('flex');
    switchTab(btn.dataset.tab);
  });
});

const moreSheet = document.getElementById('admin-more-sheet');
document.getElementById('admin-more-btn')?.addEventListener('click', () => { moreSheet.classList.remove('hidden'); moreSheet.classList.add('flex'); });
document.getElementById('admin-more-close')?.addEventListener('click', () => { moreSheet.classList.add('hidden'); moreSheet.classList.remove('flex'); });
moreSheet?.addEventListener('click', (e) => { if (e.target === moreSheet) { moreSheet.classList.add('hidden'); moreSheet.classList.remove('flex'); } });

document.getElementById('admin-profile-btn')?.addEventListener('click', () => currentAdminUser && openAccountModal(currentAdminUser));
document.getElementById('admin-profile-mob')?.addEventListener('click', () => {
  moreSheet?.classList.add('hidden');
  moreSheet?.classList.remove('flex');
  if (currentAdminUser) openAccountModal(currentAdminUser);
});

document.getElementById('create-ann-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await apiRequest('/admin/announcements', {
      method: 'POST',
      body: {
        title: document.getElementById('ann-title').value.trim(),
        content: document.getElementById('ann-content').value.trim(),
        priority: document.getElementById('ann-priority').value,
        targetClass: document.getElementById('ann-target-class').value,
        isPinned: document.getElementById('ann-pinned').checked,
      },
    });
    showToast('Official notice published (auto-deletes after 30 days)!', 'success');
    e.target.reset();
    loadAdminNotices();
    loadStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('academic-year-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = document.getElementById('set-academic-year').value.trim();
  try {
    await apiRequest('/admin/settings', { method: 'POST', body: { key: 'academic_year', value: val } });
    showToast(`Active Academic Year updated to ${val}!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

initQuickPromoter(refreshAllData);
initExamsManager(loadStats);
initIcons();

const isAuthorized = await verifyAdminSession();
if (isAuthorized) {
  loadStats();
  loadApplications(currentAdminUser, refreshAllData);
  loadSettings();
}
