/**
 * Material You (M3) Navigation Rail, Top App Bar, Android Bottom Bar, More Sheet & Account Profile Modal
 */

import { apiRequest } from '/js/api.js';
import { requireAuth, setCurrentUser, clearSession, logout } from '/js/auth.js';
import {
  escapeHtml, initIcons, initM3Theme, renderThemePickerHtml, bindThemePicker,
  showToast, bindModalBackdropAndEsc, isRootUser
} from '/js/ui.js';

const NAV_ITEMS = [
  { key: 'notices', href: '/dashboard/index.html', icon: 'layout-dashboard', label: 'Notice Board', short: 'Notices' },
  { key: 'lessons', href: '/dashboard/lessons.html', icon: 'play-circle', label: 'Lessons & Quizzes', short: 'Learn' },
  { key: 'homework', href: '/dashboard/homework.html', icon: 'clipboard-list', label: 'Homework', short: 'Tasks' },
  { key: 'exams', href: '/dashboard/exams.html', icon: 'calendar', label: 'Exams & Timetable', short: 'Exams' },
  { key: 'notes', href: '/dashboard/notes.html', icon: 'book-open', label: 'Study Notes', short: 'Notes' },
  { key: 'chat', href: '/dashboard/chat.html', icon: 'messages-square', label: 'Realtime Chat', short: 'Chat' },
  { key: 'qa', href: '/dashboard/qa.html', icon: 'message-circle-question', label: 'Academic Q&A', short: 'Q&A' },
  { key: 'polls', href: '/dashboard/polls.html', icon: 'vote', label: 'School Polls', short: 'Polls' },
  { key: 'students', href: '/dashboard/students.html', icon: 'users', label: 'Directory', short: 'Directory' },
];

const PRIMARY_MOBILE_KEYS = ['notices', 'lessons', 'chat', 'notes'];

function getRoleSubtitle(user) {
  if (isRootUser(user) || user.role === 'admin') {
    return 'Admin';
  }
  if (user.role === 'teacher') {
    return user.teacherType === 'class' ? 'Class Teacher' : 'Teacher';
  }
  return `Student${user.className ? ' • ' + user.className : ''}`;
}

