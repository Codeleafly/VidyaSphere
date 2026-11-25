/**
 * Admin Core Portal Entrypoint
 */

import { apiRequest } from '/js/api.js';
import { logout } from '/js/auth.js';
import { initIcons, showToast } from '/js/ui.js';
import { loadApplications } from '/js/admin/applications.js';
import { loadStudentAccounts, initQuickPromoter } from '/js/admin/students.js';
import { loadExamsAdmin, initExamsManager } from '/js/admin/exams.js';
import { loadAdminNotices } from '/js/admin/notices.js';

let currentAdminUser = null;

async function verifyAdminSession() {
  try {
    const res = await apiRequest('/auth/me');
    if (!res.user || res.user.role !== 'admin') {
      alert('Access Denied: You must be an authorized School Administrator.');
      window.location.replace('/auth/login.html');
      return false;
    }
    currentAdminUser = res.user;
    document.getElementById('admin-display-name').textContent = res.user.fullName || res.user.username;
    const isRoot = res.user.isRootAdmin || res.user.username === 'admin';
    const roleLabelEl = document.getElementById('admin-display-role');
    if (roleLabelEl) {
      roleLabelEl.textContent = isRoot ? 'Lead Root Admin' : 'Secondary Admin';
    }
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

function refreshAllData() {
  loadStats();
  loadApplications(currentAdminUser, refreshAllData);
  loadStudentAccounts(currentAdminUser, refreshAllData);
}

function switchTab(tabId) {
  document.querySelectorAll('aside .admin-tab-btn').forEach(btn => {
    btn.className = btn.dataset.tab === tabId
      ? 'admin-tab-btn flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-800 text-white font-bold text-[13px] w-full text-left transition'
      : 'admin-tab-btn flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-400 hover:bg-slate-900 hover:text-white font-medium text-[13px] transition w-full text-left';
  });

  document.querySelectorAll('.md\\:hidden .admin-tab-btn').forEach(btn => {
    btn.className = btn.dataset.tab === tabId
      ? 'admin-tab-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white font-bold text-xs shrink-0'
      : 'admin-tab-btn flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 font-semibold text-xs shrink-0';
  });

  document.querySelectorAll('.admin-bottom-tab').forEach(btn => {
    btn.className = btn.dataset.tab === tabId
      ? 'admin-bottom-tab flex-1 py-1.5 px-0.5 flex flex-col items-center justify-center text-indigo-400 font-bold text-[10px] truncate'
      : 'admin-bottom-tab flex-1 py-1.5 px-0.5 flex flex-col items-center justify-center text-slate-400 font-medium text-[10px] truncate';
  });

  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));
  document.getElementById(`tab-${tabId}`)?.classList.remove('hidden');

  if (tabId === 'applications') loadApplications(currentAdminUser, refreshAllData);
  if (tabId === 'students') loadStudentAccounts(currentAdminUser, refreshAllData);
  if (tabId === 'exams') loadExamsAdmin();
  if (tabId === 'announcements') loadAdminNotices();
  if (tabId === 'settings') loadSettings();
}

document.getElementById('logout-btn')?.addEventListener('click', logout);
document.getElementById('logout-btn-mob')?.addEventListener('click', logout);
document.getElementById('reg-status-filter')?.addEventListener('change', () => loadApplications(currentAdminUser, refreshAllData));
document.getElementById('reg-role-filter')?.addEventListener('change', () => loadApplications(currentAdminUser, refreshAllData));
document.getElementById('roster-role-filter')?.addEventListener('change', () => loadStudentAccounts(currentAdminUser, refreshAllData));

document.querySelectorAll('.admin-tab-btn, .admin-bottom-tab').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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
