/**
 * Shared UI Utilities: Material You Theme Engine, XSS Escaping, URL Sanitization, Toasts & Formatters
 */

export const M3_THEMES = {
  blue: { label: 'Pixel Blue', swatch: '#0b57d0' },
  violet: { label: 'Material Violet', swatch: '#6750a4' },
  emerald: { label: 'Sage Emerald', swatch: '#146c2e' },
  rose: { label: 'Pixel Berry', swatch: '#b3261e' },
};

export const CLASS_LIST = [
  'Class 1', 'Class 2', 'Class 3', 'Class 4',
  'Class 5', 'Class 6', 'Class 7', 'Class 8',
  'Class 9', 'Class 10',
  'Class 11 (Science)', 'Class 11 (Commerce)', 'Class 11 (Arts)',
  'Class 12 (Science)', 'Class 12 (Commerce)', 'Class 12 (Arts)'
];

export const SUBJECT_LIST = [
  'English', 'Marathi', 'Hindi', 'Sanskrit',
  'Mathematics', 'Algebra (Maths I)', 'Geometry (Maths II)', 'Mathematics & Statistics',
  'General Science', 'Science & Technology (Part 1)', 'Science & Technology (Part 2)',
  'Physics', 'Chemistry', 'Biology', 'Environmental Studies (EVS)',
  'Social Science', 'History & Political Science', 'Geography & Economics',
  'Book-Keeping & Accountancy (BK)', 'Organization of Commerce (OCM)', 'Secretarial Practice (SP)',
  'Economics', 'Computer Science', 'Information Technology (IT)'
];

export function applyM3Theme(themeKey = 'blue') {
  const valid = M3_THEMES[themeKey] ? themeKey : 'blue';
  document.documentElement.setAttribute('data-m3-theme', valid);
  try { localStorage.setItem('vidyasphere_m3_theme', valid); } catch { /* ignore */ }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', M3_THEMES[valid].swatch);
  document.querySelectorAll('[data-m3-dot]').forEach(btn => {
    const isActive = btn.dataset.m3Dot === valid;
    btn.classList.toggle('ring-2', isActive);
    btn.classList.toggle('ring-offset-2', isActive);
    btn.classList.toggle('ring-slate-800', isActive);
    btn.classList.toggle('scale-110', isActive);
  });
  return valid;
}

export function initM3Theme() {
  let saved = 'blue';
  try { saved = localStorage.getItem('vidyasphere_m3_theme') || 'blue'; } catch { /* ignore */ }
  return applyM3Theme(saved);
}

export function renderThemePickerHtml() {
  let current = 'blue';
  try { current = localStorage.getItem('vidyasphere_m3_theme') || 'blue'; } catch { /* ignore */ }
  return `
    <div class="flex items-center gap-1.5" title="Material You Dynamic Color">
      ${Object.entries(M3_THEMES).map(([key, cfg]) => `
        <button type="button" data-m3-dot="${key}" aria-label="${cfg.label}" title="${cfg.label}"
          class="w-4 h-4 rounded-full transition-transform cursor-pointer border border-white shadow-xs ${current === key ? 'ring-2 ring-offset-2 ring-slate-800 scale-110' : 'opacity-80 hover:opacity-100'}"
          style="background-color: ${cfg.swatch};"></button>
      `).join('')}
    </div>
  `;
}

export function bindThemePicker(rootEl = document) {
  rootEl.querySelectorAll('[data-m3-dot]').forEach(btn => {
    if (btn.dataset.m3Bound) return;
    btn.dataset.m3Bound = '1';
    btn.addEventListener('click', () => applyM3Theme(btn.dataset.m3Dot));
  });
}

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(String(url).trim(), window.location.origin);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch { /* invalid url */ }
  return '';
}

export function extractYouTubeId(url) {
  const safe = safeUrl(url);
  if (!safe) return null;
  try {
    const u = new URL(safe);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace('/', '').trim();
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex(p => p === 'embed' || p === 'shorts' || p === 'live');
      if (idx !== -1 && parts[idx + 1] && /^[a-zA-Z0-9_-]{11}$/.test(parts[idx + 1])) {
        return parts[idx + 1];
      }
    }
  } catch { /* ignore */ }
  return null;
}

export function isRootUser(user) {
  if (!user) return false;
  return user.isRootAdmin === true || user.is_root_admin === 1 || user.is_root_admin === true || user.username === 'admin';
}

