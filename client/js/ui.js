/**
 * Shared UI Utilities: Safe HTML Escaping, URL Sanitization, Toasts & Formatters
 */

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

export function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed bottom-20 md:bottom-5 right-4 left-4 md:left-auto z-[70] flex flex-col gap-2 md:max-w-sm pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const styles = {
    success: 'bg-slate-900 text-white border-emerald-500/40',
    error: 'bg-rose-600 text-white border-rose-400/40',
    info: 'bg-slate-900 text-white border-indigo-400/40',
    warning: 'bg-amber-500 text-slate-950 border-amber-300',
  };
  const dotColors = {
    success: 'bg-emerald-400',
    error: 'bg-rose-200',
    info: 'bg-indigo-400',
    warning: 'bg-amber-950',
  };

  const toast = document.createElement('div');
  toast.className = `${styles[type] || styles.info} border px-4 py-3 rounded-xl shadow-lg shadow-slate-900/15 flex items-center gap-3 text-xs sm:text-sm font-medium toast-enter pointer-events-auto`;

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

// Purge stale service workers for zero-delay network loads
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) reg.unregister();
  }).catch(() => {});
}
