/**
 * Auth State & Session Management for VidyaSphere (Students, Teachers, Admins)
 * Pure Vanilla JS
 */

export function getToken() {
  return localStorage.getItem('vidyasphere_token');
}

export function getUser() {
  const userJson = localStorage.getItem('vidyasphere_user');
  try {
    return userJson ? JSON.parse(userJson) : null;
  } catch (e) {
    return null;
  }
}

export const getAuthToken = getToken;
export const getCurrentUser = getUser;

export function setAuthToken(token) {
  localStorage.setItem('vidyasphere_token', token);
}

export function setCurrentUser(user) {
  localStorage.setItem('vidyasphere_user', JSON.stringify(user));
}

export function saveSession(token, user) {
  setAuthToken(token);
  setCurrentUser(user);
}

export function clearSession() {
  localStorage.removeItem('vidyasphere_token');
  localStorage.removeItem('vidyasphere_user');
  localStorage.removeItem('vidyasphere_tracking_token');
}

export function getHomeRouteForUser(user) {
  if (!user) return '/auth/login.html';
  if (user.accountStatus === 'pending') return '/auth/pending.html';
  if (user.role === 'admin') return '/admin/index.html';
  if (user.role === 'teacher') return '/teacher/index.html';
  return '/dashboard/index.html';
}

export async function logout() {
  const token = getToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (e) { /* ignore */ }
  }
  clearSession();
  window.location.replace('/auth/login.html');
}

export function redirectIfLoggedIn() {
  const token = getToken();
  const user = getUser();
  if (token && user) {
    window.location.replace(getHomeRouteForUser(user));
    return true;
  }
  return false;
}

export function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.replace(`/auth/login.html?redirect=${encodeURIComponent(window.location.pathname)}`);
    return null;
  }

  const user = getUser();
  if (!user) {
    clearSession();
    window.location.replace('/auth/login.html');
    return null;
  }

  if (user.accountStatus === 'pending' && !window.location.pathname.includes('/auth/pending')) {
    window.location.replace('/auth/pending.html');
    return null;
  }

  return user;
}

export function requireTeacher() {
  const user = requireAuth();
  if (!user) return null;

  if (user.role !== 'teacher' && user.role !== 'admin') {
    window.location.replace('/dashboard/index.html');
    return null;
  }
  return user;
}

export function requireAdmin() {
  const user = requireAuth();
  if (!user) return null;

  if (user.role !== 'admin') {
    alert('Access restricted to School Administration only.');
    window.location.replace(getHomeRouteForUser(user));
    return null;
  }
  return user;
}
