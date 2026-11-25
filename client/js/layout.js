/**
 * Material You (M3) Navigation Rail, Top App Bar, Android Bottom Bar & Modal Sheet
 */

import { requireAuth, logout } from '/js/auth.js';
import { escapeHtml, initIcons, initM3Theme, renderThemePickerHtml, bindThemePicker } from '/js/ui.js';

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

export function initDashboardShell({ active = 'notices', mobileTitle = 'VidyaSphere', mobileRightHtml = '' } = {}) {
  initM3Theme();
  const user = requireAuth();
  if (!user) return null;

  const displayName = user.fullName || user.username || 'Student';
  const initial = displayName.charAt(0).toUpperCase();
  const roleLabel = user.role === 'teacher'
    ? (user.teacherType === 'class' ? 'Class Teacher' : 'Subject Teacher')
    : user.role;
  const roleSubtitle = `${roleLabel}${user.className ? ' • ' + user.className : ''}`;
  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';
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

      ${isTeacher ? `
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
            <span>Student Guide</span>
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
        <div class="flex items-center gap-2.5 overflow-hidden">
          <div class="w-8 h-8 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-bold text-xs flex items-center justify-center shrink-0">
            ${escapeHtml(initial)}
          </div>
          <div class="overflow-hidden">
            <p class="font-bold text-xs text-[var(--md-on-surface)] truncate">${escapeHtml(displayName)}</p>
            <p class="text-[10px] text-[var(--md-on-surface-variant)] capitalize truncate">${escapeHtml(roleSubtitle)}</p>
          </div>
        </div>
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
      <a href="${isTeacher ? '/teacher/index.html' : '/dashboard/index.html'}" class="w-8 h-8 rounded-xl bg-[var(--md-primary)] flex items-center justify-center text-[var(--md-on-primary)] shrink-0 shadow-xs">
        <i data-lucide="graduation-cap" class="w-4 h-4"></i>
      </a>
      <span class="font-extrabold text-[15px] text-[var(--md-on-surface)] tracking-tight truncate">${escapeHtml(mobileTitle)}</span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      ${mobileRightHtml}
      ${isTeacher ? `
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
    <div class="bg-[var(--md-surface-card)] w-full rounded-t-[28px] p-5 pb-7 space-y-4 shadow-2xl border-t border-[var(--md-outline)] modal-enter">
      <div class="m3-sheet-handle"></div>
      <div class="flex items-center justify-between pb-3 border-b border-[var(--md-outline)]">
        <div class="flex items-center gap-2.5">
          <div class="w-9 h-9 rounded-full bg-[var(--md-primary)] text-[var(--md-on-primary)] font-bold text-xs flex items-center justify-center">
            ${escapeHtml(initial)}
          </div>
          <div>
            <p class="font-bold text-sm text-[var(--md-on-surface)]">${escapeHtml(displayName)}</p>
            <p class="text-[11px] text-[var(--md-on-surface-variant)] capitalize">${escapeHtml(roleSubtitle)}</p>
          </div>
        </div>
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
          <span>Student Guide</span>
        </a>
        ${isTeacher ? `
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

  document.getElementById('shell-more-btn')?.addEventListener('click', openMore);
  document.getElementById('shell-more-close')?.addEventListener('click', closeMore);
  moreSheet.addEventListener('click', (e) => {
    if (e.target === moreSheet) closeMore();
  });

  initIcons();
  return user;
}
