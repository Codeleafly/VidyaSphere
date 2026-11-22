/**
 * Response and CORS utilities for VidyaSphere Worker
 * Pure Web Native APIs (Request, Response, Headers)
 */

export function corsHeaders(extraHeaders = {}, env = null) {
  const allowedOrigin = (env && env.ALLOWED_ORIGIN) ? env.ALLOWED_ORIGIN : '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    ...extraHeaders,
  };
}

export function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...headers,
    },
  });
}

export function errorResponse(message, status = 400, details = null) {
  const payload = { success: false, error: message };
  if (details) payload.details = details;
  return jsonResponse(payload, status);
}

export function successResponse(data = {}, message = null, status = 200) {
  const payload = { success: true, ...data };
  if (message) payload.message = message;
  return jsonResponse(payload, status);
}
