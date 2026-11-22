/**
 * Phase 2: Academic Notes & Study Material Library
 * Direct Cloudflare R2 Integration with graceful SQLite fallback
 */

import { jsonResponse, errorResponse, successResponse, corsHeaders } from '../utils/response.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

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

      // Upload to R2 bucket if STORAGE binding exists
      if (env.STORAGE) {
        await env.STORAGE.put(r2Key, fileBuffer, {
          httpMetadata: {
            contentType: fileType,
          },
          customMetadata: {
            uploaderId: auth.user.id,
            title: title.trim(),
          },
        });
      }

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

    // Stream from R2 if bucket exists
    if (env.STORAGE) {
      const object = await env.STORAGE.get(note.r2_key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Content-Disposition', `inline; filename="${note.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.${note.file_type.includes('image') ? 'jpg' : 'pdf'}"`);
        Object.entries(corsHeaders()).forEach(([k, v]) => headers.set(k, v));

        return new Response(object.body, { headers });
      }
    }

    // Graceful mock content if R2 local binding is absent
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
