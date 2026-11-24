/**
 * Shared Dashboard Shell (Desktop Sidebar, Mobile Topbar, Bottom Dock & More Sheet)
 * Eliminates duplicated nav markup across all student dashboard pages.
 */

import { requireAuth, logout } from '/js/auth.js';
import { escapeHtml, initIcons } from '/js/ui.js';

const NAV_ITEMS = [
  { key: 'notices', href: '/dashboard/index.html', icon: 'layout-dashboard', label: 'Notice Board', short: 'Notices' },
  { key: 'exams', href: '/dashboard/exams.html', icon: 'calendar', label: 'Exams & Timetable', short: 'Exams' },
  { key: 'chat', href: '/dashboard/chat.html', icon: 'messages-square', label: 'Realtime Chat', short: 'Chat' },
  { key: 'notes', href: '/dashboard/notes.html', icon: 'book-open', label: 'Study Notes', short: 'Notes' },
  { key: 'qa', href: '/dashboard/qa.html', icon: 'message-circle-question', label: 'Academic Q&A', short: 'Q&A' },
  { key: 'polls', href: '/dashboard/polls.html', icon: 'vote', label: 'School Polls', short: 'Polls' },
  { key: 'students', href: '/dashboard/students.html', icon: 'users', label: 'Student Directory', short: 'Directory' },
];

const PRIMARY_MOBILE_KEYS = ['notices', 'exams', 'chat', 'notes'];

