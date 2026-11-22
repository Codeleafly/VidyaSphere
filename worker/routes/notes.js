/**
 * Phase 2: Academic Notes & Study Material Library
 * Direct Cloudflare R2 Integration with graceful SQLite fallback
 */

import { jsonResponse, errorResponse, successResponse, corsHeaders } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export async function handleNotesRoutes(request, env, path, method) {
  // GET /api/notes - Filter and search notes
  if (path === '/api/notes' && method === 'GET') {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const className = url.searchParams.get('className') || '';
    const subject = url.searchParams.get('subject') || '';
    const sortBy = url.searchParams.get('sort') || 'newest'; // newest | downloads

    let query = `
      SELECT n.*, p.full_name as uploader_name, p.role as uploader_role
      FROM notes n
      LEFT JOIN profiles p ON n.uploader_id = p.id
      WHERE n.moderation_status = 'approved'
    `;
    const params = [];

    if (search) {
      query += ` AND (n.title LIKE ? OR n.chapter LIKE ? OR n.description LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (className) {
      query += ` AND n.class_name = ?`;
      params.push(className);
    }
    if (subject) {
      query += ` AND n.subject = ?`;
      params.push(subject);
    }

    if (sortBy === 'downloads') {
      query += ` ORDER BY n.download_count DESC, n.created_at DESC`;
    } else {
      query += ` ORDER BY n.created_at DESC`;
    }

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ notes: results || [] });
  }

  // POST /api/notes/upload - Upload study note
  if (path === '/api/notes/upload' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const contentType = request.headers.get('content-type') || '';
      let title, description, className, subject, chapter, fileBuffer, fileType, fileName, fileSize;

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        title = formData.get('title');
        description = formData.get('description') || '';
        className = formData.get('className');
        subject = formData.get('subject');
        chapter = formData.get('chapter') || '';
        const file = formData.get('file');

        if (!title || !className || !subject || !file) {
          return errorResponse('Title, Class, Subject, and File are required');
        }

        fileName = file.name || 'document.pdf';
        fileType = file.type || 'application/pdf';
        fileBuffer = await file.arrayBuffer();
        fileSize = fileBuffer.byteLength;
      } else {
        // Fallback JSON upload (e.g. Base64 payload or metadata)
        const body = await request.json();
        title = body.title;
        description = body.description || '';
        className = body.className;
        subject = body.subject;
        chapter = body.chapter || '';
        fileName = body.fileName || 'note.pdf';
        fileType = body.fileType || 'application/pdf';

        if (body.fileBase64) {
          const binary = atob(body.fileBase64);
          fileBuffer = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) fileBuffer[i] = binary.charCodeAt(i);
          fileSize = fileBuffer.byteLength;
        } else {
          // Placeholder 1KB buffer for testing if no file sent
          fileBuffer = new TextEncoder().encode(`VidyaSphere Note: ${title}\nClass: ${className}\nSubject: ${subject}\nChapter: ${chapter}\n\n[Study material content stored securely]`);
          fileSize = fileBuffer.byteLength;
        }
      }

      // Max 15MB size limit
      if (fileSize > 15 * 1024 * 1024) {
        return errorResponse('File size exceeds the 15MB limit');
      }

      const noteId = generateId('note', 8);
      const r2Key = `notes/${noteId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // 1. Insert parent record in notes table first
      await env.DB.prepare(
        `INSERT INTO notes (id, uploader_id, title, description, class_name, subject, chapter, r2_key, file_type, file_size, moderation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')`
      )
        .bind(
          noteId,
          auth.user.id,
          title.trim(),
          description.trim(),
          className.trim(),
          subject.trim(),
          chapter.trim(),
          r2Key,
          fileType,
          fileSize
        )
        .run();

      // 2. Always store actual file chunks in D1 database for reliable offline/R2-free downloading
      try {
        const base64Data = arrayBufferToBase64(fileBuffer);
        const CHUNK_SIZE = 60000;
        const chunkQueries = [];
        let chunkIdx = 0;
        for (let i = 0; i < base64Data.length; i += CHUNK_SIZE) {
          chunkQueries.push(
            env.DB.prepare(
              `INSERT INTO note_files (note_id, chunk_index, chunk_data) VALUES (?, ?, ?)`
            ).bind(noteId, chunkIdx++, base64Data.slice(i, i + CHUNK_SIZE))
          );
        }
        for (let i = 0; i < chunkQueries.length; i += 20) {
          await env.DB.batch(chunkQueries.slice(i, i + 20));
        }
      } catch (err) {
        console.error('Note chunk storage error:', err);
      }

      // 3. Upload to R2 bucket if STORAGE binding exists
      if (env.STORAGE) {
        try {
          await env.STORAGE.put(r2Key, fileBuffer, {
            httpMetadata: { contentType: fileType },
            customMetadata: { uploaderId: auth.user.id, title: title.trim() },
          });
        } catch (e) { /* ignore R2 errors */ }
      }

      return successResponse({ id: noteId, title, r2Key }, 'Note uploaded successfully', 201);
    } catch (err) {
      return errorResponse(`Upload error: ${err.message}`, 500);
    }
  }

  // GET /api/notes/:id/file - Stream file and increment download count
  if (path.startsWith('/api/notes/') && path.endsWith('/file') && method === 'GET') {
    const parts = path.split('/');
    const noteId = parts[3];

    const note = await env.DB.prepare(
      `SELECT * FROM notes WHERE id = ? AND moderation_status = 'approved'`
    ).bind(noteId).first();

    if (!note) return errorResponse('Note file not found', 404);

    // Atomically increment download counter
    await env.DB.prepare(
      `UPDATE notes SET download_count = download_count + 1 WHERE id = ?`
    ).bind(noteId).run();

    const ext = (note.file_type && note.file_type.includes('image')) ? 'jpg' : 'pdf';
    const cleanFilename = `${note.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;

    // Priority 1: Check in-database chunk storage (D1)
    try {
      const { results: chunks } = await env.DB.prepare(
        `SELECT chunk_data FROM note_files WHERE note_id = ? ORDER BY chunk_index ASC`
      ).bind(noteId).all();

      if (chunks && chunks.length > 0) {
        const fullBase64 = chunks.map(c => c.chunk_data).join('');
        const binary = atob(fullBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        return new Response(bytes, {
          headers: {
            'Content-Type': note.file_type || 'application/pdf',
            'Content-Disposition': `inline; filename="${cleanFilename}"`,
            ...corsHeaders(),
          },
        });
      }
    } catch (dbErr) {
      console.error('Error reading note chunks from D1:', dbErr);
    }

    // Priority 2: Stream from R2 if bucket exists
    if (env.STORAGE) {
      const object = await env.STORAGE.get(note.r2_key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Content-Disposition', `inline; filename="${cleanFilename}"`);
        Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));

        return new Response(object.body, { headers });
      }
    }

    // Fallback if older mock note without uploaded file
    const sampleContent = `VidyaSphere Note: ${note.title}\nClass: ${note.class_name} | Subject: ${note.subject} | Chapter: ${note.chapter}\nDescription: ${note.description}\n\n[End of study document]`;
    return new Response(sampleContent, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${note.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.txt"`,
        ...corsHeaders(),
      },
    });
  }

  // DELETE /api/notes/:id - Delete note (uploader or admin)
  if (path.startsWith('/api/notes/') && !path.endsWith('/report') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const noteId = path.replace('/api/notes/', '');
    const note = await env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(noteId).first();

    if (!note) return errorResponse('Note not found', 404);
    if (note.uploader_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only delete your own notes', 403);
    }

    if (env.STORAGE && note.r2_key) {
      try { await env.STORAGE.delete(note.r2_key); } catch (e) { /* ignore */ }
    }

    try {
      await env.DB.prepare(`DELETE FROM note_files WHERE note_id = ?`).bind(noteId).run();
    } catch (e) { /* ignore */ }

    await env.DB.prepare(`DELETE FROM notes WHERE id = ?`).bind(noteId).run();
    return successResponse({}, 'Note deleted successfully');
  }

  // POST /api/notes/:id/report - Student reporting
  if (path.startsWith('/api/notes/') && path.endsWith('/report') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const parts = path.split('/');
    const noteId = parts[3];

    try {
      const body = await request.json();
      const { reason } = body;

      if (!reason) return errorResponse('Report reason is required');

      const reportId = generateId('rep', 8);
      await env.DB.prepare(
        `INSERT INTO note_reports (id, note_id, reporter_id, reason) VALUES (?, ?, ?, ?)`
      ).bind(reportId, noteId, auth.user.id, reason.trim()).run();

      return successResponse({}, 'Report submitted. School moderators will review it.');
    } catch (err) {
      return errorResponse(`Report error: ${err.message}`, 500);
    }
  }

  return errorResponse('Notes route not found', 404);
}