export function parseArrayField(val) {
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val || '[]');
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch { return []; }
  }
  return [];
}

/**
 * Formats a clean, concise subline for any member:
 * - Root Admin / Admins: "Admin" (NO class, NO division, NO roll number)
 * - Teachers: Designation or concise subject/class summary
 * - Students: Class • Div • Roll #
 */
export function formatMemberSubline(member) {
  if (!member) return '';
  if (isRootUser(member) || member.role === 'admin') {
    return 'Admin';
  }
  if (member.role === 'teacher') {
    const desig = (member.teacher_designation || member.teacherDesignation || '').trim();
    const subs = parseArrayField(member.assigned_subjects || member.assignedSubjects);
    const clss = parseArrayField(member.assigned_classes || member.assignedClasses);
    if (desig) return desig;
    const subHint = subs.length > 1 ? `${subs[0]} +${subs.length - 1}` : (subs[0] || 'Faculty');
    const clsHint = clss.length > 1 ? `${clss[0]} +${clss.length - 1}` : (clss[0] || member.class_name || member.className || '');
    return [subHint, clsHint].filter(Boolean).join(' • ') || 'Teacher';
  }
  const cls = member.class_name || member.className || '';
  const div = member.division || '';
  const roll = member.roll_number || member.rollNumber || '';
  return [
    cls ? `${cls}${div ? ' (' + div + ')' : ''}` : '',
    roll ? `Roll #${roll}` : ''
  ].filter(Boolean).join(' • ');
}

export function renderRoleBadgeHtml(role, teacherType = null, isRootAdmin = false) {
  if (isRootAdmin) {
    return `<span title="Lead Admin (Student, Teacher & Admin Access)" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">Admin</span>`;
  }
  if (role === 'admin') {
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">Admin</span>`;
  }
  if (role === 'teacher') {
    const label = teacherType === 'class' ? 'Class Teacher' : 'Teacher';
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--md-primary-container)] text-[var(--md-on-primary-container)]">${label}</span>`;
  }
  return '';
}

export function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed bottom-20 md:bottom-5 right-4 left-4 md:left-auto z-[80] flex flex-col gap-2 md:max-w-sm pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const styles = {
    success: 'bg-[#1f2937] text-white border-emerald-400/30',
    error: 'bg-[#b3261e] text-white border-rose-300/30',
    info: 'bg-[#1f2937] text-white border-sky-400/30',
    warning: 'bg-amber-400 text-slate-950 border-amber-500/40',
  };
  const dotColors = {
    success: 'bg-emerald-400',
    error: 'bg-rose-200',
    info: 'bg-sky-400',
    warning: 'bg-amber-950',
  };

  const toast = document.createElement('div');
  toast.className = `${styles[type] || styles.info} border px-4 py-3 rounded-2xl shadow-xl shadow-slate-900/20 flex items-center gap-3 text-xs sm:text-sm font-medium toast-enter pointer-events-auto`;

  const dot = document.createElement('span');
  dot.className = `w-2 h-2 rounded-full shrink-0 ${dotColors[type] || dotColors.info}`;

  const textSpan = document.createElement('span');
  textSpan.className = 'flex-1 leading-snug';
  textSpan.textContent = String(message ?? '');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'opacity-70 hover:opacity-100 text-base leading-none px-1';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.append(dot, textSpan, closeBtn);
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

export function parseUtcDate(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date) return dateString;
  let str = String(dateString).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    str = str.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(str) && !str.endsWith('Z') && !/[+-]\d{2}:?\d{2}$/.test(str)) {
    str = str + 'Z';
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date(dateString) : d;
}

export function formatDate(dateString) {
  const date = parseUtcDate(dateString);
  if (!date || isNaN(date.getTime())) return dateString || '';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(dateString) {
  const date = parseUtcDate(dateString);
  if (!date || isNaN(date.getTime())) return dateString || '';

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) return timeStr;
  if (isYesterday) return `Yesterday, ${timeStr}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${timeStr}`;
}

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function initIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

export function bindModalBackdropAndEsc(modalEl, onClose) {
  if (!modalEl) return;
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) onClose();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) {
      onClose();
    }
  });
}

// Auto-apply Material You color palette immediately on script load
initM3Theme();

// Purge stale service workers for zero-delay network loads
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) reg.unregister();
  }).catch(() => {});
}