export function initDashboardShell({ active = 'notices', mobileTitle = 'VidyaSphere', mobileRightHtml = '' } = {}) {
  const user = requireAuth();
  if (!user) return null;

  const displayName = user.fullName || user.username || 'Student';
  const initial = displayName.charAt(0).toUpperCase();
  const roleSubtitle = `${user.role}${user.className ? ' • ' + user.className : ''}`;
  const isAdmin = user.role === 'admin';
  const isMoreActive = !PRIMARY_MOBILE_KEYS.includes(active);

  const sidebar = document.createElement('aside');
  sidebar.className = 'hidden md:flex flex-col w-60 bg-white border-r border-slate-200/80 p-3.5 shrink-0 h-screen sticky top-0 justify-between z-30';
  sidebar.innerHTML = `
    <div class="space-y-5">
      <a href="/dashboard/index.html" class="flex items-center gap-2.5 px-2 py-1 group">
        <div class="w-9 h-9 rounded-xl bg-slate-900 group-hover:bg-indigo-600 transition flex items-center justify-center text-white shadow-sm">
          <i data-lucide="graduation-cap" class="w-5 h-5"></i>
        </div>
        <div>
          <h2 class="font-bold text-sm text-slate-900 tracking-tight leading-none">VidyaSphere</h2>
          <span class="text-[11px] text-slate-400 font-medium">School Edge Portal</span>
        </div>
      </a>

      <nav class="space-y-0.5">
        ${NAV_ITEMS.map(item => {
          const isActive = item.key === active;
          return `
            <a href="${item.href}" class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition ${
              isActive
                ? 'bg-indigo-50/90 text-indigo-700 font-bold'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
            }">
              <i data-lucide="${item.icon}" class="w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}"></i>
              <span>${item.label}</span>
            </a>
          `;
        }).join('')}

        <div class="pt-3 mt-3 border-t border-slate-100 space-y-0.5">
          <a href="/guide.html" class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-500 hover:bg-slate-100/80 hover:text-slate-900 font-medium text-[13px] transition">
            <i data-lucide="book-marked" class="w-4 h-4 text-slate-400"></i>
            <span>Student Guide</span>
          </a>
          ${isAdmin ? `
            <a href="/admin/index.html" class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-600 hover:bg-rose-50 font-semibold text-[13px] transition">
              <i data-lucide="shield-check" class="w-4 h-4"></i>
              <span>Admin Core</span>
            </a>
          ` : ''}
        </div>
      </nav>
    </div>

    <div class="border-t border-slate-100 pt-3 px-1">
      <div class="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-50/80 border border-slate-200/60">
        <div class="flex items-center gap-2.5 overflow-hidden">
          <div class="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
            ${escapeHtml(initial)}
          </div>
          <div class="overflow-hidden">
            <p class="font-semibold text-xs text-slate-900 truncate">${escapeHtml(displayName)}</p>
            <p class="text-[10px] text-slate-500 capitalize truncate">${escapeHtml(roleSubtitle)}</p>
          </div>
        </div>
        <button id="shell-logout-btn" title="Sign Out" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition shrink-0">
          <i data-lucide="log-out" class="w-4 h-4"></i>
        </button>
      </div>
    </div>
  `;

  const topHeader = document.createElement('header');
  topHeader.className = 'md:hidden sticky top-0 z-30 glass border-b border-slate-200/80 px-3.5 h-13 py-2.5 flex items-center justify-between w-full shrink-0';
  topHeader.innerHTML = `
    <div class="flex items-center gap-2 overflow-hidden">
      <a href="/dashboard/index.html" class="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white shrink-0">
        <i data-lucide="graduation-cap" class="w-4 h-4"></i>
      </a>
      <span class="font-bold text-sm text-slate-900 tracking-tight truncate">${escapeHtml(mobileTitle)}</span>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      ${mobileRightHtml}
      ${isAdmin ? `
        <a href="/admin/index.html" class="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1">
          <i data-lucide="shield-check" class="w-3 h-3"></i> Admin
        </a>
      ` : ''}
      <button id="shell-logout-mob" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg" title="Sign Out">
        <i data-lucide="log-out" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  const bottomNav = document.createElement('nav');
  bottomNav.className = 'md:hidden fixed bottom-0 left-0 right-0 z-40 glass border-t border-slate-200/80 px-1 py-1 flex items-center justify-around max-w-full';
  bottomNav.innerHTML = `
    ${PRIMARY_MOBILE_KEYS.map(key => {
      const item = NAV_ITEMS.find(n => n.key === key);
      const isActive = item.key === active;
      return `
        <a href="${item.href}" class="flex-1 py-1.5 px-0.5 flex flex-col items-center justify-center ${
          isActive ? 'text-indigo-600 font-bold' : 'text-slate-500 font-medium'
        } text-[10px] truncate">
          <i data-lucide="${item.icon}" class="w-4 h-4 mb-0.5"></i>
          <span class="truncate">${item.short}</span>
        </a>
      `;
    }).join('')}
    <button type="button" id="shell-more-btn" class="flex-1 py-1.5 px-0.5 flex flex-col items-center justify-center ${
      isMoreActive ? 'text-indigo-600 font-bold' : 'text-slate-500 font-medium'
    } text-[10px] truncate">
      <i data-lucide="grid-2x2" class="w-4 h-4 mb-0.5"></i>
      <span>More</span>
    </button>
  `;

  const moreSheet = document.createElement('div');
  moreSheet.id = 'shell-more-sheet';
  moreSheet.className = 'md:hidden fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs hidden items-end justify-center';
  moreSheet.innerHTML = `
    <div class="bg-white w-full rounded-t-2xl p-4 pb-6 space-y-3 shadow-2xl border-t border-slate-200 modal-enter">
      <div class="flex items-center justify-between pb-2.5 border-b border-slate-100">
        <div class="flex items-center gap-2.5">
          <div class="w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">
            ${escapeHtml(initial)}
          </div>
          <div>
            <p class="font-bold text-xs text-slate-900">${escapeHtml(displayName)}</p>
            <p class="text-[10px] text-slate-500 capitalize">${escapeHtml(roleSubtitle)}</p>
          </div>
        </div>
        <button type="button" id="shell-more-close" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
          <i data-lucide="x" class="w-4 h-4"></i>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-2 text-xs">
        ${NAV_ITEMS.filter(n => !PRIMARY_MOBILE_KEYS.includes(n.key)).map(item => {
          const isActive = item.key === active;
          return `
            <a href="${item.href}" class="flex items-center gap-2 p-3 rounded-xl border ${
              isActive ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-slate-50 border-slate-200/70 text-slate-700 font-semibold'
            }">
              <i data-lucide="${item.icon}" class="w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-slate-500'}"></i>
              <span>${item.label}</span>
            </a>
          `;
        }).join('')}
        <a href="/guide.html" class="flex items-center gap-2 p-3 rounded-xl border bg-slate-50 border-slate-200/70 text-slate-700 font-semibold">
          <i data-lucide="book-marked" class="w-4 h-4 text-slate-500"></i>
          <span>Student Guide</span>
        </a>
        ${isAdmin ? `
          <a href="/admin/index.html" class="flex items-center gap-2 p-3 rounded-xl border bg-rose-50 border-rose-200 text-rose-700 font-bold">
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
