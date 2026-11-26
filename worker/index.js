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
import { handleStudentsRoutes } from './routes/students.js';
import { handleTeacherRoutes } from './routes/teacher.js';
import { handleLessonsRoutes } from './routes/lessons.js';
import { handleQuizzesRoutes } from './routes/quizzes.js';
import { handleHomeworkRoutes } from './routes/homework.js';

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight options request
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // SEO: Dynamic robots.txt and sitemap.xml aligned to active host (Main or Preview)
    if (path === '/robots.txt' && (method === 'GET' || method === 'HEAD')) {
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Allow: /guide',
        'Allow: /auth/login',
        'Allow: /auth/register',
        'Allow: /auth/status',
        'Disallow: /api/',
        'Disallow: /admin/',
        'Disallow: /teacher/',
        'Disallow: /dashboard/',
        '',
        `Sitemap: ${url.origin}/sitemap.xml`,
        '',
      ].join('\n');
      return new Response(method === 'HEAD' ? null : robots, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (path === '/sitemap.xml' && (method === 'GET' || method === 'HEAD')) {
      const origin = url.origin;
      const lastmod = new Date().toISOString().slice(0, 10);
      const entries = [
        { loc: `${origin}/`, changefreq: 'daily', priority: '1.0' },
        { loc: `${origin}/guide`, changefreq: 'weekly', priority: '0.9' },
        { loc: `${origin}/auth/login`, changefreq: 'monthly', priority: '0.8' },
        { loc: `${origin}/auth/register`, changefreq: 'monthly', priority: '0.8' },
        { loc: `${origin}/auth/status`, changefreq: 'monthly', priority: '0.6' },
      ];
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...entries.map(
          (e) =>
            `  <url><loc>${e.loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`
        ),
        '</urlset>',
        '',
      ].join('\n');
      return new Response(method === 'HEAD' ? null : xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

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

        // Phase 5 & 6: Examination Schedules & Class Teacher Unit Tests
        if (path === '/api/exams' || path.startsWith('/api/admin/exams') || path.startsWith('/api/teacher/exams')) {
          return await handleExamsRoutes(request, env, path, method);
        }

        // Phase 6: Teacher Studio & Class Teacher Scoped Endpoints
        if (path.startsWith('/api/teacher/')) {
          return await handleTeacherRoutes(request, env, path, method);
        }

        // Phase 6: Lessons, MCQ Quizzes & Homework
        if (path === '/api/lessons' || path.startsWith('/api/lessons/')) {
          return await handleLessonsRoutes(request, env, path, method);
        }
        if (path === '/api/quizzes' || path.startsWith('/api/quizzes/')) {
          return await handleQuizzesRoutes(request, env, path, method);
        }
        if (path === '/api/homework' || path.startsWith('/api/homework/')) {
          return await handleHomeworkRoutes(request, env, path, method);
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

        // Student Directory & Classmate Discovery (Active Students & Admins)
        if (path === '/api/students' || path.startsWith('/api/students/')) {
          return await handleStudentsRoutes(request, env, path, method);
        }

        return errorResponse(`API endpoint not found: ${path}`, 404);
      } catch (err) {
        return errorResponse(`Internal Server Error: ${err.message}`, 500);
      }
    }

    // Static Assets delivery (Cloudflare Pages or Workers Static Assets)
    if (env.ASSETS) {
      const withHtmlHeaders = (assetRes) => {
        const headers = new Headers(assetRes.headers);
        headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        headers.set('Pragma', 'no-cache');
        headers.set('Expires', '0');
        headers.set('X-Content-Type-Options', 'nosniff');
        headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
        return new Response(assetRes.body, { status: assetRes.status, headers });
      };

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
          return withHtmlHeaders(htmlRes);
        }

        assetUrl.pathname = `${targetPath}/index.html`;
        const dirIndexRes = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        if (dirIndexRes.status !== 404) {
          return withHtmlHeaders(dirIndexRes);
        }
      }

      // If serving an HTML file, prevent stale browser caching & set standard SEO/security headers
      if (res.headers.get('content-type')?.includes('text/html')) {
        return withHtmlHeaders(res);
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

  // Production Cron Scheduled Event (Purge expired sessions, rate limits & notes)
  async scheduled(event, env, ctx) {
    const now = Math.floor(Date.now() / 1000);
    try {
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`),
        env.DB.prepare(`DELETE FROM rate_limits WHERE reset_at < ?`).bind(now),
        env.DB.prepare(`DELETE FROM announcements WHERE (expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')) OR (expires_at IS NULL AND datetime(created_at) < datetime('now', '-30 days'))`),
        env.DB.prepare(`DELETE FROM note_reports WHERE note_id IN (SELECT id FROM notes WHERE note_type = 'file' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now'))`),
        env.DB.prepare(`DELETE FROM note_files WHERE note_id IN (SELECT id FROM notes WHERE note_type = 'file' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now'))`),
        env.DB.prepare(`DELETE FROM notes WHERE note_type = 'file' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')`),
        env.DB.prepare(`DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE datetime(created_at) < datetime('now', '-7 days'))`),
        env.DB.prepare(`DELETE FROM messages WHERE datetime(created_at) < datetime('now', '-7 days')`)
      ]);
      console.log('Daily Edge Cron Maintenance complete: purged expired sessions, rate limits, 30-day notices, expired notes & 7-day old messages.');
    } catch (err) {
      console.error('Scheduled cron error:', err);
    }
  }
};
