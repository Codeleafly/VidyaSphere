/**
 * VidyaSphere Native Termux Local Dev Server
 * Zero npm dependencies, 100% Pure Node.js Built-ins
 * Solves Android/Termux 'workerd EPIPE' binary incompatibility
 * 
 * Usage: node dev.js
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from './worker/index.js';

const PORT = process.env.PORT || 8787;
const HOST = '0.0.0.0';
const DB_FILE = './vidyasphere.db';

// 1. Initialize SQLite Database
const isNewDb = !fs.existsSync(DB_FILE);
const sqlite = new DatabaseSync(DB_FILE);

// Ensure idempotent Phase 6 additive columns on pre-existing local SQLite databases
function ensurePhase6Columns(db) {
  const columnAdditions = [
    ['profiles', 'teacher_type', `TEXT DEFAULT NULL CHECK(teacher_type IN ('subject', 'class'))`],
    ['profiles', 'assigned_classes', `TEXT DEFAULT '[]'`],
    ['profiles', 'assigned_subjects', `TEXT DEFAULT '[]'`],
    ['profiles', 'allow_student_dms', `INTEGER DEFAULT 1`],
    ['notes', 'is_teacher_verified', `INTEGER DEFAULT 0`],
    ['answers', 'is_faculty_endorsed', `INTEGER DEFAULT 0`],
    ['answers', 'endorsed_by', `TEXT`],
    ['messages', 'is_pinned', `INTEGER DEFAULT 0`],
    ['messages', 'pinned_by', `TEXT`],
    ['exams', 'exam_type', `TEXT NOT NULL DEFAULT 'board' CHECK(exam_type IN ('board', 'unit_test'))`],
  ];

  for (const [table, col, def] of columnAdditions) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(c => c.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def};`);
    }
  }
}

if (isNewDb) {
  console.log('📦 Initializing local database schema & seed data...');
  sqlite.exec(fs.readFileSync('./schema.sql', 'utf8'));
  sqlite.exec(fs.readFileSync('./seed.sql', 'utf8'));
  console.log('✓ Database initialized: vidyasphere.db');
} else {
  // Ensure schema tables & Phase 6 columns exist in case of partial runs
  sqlite.exec(fs.readFileSync('./schema.sql', 'utf8'));
  ensurePhase6Columns(sqlite);
}

// 2. Cloudflare D1 Native Adapter
function createD1Adapter(db) {
  function createStatement(query, boundParams = []) {
    return {
      bind(...args) {
        return createStatement(query, args);
      },
      async first() {
        return db.prepare(query).get(...boundParams) || null;
      },
      async all() {
        return { results: db.prepare(query).all(...boundParams) || [] };
      },
      async run() {
        const res = db.prepare(query).run(...boundParams);
        return { success: true, changes: res.changes, lastRowId: res.lastInsertRowid };
      }
    };
  }

  return {
    prepare(sql) { return createStatement(sql); },
    async batch(stmts) { return Promise.all(stmts.map(s => s.run())); }
  };
}

// 3. Environment Context
const env = {
  DB: createD1Adapter(sqlite),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'shishuvan@2026',
  JWT_SECRET: process.env.JWT_SECRET || 'vidyasphere_edge_super_secret_key_2026_change_in_production',
  STORAGE: {
    async put(key, buf) { return true; },
    async get(key) { return null; },
    async delete(key) { return true; }
  }
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// 4. HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:8787'}`);

  // Handle API Requests via Worker
  if (url.pathname.startsWith('/api/')) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    const bodyBuffer = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const webReq = new Request(url.href, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : bodyBuffer
    });

    try {
      const workerRes = await worker.fetch(webReq, env);
      res.writeHead(workerRes.status, Object.fromEntries(workerRes.headers.entries()));
      const resBuf = Buffer.from(await workerRes.arrayBuffer());
      res.end(resBuf);
    } catch (err) {
      console.error('API Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // Handle Static Files (from ./client/)
  let cleanPath = decodeURIComponent(url.pathname);
  if (cleanPath === '/') cleanPath = '/index.html';

  let filePath = path.join('./client', cleanPath);

  // If directory, look for index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1><p>VidyaSphere Edge Portal</p>');
  }
});

server.listen(PORT, HOST, () => {
  console.log("\n========================================================");
  console.log("   🎓 VIDYASPHERE NATIVE LOCAL SERVER IS RUNNING        ");
  console.log("========================================================");
  console.log(`🌐 Local URL:   http://localhost:${PORT}`);
  console.log(`📱 Network URL: http://0.0.0.0:${PORT}`);
  console.log(`📁 Database:    SQLite (vidyasphere.db persistent)`);
  console.log("--------------------------------------------------------");
  console.log("🔑 Admin Username: admin");
  console.log("🔑 Admin Password: shishuvan@2026");
  console.log("========================================================");
  console.log("Press Ctrl+C to stop the server anytime.\n");
});
