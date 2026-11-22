/**
 * VidyaSphere Edge Worker Entrypoint
 * Zero npm dependencies, 100% Native Web Standards
 */

import { handleOptions, errorResponse, jsonResponse } from './utils/response.js';
import { handleAuthRoutes } from './routes/auth.js';
import { handleAdminRoutes } from './routes/admin.js';
import { handleAnnouncementRoutes } from './routes/announcements.js';
import { handleNotesRoutes } from './routes/notes.js';
import { handleQARoutes } from './routes/qa.js';
import { handlePollsRoutes } from './routes/polls.js';
import { handleChatRoutes } from './routes/chat.js';
import { handleExamsRoutes } from './routes/exams.js';

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight options request
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // API Router
    if (path.startsWith('/api/')) {
      try {
        // Health check
        if (path === '/api/health') {
          return jsonResponse({
            status: 'ok',
            service: 'VidyaSphere Edge Core',
            version: '2.1',
            timestamp: new Date().toISOString(),
          });
        }

        // Auth & Identity
        if (path.startsWith('/api/auth/')) {
          return await handleAuthRoutes(request, env, path, method);
        }

        // Announcements (Public read & Admin publish)
        if (path === '/api/announcements' || path.startsWith('/api/admin/announcements')) {
          return await handleAnnouncementRoutes(request, env, path, method);
        }

        // Phase 5: Examination Schedules & Timetables (Admin manage & Student read)
        if (path === '/api/exams' || path.startsWith('/api/admin/exams')) {
          return await handleExamsRoutes(request, env, path, method);
        }

        // Administrative Core
        if (path.startsWith('/api/admin/')) {
          return await handleAdminRoutes(request, env, path, method);
        }

        // Phase 2: Academic Notes
        if (path.startsWith('/api/notes')) {
          return await handleNotesRoutes(request, env, path, method);
        }

        // Phase 3: Academic Q&A
        if (path.startsWith('/api/qa/')) {
          return await handleQARoutes(request, env, path, method);
        }

        // Phase 3: School Polls & Elections
        if (path.startsWith('/api/polls')) {
          return await handlePollsRoutes(request, env, path, method);
        }

        // Phase 4: Realtime School Chat
        if (path.startsWith('/api/chat/')) {
          return await handleChatRoutes(request, env, path, method);
        }

        return errorResponse(`API endpoint not found: ${path}`, 404);
      } catch (err) {
        return errorResponse(`Internal Server Error: ${err.message}`, 500);
      }
    }

    // Static Assets delivery (Cloudflare Pages or Workers Static Assets)
    if (env.ASSETS) {
      let targetPath = path;
      if (targetPath === '/' || targetPath === '') {
        targetPath = '/index.html';
      }

      // Try fetching requested path
      const assetUrl = new URL(request.url);
      assetUrl.pathname = targetPath;
      let res = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));

      // If 404 and path has no extension, try resolving to .html or /index.html
      if (res.status === 404 && !targetPath.includes('.')) {
        assetUrl.pathname = `${targetPath}.html`;
        const htmlRes = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        if (htmlRes.status !== 404) {
          return htmlRes;
        }

        assetUrl.pathname = `${targetPath}/index.html`;
        const dirIndexRes = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        if (dirIndexRes.status !== 404) {
          return dirIndexRes;
        }
      }

      return res;
    }

    return new Response(
      'VidyaSphere API Server running. Open client/index.html in browser or deploy via Cloudflare Pages.',
      {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      }
    );
  },

  // Production Cron Scheduled Event (Purge expired sessions, rate limits & tokens)
  async scheduled(event, env, ctx) {
    const now = Math.floor(Date.now() / 1000);
    try {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP`),
        env.DB.prepare(`DELETE FROM rate_limits WHERE reset_at < ?`).bind(now),
        env.DB.prepare(`DELETE FROM activation_codes WHERE expires_at < CURRENT_TIMESTAMP AND is_used = 0`),
        env.DB.prepare(`DELETE FROM note_files WHERE note_id IN (SELECT id FROM notes WHERE note_type = 'file' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP)`),
        env.DB.prepare(`DELETE FROM notes WHERE note_type = 'file' AND expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`)
      ]);
      console.log('Daily Edge Cron Maintenance complete: purged expired sessions & rate limits.');
    } catch (err) {
      console.error('Scheduled cron error:', err);
    }
  }
};
