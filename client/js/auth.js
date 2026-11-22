/**
 * Auth State & Session Management
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

export function saveSession(token, user) {
  localStorage.setItem('vidyasphere_token', token);
  localStorage.setItem('vidyasphere_user', JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('vidyasphere_token');
  localStorage.removeItem('vidyasphere_user');
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
  window.location.href = '/auth/login.html';
}

export function requireAuth() {
  const token = getToken();
  if (!token) {
    window.location.href = `/auth/login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    return null;
  }
  return getUser();
}

export function requireAdmin() {
  const user = requireAuth();
  if (user && user.role !== 'admin') {
    alert('Access restricted to School Administration only.');
    window.location.href = '/dashboard/index.html';
    return null;
  }
  return user;
}
