/**
 * Phase 2: Academic Notes & Study Material Library
 * Direct Cloudflare D1 gzip-compressed BLOB chunking with optional R2 integration
 */

import { errorResponse, successResponse, corsHeaders } from '../utils/response.js';
import { compressData, decompressData, toUint8Array, validateHttpUrl } from '../utils/compression.js';
import { generateId } from '../auth/crypto.js';
import { authenticate } from '../auth/middleware.js';

export async function handleNotesRoutes(request, env, path, method) {
  // GET /api/notes - Filter and search active approved notes
  if (path === '/api/notes' && method === 'GET') {
    const url = new URL(request.url);
    const search = url.searchParams.get('search') || '';
    const className = url.searchParams.get('className') || '';
    const subject = url.searchParams.get('subject') || '';
    const sortBy = url.searchParams.get('sort') || 'newest';
    const verifiedOnly = url.searchParams.get('verified') === '1' || url.searchParams.get('verified') === 'true';
    const uploaderId = (url.searchParams.get('uploaderId') || '').trim();

    let query = `
      SELECT n.*, p.full_name as uploader_name, p.role as uploader_role, p.teacher_type as uploader_teacher_type, p.is_root_admin as uploader_is_root_admin
      FROM notes n
      LEFT JOIN profiles p ON n.uploader_id = p.id
      WHERE n.moderation_status = 'approved'
        AND (n.expires_at IS NULL OR datetime(n.expires_at) > datetime('now'))
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
    if (verifiedOnly) {
      query += ` AND (n.is_teacher_verified = 1 OR p.role IN ('teacher', 'admin'))`;
    }
    if (uploaderId) {
      query += ` AND n.uploader_id = ?`;
      params.push(uploaderId);
    }

    query += sortBy === 'downloads'
      ? ` ORDER BY n.download_count DESC, n.created_at DESC`
      : ` ORDER BY n.created_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();
    return successResponse({ notes: results || [] });
  }

  // POST /api/notes/upload - Upload study note
  if (path === '/api/notes/upload' && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    try {
      const contentType = request.headers.get('content-type') || '';
      let title, description, className, subject, chapter, noteType, driveUrl;
      let fileBuffer = null, fileType = 'application/pdf', fileName = 'document.pdf', fileSize = 0;

      let activeAcademicYear = '2026-2027';
      try {
        const yearRow = await env.DB.prepare(`SELECT value FROM school_settings WHERE key = 'academic_year'`).first();
        if (yearRow?.value) activeAcademicYear = yearRow.value;
      } catch { /* ignore */ }

      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData();
        title = formData.get('title');
        description = formData.get('description') || '';
        className = formData.get('className');
        subject = formData.get('subject');
        chapter = formData.get('chapter') || '';
        noteType = formData.get('noteType') || 'file';
        driveUrl = formData.get('driveUrl') || '';
        const file = formData.get('file');

        if (!title || !className || !subject) {
          return errorResponse('Title, Class, and Subject are required');
        }

        if (noteType !== 'drive_link') {
          if (!file) return errorResponse('File is required for direct upload');
          fileName = file.name || 'document.pdf';
          fileType = file.type || 'application/pdf';
          fileBuffer = await file.arrayBuffer();
          fileSize = fileBuffer.byteLength;
        }
      } else {
        const body = await request.json();
        title = body.title;
        description = body.description || '';
        className = body.className;
        subject = body.subject;
        chapter = body.chapter || '';
        noteType = body.noteType || (body.driveUrl ? 'drive_link' : 'file');
        driveUrl = body.driveUrl || '';
        fileName = body.fileName || 'note.pdf';
        fileType = body.fileType || 'application/pdf';

        if (!title || !className || !subject) {
          return errorResponse('Title, Class, and Subject are required');
        }

        if (noteType !== 'drive_link') {
          if (body.fileBase64) {
            const binary = atob(body.fileBase64);
            fileBuffer = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) fileBuffer[i] = binary.charCodeAt(i);
            fileSize = fileBuffer.byteLength;
          } else {
            fileBuffer = new TextEncoder().encode(`VidyaSphere Note: ${title}\nClass: ${className}\nSubject: ${subject}\n\n[Study material content]`);
            fileSize = fileBuffer.byteLength;
          }
        }
      }

      let cleanDriveUrl = null;
      if (noteType === 'drive_link') {
        const urlCheck = validateHttpUrl(driveUrl);
        if (!urlCheck || urlCheck.error) {
          return errorResponse(urlCheck?.error || 'A valid public Google Drive / cloud URL is required');
        }
        cleanDriveUrl = urlCheck.url;
      }

      // Daily upload limit for direct files: Teachers 20/24h, Students 4/24h
      if (noteType === 'file' && auth.user.role !== 'admin') {
        const dailyLimit = auth.user.role === 'teacher' ? 20 : 4;
        const uploadCountRow = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM notes
           WHERE uploader_id = ? AND note_type = 'file' AND datetime(created_at) >= datetime('now', '-1 day')`
        ).bind(auth.user.id).first();

        if (uploadCountRow && uploadCountRow.count >= dailyLimit) {
          return errorResponse(
            `Daily upload limit reached (${dailyLimit} files / 24 hours). You can still share unlimited Google Drive links.`,
            429
          );
        }
      }

      if (fileSize > 15 * 1024 * 1024) {
        return errorResponse('File size exceeds the 15MB limit. Please compress the file or share via a Google Drive link.');
      }

      const noteId = generateId('note', 8);
      const r2Key = noteType === 'drive_link' ? null : `notes/${noteId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const expiresAt = noteType === 'drive_link'
        ? null
        : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      const isTeacherVerified = (auth.user.role === 'teacher' || auth.user.role === 'admin') ? 1 : 0;

      await env.DB.prepare(
        `INSERT INTO notes (id, uploader_id, title, description, class_name, subject, chapter, note_type, drive_url, academic_year, expires_at, r2_key, file_type, file_size, moderation_status, is_teacher_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`
      ).bind(
        noteId,
        auth.user.id,
        title.trim(),
        description.trim(),
        className.trim(),
        subject.trim(),
        chapter.trim(),
        noteType,
        cleanDriveUrl,
        activeAcademicYear,
        expiresAt,
        r2Key,
        fileType,
        fileSize,
        isTeacherVerified
      ).run();

      if (fileBuffer && noteType === 'file') {
        try {
          const compressed = await compressData(fileBuffer);
          const compressedBytes = new Uint8Array(compressed);
          const CHUNK_SIZE = 60000;
          const chunkQueries = [];
          let chunkIdx = 0;
          for (let i = 0; i < compressedBytes.length; i += CHUNK_SIZE) {
            const chunkSlice = compressedBytes.slice(i, i + CHUNK_SIZE);
            chunkQueries.push(
              env.DB.prepare(`INSERT INTO note_files (note_id, chunk_index, chunk_data) VALUES (?, ?, ?)`)
                .bind(noteId, chunkIdx++, chunkSlice)
            );
          }
          for (let i = 0; i < chunkQueries.length; i += 20) {
            await env.DB.batch(chunkQueries.slice(i, i + 20));
          }
        } catch (err) {
          await env.DB.prepare(`DELETE FROM notes WHERE id = ?`).bind(noteId).run().catch(() => {});
          return errorResponse(`Failed to store note file chunks: ${err.message}`, 500);
        }

        if (env.STORAGE && r2Key) {
          try {
            await env.STORAGE.put(r2Key, fileBuffer, {
              httpMetadata: { contentType: fileType },
              customMetadata: { uploaderId: auth.user.id, title: title.trim() },
            });
          } catch { /* ignore optional R2 errors */ }
        }
      }

      return successResponse({
        id: noteId,
        title,
        noteType,
        driveUrl: cleanDriveUrl,
        academicYear: activeAcademicYear,
        expiresAt,
        isTeacherVerified: isTeacherVerified === 1
      }, noteType === 'drive_link' ? 'Google Drive material linked successfully (Permanent for Academic Year)!' : 'Note uploaded successfully (Valid for 30 days)!', 201);
    } catch (err) {
      return errorResponse(`Upload error: ${err.message}`, 500);
    }
  }

  // GET /api/notes/:id/file - Stream file or redirect to Google Drive
  if (path.startsWith('/api/notes/') && path.endsWith('/file') && method === 'GET') {
    const noteId = path.split('/')[3];

    const note = await env.DB.prepare(
      `SELECT * FROM notes
       WHERE id = ? AND moderation_status = 'approved'
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`
    ).bind(noteId).first();

    if (!note) return errorResponse('Note file not found or expired', 404);

    await env.DB.prepare(`UPDATE notes SET download_count = download_count + 1 WHERE id = ?`).bind(noteId).run();

    if (note.note_type === 'drive_link' && note.drive_url) {
      return Response.redirect(note.drive_url, 302);
    }

    const ext = (note.file_type && note.file_type.includes('image')) ? 'jpg' : 'pdf';
    const cleanFilename = `${note.title.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;

    try {
      const { results: chunks } = await env.DB.prepare(
        `SELECT chunk_data FROM note_files WHERE note_id = ? ORDER BY chunk_index ASC`
      ).bind(noteId).all();

      if (chunks && chunks.length > 0) {
        const normalizedChunks = chunks.map(c => toUint8Array(c.chunk_data));
        const totalLen = normalizedChunks.reduce((sum, ch) => sum + ch.length, 0);
        const fullBuffer = new Uint8Array(totalLen);
        let offset = 0;
        for (const ch of normalizedChunks) {
          fullBuffer.set(ch, offset);
          offset += ch.length;
        }

        const isGzip = fullBuffer.length >= 2 && fullBuffer[0] === 0x1f && fullBuffer[1] === 0x8b;
        const outputBytes = isGzip ? await decompressData(fullBuffer.buffer) : fullBuffer.buffer;

        return new Response(outputBytes, {
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
  if (path.startsWith('/api/notes/') && !path.endsWith('/report') && !path.endsWith('/file') && method === 'DELETE') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const noteId = path.replace('/api/notes/', '').trim();
    if (!noteId || noteId.includes('/')) return errorResponse('Invalid note ID', 400);
    const note = await env.DB.prepare(`SELECT * FROM notes WHERE id = ?`).bind(noteId).first();

    if (!note) return errorResponse('Note not found', 404);
    if (note.uploader_id !== auth.user.id && auth.user.role !== 'admin') {
      return errorResponse('Forbidden: You can only delete your own notes', 403);
    }

    if (env.STORAGE && note.r2_key) {
      try { await env.STORAGE.delete(note.r2_key); } catch { /* ignore */ }
    }

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM note_reports WHERE note_id = ?`).bind(noteId),
      env.DB.prepare(`DELETE FROM note_files WHERE note_id = ?`).bind(noteId),
      env.DB.prepare(`DELETE FROM notes WHERE id = ?`).bind(noteId)
    ]);

    return successResponse({}, 'Note deleted successfully');
  }

  // POST /api/notes/:id/report - Student reporting
  if (path.startsWith('/api/notes/') && path.endsWith('/report') && method === 'POST') {
    const auth = await authenticate(request, env);
    if (auth.error) return auth.error;

    const noteId = path.split('/')[3];

    try {
      const body = await request.json();
      const { reason } = body;
      if (!reason || !String(reason).trim()) return errorResponse('Report reason is required');

      const noteExists = await env.DB.prepare(`SELECT id FROM notes WHERE id = ?`).bind(noteId).first();
      if (!noteExists) return errorResponse('Note not found', 404);

      const reportId = generateId('rep', 8);
      await env.DB.prepare(
        `INSERT INTO note_reports (id, note_id, reporter_id, reason) VALUES (?, ?, ?, ?)`
      ).bind(reportId, noteId, auth.user.id, String(reason).trim()).run();

      return successResponse({}, 'Report submitted. School moderators will review it.');
    } catch (err) {
      return errorResponse(`Report error: ${err.message}`, 500);
    }
  }

  return errorResponse('Notes route not found', 404);
}