export function openAccountModal(user) {
  let modal = document.getElementById('vs-account-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'vs-account-modal';
    modal.className = 'm3-modal-backdrop fixed inset-0 z-[65] bg-slate-900/50 backdrop-blur-xs hidden items-center justify-center p-4';
    document.body.appendChild(modal);
  }

  const isRoot = isRootUser(user);
  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';
  const displayName = user.fullName || user.username;
  const sub = getRoleSubtitle(user);

  const infoRows = [];
  if (isAdmin) {
    infoRows.push(`<div class="p-3 rounded-2xl bg-[var(--md-surface-container)] text-xs space-y-1">
      <p class="font-bold text-[var(--md-on-surface)] flex items-center gap-1.5"><i data-lucide="shield-check" class="w-4 h-4 text-[var(--md-primary)]"></i> Role: Admin</p>
      <p class="text-[11px] text-[var(--md-on-surface-variant)]">${isRoot ? 'Lead Admin access across Student Portal, Teacher Studio & Admin Core.' : 'Admin access across Student Portal, Teacher Studio & Admin Core.'}</p>
    </div>`);
  } else if (isTeacher) {
    infoRows.push(`<div class="p-3 rounded-2xl bg-[var(--md-surface-container)] text-xs space-y-1.5">
      <p class="font-bold">${escapeHtml(user.teacherType === 'class' ? 'Class Teacher' : 'Subject Teacher')}${user.teacherDesignation ? ' • ' + escapeHtml(user.teacherDesignation) : ''}</p>
      ${user.assignedClasses?.length ? `<p class="text-[11px] text-[var(--md-on-surface-variant)]"><strong>Classes:</strong> ${escapeHtml(user.assignedClasses.join(', '))}</p>` : ''}
      ${user.assignedSubjects?.length ? `<p class="text-[11px] text-[var(--md-on-surface-variant)]"><strong>Subjects:</strong> ${escapeHtml(user.assignedSubjects.join(', '))}</p>` : ''}
      ${user.teacherInfo ? `<p class="text-[11px] text-[var(--md-on-surface-variant)]">${escapeHtml(user.teacherInfo)}</p>` : ''}
    </div>`);
  } else {
    infoRows.push(`<div class="p-3 rounded-2xl bg-[var(--md-surface-container)] text-xs">
      <p class="font-bold">${escapeHtml(user.className || 'Student')}${user.division ? ' • Div ' + escapeHtml(user.division) : ''}${user.rollNumber ? ' • Roll #' + escapeHtml(user.rollNumber) : ''}</p>
    </div>`);
  }

  modal.innerHTML = `
    <div class="m3-modal-panel bg-white rounded-[28px] w-full max-w-md p-5 space-y-4 shadow-2xl max-h-[90vh] overflow-y-auto modal-enter">
      <div class="m3-sheet-handle sm:hidden"></div>
      <div class="flex items-center justify-between pb-2.5 border-b border-[var(--md-outline)]">
        <div class="flex items-center gap-3 overflow-hidden">
          <div class="w-10 h-10 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-extrabold flex items-center justify-center shrink-0">
            ${escapeHtml(displayName.charAt(0).toUpperCase())}
          </div>
          <div class="overflow-hidden">
            <h3 class="text-sm font-extrabold truncate">${escapeHtml(displayName)}</h3>
            <p class="text-[11px] font-mono text-[var(--md-primary)] truncate">@${escapeHtml(user.username)} • ${escapeHtml(sub)}</p>
          </div>
        </div>
        <button type="button" id="vs-acc-close" class="p-2 rounded-full hover:bg-slate-100 text-slate-500"><i data-lucide="x" class="w-4 h-4"></i></button>
      </div>

      ${infoRows.join('')}

      <div class="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-[var(--md-surface-container)]">
        <span class="text-xs font-bold">Material You Color</span>
        ${renderThemePickerHtml()}
      </div>

      <form id="vs-profile-form" class="space-y-2.5 text-xs border-t border-[var(--md-outline)] pt-3">
        <p class="font-extrabold text-[11px] uppercase tracking-wider text-slate-500">Profile Details</p>
        <div>
          <label class="block font-bold text-slate-600 mb-1">Email Address</label>
          <input type="email" id="vs-acc-email" value="${escapeHtml(user.email || '')}" class="m3-input w-full px-3.5 py-2 rounded-2xl border border-[var(--md-outline)]" placeholder="name@school.edu">
        </div>
        ${isTeacher ? `
          <div>
            <label class="block font-bold text-slate-600 mb-1">Designation / Qualification</label>
            <input type="text" id="vs-acc-desig" value="${escapeHtml(user.teacherDesignation || '')}" class="m3-input w-full px-3.5 py-2 rounded-2xl border border-[var(--md-outline)]" placeholder="e.g. M.Sc., B.Ed • Senior Faculty">
          </div>
          <div>
            <label class="block font-bold text-slate-600 mb-1">Bio / Purpose</label>
            <textarea id="vs-acc-info" rows="2" class="m3-input w-full px-3.5 py-2 rounded-2xl border border-[var(--md-outline)]" placeholder="Subjects focus or mentoring details...">${escapeHtml(user.teacherInfo || '')}</textarea>
          </div>
        ` : ''}
        <button type="submit" class="m3-btn-tonal w-full py-2 text-xs">Save Profile</button>
      </form>

      <form id="vs-pw-form" class="space-y-2.5 text-xs border-t border-[var(--md-outline)] pt-3">
        <p class="font-extrabold text-[11px] uppercase tracking-wider text-slate-500">Change Password</p>
        <input type="password" id="vs-cur-pw" required class="m3-input w-full px-3.5 py-2 rounded-2xl border border-[var(--md-outline)]" placeholder="Current password">
        <input type="password" id="vs-new-pw" required minlength="6" class="m3-input w-full px-3.5 py-2 rounded-2xl border border-[var(--md-outline)]" placeholder="New password (min 6 chars)">
        <button type="submit" class="m3-btn-primary w-full py-2.5 text-xs">Update Password</button>
      </form>
    </div>
  `;

  const closeAcc = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); };
  modal.querySelector('#vs-acc-close')?.addEventListener('click', closeAcc);
  bindModalBackdropAndEsc(modal, closeAcc);
  bindThemePicker(modal);

  modal.querySelector('#vs-profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const payload = { email: modal.querySelector('#vs-acc-email').value.trim() || null };
      if (isTeacher) {
        payload.teacherDesignation = modal.querySelector('#vs-acc-desig')?.value.trim() || '';
        payload.teacherInfo = modal.querySelector('#vs-acc-info')?.value.trim() || '';
      }
      const res = await apiRequest('/auth/profile', { method: 'PUT', body: payload });
      if (res.user) setCurrentUser(res.user);
      showToast('Profile saved!', 'success');
      closeAcc();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  modal.querySelector('#vs-pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = modal.querySelector('#vs-cur-pw').value;
    const newPassword = modal.querySelector('#vs-new-pw').value;
    try {
      await apiRequest('/auth/change-password', { method: 'PUT', body: { currentPassword, newPassword } });
      showToast('Password updated successfully!', 'success');
      e.target.reset();
      closeAcc();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  initIcons();
}

export function initDashboardShell({ active = 'notices', mobileTitle = 'VidyaSphere', mobileRightHtml = '' } = {}) {
  initM3Theme();
  const user = requireAuth();
  if (!user) return null;

  const displayName = user.fullName || user.username || 'User';
  const initial = displayName.charAt(0).toUpperCase();
  const roleSubtitle = getRoleSubtitle(user);
  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';
  const canUseTeacherStudio = isTeacher || isAdmin;
  const isMoreActive = !PRIMARY_MOBILE_KEYS.includes(active);

  const sidebar = document.createElement('aside');
  sidebar.className = 'hidden md:flex flex-col w-64 bg-[var(--md-surface-container)] border-r border-[var(--md-outline)] p-3.5 shrink-0 h-screen sticky top-0 justify-between z-30';
  sidebar.innerHTML = `
    <div class="space-y-4 overflow-y-auto no-scrollbar pr-0.5">
      <a href="/dashboard/index.html" class="flex items-center gap-3 px-2.5 py-1.5 group">
        <div class="w-10 h-10 rounded-2xl bg-[var(--md-primary)] text-[var(--md-on-primary)] flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
          <i data-lucide="graduation-cap" class="w-5 h-5"></i>
        </div>
        <div>
          <h2 class="font-extrabold text-[15px] text-[var(--md-on-surface)] tracking-tight leading-none">VidyaSphere</h2>
          <span class="text-[11px] text-[var(--md-on-surface-variant)] font-medium">School Workspace</span>
        </div>
      </a>

      ${canUseTeacherStudio ? `
        <a href="/teacher/index.html" class="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] font-bold text-xs shadow-xs hover:brightness-95 transition">
          <span class="flex items-center gap-2"><i data-lucide="sparkles" class="w-4 h-4"></i> Teacher Studio</span>
          <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
        </a>
      ` : ''}

      <nav class="space-y-0.5">
        ${NAV_ITEMS.map(item => {
          const isActive = item.key === active;
          return `
            <a href="${item.href}" class="m3-nav-pill ${isActive ? 'active' : ''} flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium">
              <i data-lucide="${item.icon}" class="w-4 h-4 shrink-0"></i>
              <span class="truncate">${item.label}</span>
            </a>
          `;
        }).join('')}

        <div class="pt-3 mt-3 border-t border-[var(--md-outline)] space-y-0.5">
          <a href="/guide.html" class="m3-nav-pill flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-medium">
            <i data-lucide="book-marked" class="w-4 h-4"></i>
            <span>Student &amp; Teacher Guide</span>
          </a>
          ${isAdmin ? `
            <a href="/admin/index.html" class="m3-nav-pill flex items-center gap-3 px-3.5 py-2.5 text-[13px] font-bold text-rose-700 hover:bg-rose-100/70">
              <i data-lucide="shield-check" class="w-4 h-4"></i>
              <span>Admin Core</span>
            </a>
          ` : ''}
        </div>
      </nav>
    </div>

    <div class="pt-3 space-y-2.5 border-t border-[var(--md-outline)]">
      <div class="flex items-center justify-between px-2">
        <span class="text-[10px] font-bold uppercase tracking-wider text-[var(--md-on-surface-variant)]">Theme</span>
        ${renderThemePickerHtml()}
      </div>

      <div class="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-[var(--md-surface-card)] border border-[var(--md-outline)]">
        <button type="button" id="shell-profile-btn" class="flex items-center gap-2.5 overflow-hidden text-left flex-1 hover:opacity-85 transition" title="Account & Password Settings">
          <div class="w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-bold text-xs flex items-center justify-center shrink-0">
            ${escapeHtml(initial)}
          </div>
          <div class="overflow-hidden">
            <p class="font-bold text-xs text-[var(--md-on-surface)] truncate">${escapeHtml(displayName)}</p>
            <p class="text-[10px] text-[var(--md-on-surface-variant)] truncate">${escapeHtml(roleSubtitle)}</p>
          </div>
        </button>
        <button id="shell-logout-btn" title="Sign Out" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition shrink-0">
          <i data-lucide="log-out" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `;

  const topHeader = document.createElement('header');
  topHeader.className = 'md:hidden sticky top-0 z-30 glass border-b border-[var(--md-outline)] px-4 h-14 flex items-center justify-between w-full shrink-0';
  topHeader.innerHTML = `
    <div class="flex items-center gap-2.5 overflow-hidden">
      <a href="${isAdmin ? '/admin/index.html' : (isTeacher ? '/teacher/index.html' : '/dashboard/index.html')}" class="w-8 h-8 rounded-xl bg-[var(--md-primary)] flex items-center justify-center text-[var(--md-on-primary)] shrink-0 shadow-xs">
        <i data-lucide="graduation-cap" class="w-4 h-4"></i>
      </a>
      <span class="font-extrabold text-[15px] text-[var(--md-on-surface)] tracking-tight truncate">${escapeHtml(mobileTitle)}</span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      ${mobileRightHtml}
      ${canUseTeacherStudio ? `
        <a href="/teacher/index.html" class="px-2.5 py-1 rounded-full bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] text-[10px] font-bold flex items-center gap-1">
          <i data-lucide="sparkles" class="w-3 h-3"></i> Studio
        </a>
      ` : ''}
      ${isAdmin ? `
        <a href="/admin/index.html" class="px-2.5 py-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1">
          <i data-lucide="shield-check" class="w-3 h-3"></i> Admin
        </a>
      ` : ''}
      <button id="shell-logout-mob" class="p-2 text-slate-500 hover:text-rose-600 rounded-full" title="Sign Out">
        <i data-lucide="log-out" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--md-surface-container)]/95 backdrop-blur-md border-t border-[var(--md-outline)] px-1 py-1.5 flex items-center justify-around max-w-full';
  bottomNav.innerHTML = `
    ${PRIMARY_MOBILE_KEYS.map(key => {
      const item = NAV_ITEMS.find(n => n.key === key);
      const isActive = item.key === active;
      return `
        <a href="${item.href}" class="flex-1 py-0.5 px-0.5 flex flex-col items-center justify-center gap-0.5 text-[10px] truncate m3-press">
          <span class="px-3.5 py-1 rounded-full transition-colors ${isActive ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' : 'text-[var(--md-on-surface-variant)]'}">
            <i data-lucide="${item.icon}" class="w-4 h-4"></i>
          </span>
          <span class="truncate ${isActive ? 'font-bold text-[var(--md-on-surface)]' : 'font-medium text-[var(--md-on-surface-variant)]'}">${item.short}</span>
        </a>
      `;
    }).join('')}
    <button type="button" id="shell-more-btn" class="flex-1 py-0.5 px-0.5 flex flex-col items-center justify-center gap-0.5 text-[10px] truncate m3-press">
      <span class="px-3.5 py-1 rounded-full transition-colors ${isMoreActive ? 'bg-[var(--md-secondary-container)] text-[var(--md-on-secondary-container)]' : 'text-[var(--md-on-surface-variant)]'}">
        <i data-lucide="grid-2x2" class="w-4 h-4"></i>
      </span>
      <span class="${isMoreActive ? 'font-bold text-[var(--md-on-surface)]' : 'font-medium text-[var(--md-on-surface-variant)]'}">More</span>
    </button>
  `;

  const moreSheet = document.createElement('div');
  moreSheet.id = 'shell-more-sheet';
  moreSheet.className = 'md:hidden fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs hidden items-end justify-center';
  moreSheet.innerHTML = `
    <div class="bg-[var(--md-surface-card)] w-full rounded-t-[28px] p-5 pb-7 space-y-4 shadow-2xl border-t border-[var(--md-outline)] modal-enter max-h-[85vh] overflow-y-auto">
      <div class="m3-sheet-handle"></div>
      <div class="flex items-center justify-between pb-3 border-b border-[var(--md-outline)]">
        <button type="button" id="shell-profile-mob" class="flex items-center gap-2.5 text-left">
          <div class="w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-bold text-xs flex items-center justify-center">
            ${escapeHtml(initial)}
          </div>
          <div>
            <p class="font-bold text-sm text-[var(--md-on-surface)]">${escapeHtml(displayName)}</p>
            <p class="text-[11px] text-[var(--md-on-surface-variant)]">${escapeHtml(roleSubtitle)} • Tap for Account</p>
          </div>
        </button>
        <button type="button" id="shell-more-close" class="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>

      <div class="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-[var(--md-surface-container)]">
        <span class="text-xs font-bold text-[var(--md-on-surface)]">Material You Accent</span>
        ${renderThemePickerHtml()}
      </div>

      <div class="grid grid-cols-2 gap-2 text-xs">
        ${NAV_ITEMS.filter(n => !PRIMARY_MOBILE_KEYS.includes(n.key)).map(item => {
          const isActive = item.key === active;
          return `
            <a href="${item.href}" class="flex items-center gap-2.5 p-3.5 rounded-2xl border transition ${
              isActive
                ? 'bg-[var(--md-secondary-container)] border-transparent text-[var(--md-on-secondary-container)] font-bold'
                : 'bg-[var(--md-surface-container)] border-transparent text-[var(--md-on-surface)] font-semibold'
            }">
              <i data-lucide="${item.icon}" class="w-4 h-4"></i>
              <span>${item.label}</span>
            </a>
          `;
        }).join('')}
        <a href="/guide.html" class="flex items-center gap-2.5 p-3.5 rounded-2xl bg-[var(--md-surface-container)] text-[var(--md-on-surface)] font-semibold">
          <i data-lucide="book-marked" class="w-4 h-4"></i>
          <span>Platform Guide</span>
        </a>
        ${canUseTeacherStudio ? `
          <a href="/teacher/index.html" class="flex items-center gap-2.5 p-3.5 rounded-2xl bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)] font-bold">
            <i data-lucide="sparkles" class="w-4 h-4"></i>
            <span>Teacher Studio</span>
          </a>
        ` : ''}
        ${isAdmin ? `
          <a href="/admin/index.html" class="flex items-center gap-2.5 p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 font-bold">
            <i data-lucide="shield-check" class="w-4 h-4"></i>
            <span>Admin Core</span>
          </a>
        ` : ''}
      </div>
    </div>
  `;

  document.body.prepend(topHeader);
  document.body.prepend(sidebar);
  document.body.append(bottomNav, moreSheet);

  bindThemePicker(sidebar);
  bindThemePicker(moreSheet);

  document.getElementById('shell-logout-btn')?.addEventListener('click', logout);
  document.getElementById('shell-logout-mob')?.addEventListener('click', logout);

  const openMore = () => {
    moreSheet.classList.remove('hidden');
    moreSheet.classList.add('flex');
  };
  const closeMore = () => {
    moreSheet.classList.add('hidden');
    moreSheet.classList.remove('flex');
  };

  document.getElementById('shell-profile-btn')?.addEventListener('click', () => openAccountModal(user));
  document.getElementById('shell-profile-mob')?.addEventListener('click', () => { closeMore(); openAccountModal(user); });

  document.getElementById('shell-more-btn')?.addEventListener('click', openMore);
  document.getElementById('shell-more-close')?.addEventListener('click', closeMore);
  moreSheet.addEventListener('click', (e) => {
    if (e.target === moreSheet) closeMore();
  });

  // Silent background session sync to reflect role promotions / assignments / account status
  apiRequest('/auth/me').then(res => {
    if (res?.user) {
      setCurrentUser(res.user);
      if (res.user.accountStatus === 'pending') {
        window.location.replace('/auth/pending.html');
      }
    }
  }).catch(err => {
    if (err.message?.includes('suspended') || err.message?.includes('403')) {
      clearSession();
      window.location.replace('/auth/login.html');
    }
  });

  initIcons();
  return user;
}
