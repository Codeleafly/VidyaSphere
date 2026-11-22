/**
 * Central API Client for VidyaSphere
 * Pure Vanilla JS Fetch Wrapper
 */

const API_BASE = '/api';

export async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem('vidyasphere_token');
  const headers = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // If body is an object and not FormData, stringify it
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      body,
    });

    // Check if the response is JSON
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}`);
      }
      return data;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `HTTP error ${response.status}`);
    }

    return response;
  } catch (err) {
    console.error(`API Error [${endpoint}]:`, err);
    throw err;
  }
}
