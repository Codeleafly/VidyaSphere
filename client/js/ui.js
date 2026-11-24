/**
 * UI Utilities: Toasts, Modals, Formatters, Navigation
 */

export function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const bgColors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-indigo-600 text-white',
    warning: 'bg-amber-500 text-white',
  };

  const bg = bgColors[type] || bgColors.info;
  toast.className = `${bg} px-4 py-3 rounded-xl shadow-xl flex items-center gap-3 text-sm font-medium toast-enter pointer-events-auto`;
  toast.innerHTML = `
    <span class="flex-1">${message}</span>
    <button class="opacity-75 hover:opacity-100 text-lg leading-none" onclick="this.parentElement.remove()">&times;</button>
  `;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function parseUtcDate(dateString) {
  if (!dateString) return null;
  if (dateString instanceof Date) return dateString;
  let str = String(dateString).trim();
  // If SQLite default format "YYYY-MM-DD HH:MM:SS" -> treat as UTC by appending 'Z'
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

  // Automatic user local time for their specific country/timezone
  const timeStr = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  if (isToday) {
    return timeStr;
  }
  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }
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

// Purge any stale service workers to guarantee instant, zero-delay direct network loads
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) reg.unregister();
  }).catch(() => {});
}
