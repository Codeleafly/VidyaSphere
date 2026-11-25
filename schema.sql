-- VIDYASPHERE DATABASE SCHEMA (PHASES 1 - 6)
-- Pure SQLite / Cloudflare D1 Compatible

-- PHASE 1 & 6: User Profiles & Identity (Students, Teachers, Admins)
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    full_name TEXT NOT NULL,
    class_name TEXT NOT NULL,
    division TEXT NOT NULL DEFAULT '',
    roll_number TEXT NOT NULL DEFAULT '',
    email TEXT,
    role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student', 'teacher', 'admin')),
    account_status TEXT NOT NULL DEFAULT 'pending' CHECK(account_status IN ('pending', 'active', 'suspended', 'rejected')),
    is_root_admin INTEGER DEFAULT 0,
    rejection_reason TEXT,
    teacher_type TEXT DEFAULT NULL CHECK(teacher_type IN ('subject', 'class')),
    assigned_classes TEXT DEFAULT '[]',
    assigned_subjects TEXT DEFAULT '[]',
    allow_student_dms INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PHASE 1: High-Entropy Server-Side Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 1: School Official Announcements / Notice Board (Auto-expires after 30 days / 1 month)
CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'general' CHECK(priority IN ('general', 'urgent', 'exam', 'holiday')),
    target_class TEXT NOT NULL DEFAULT 'all',
    author_id TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES profiles(id)
);

-- PHASE 1: Administrative Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor_id TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PHASE 2: Academic Notes & Study Material Library
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    uploader_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    class_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    chapter TEXT,
    note_type TEXT NOT NULL DEFAULT 'file' CHECK(note_type IN ('file', 'drive_link')),
    drive_url TEXT,
    academic_year TEXT NOT NULL DEFAULT '2026-2027',
    expires_at DATETIME,
    r2_key TEXT,
    file_type TEXT DEFAULT 'application/pdf',
    file_size INTEGER DEFAULT 0,
    moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK(moderation_status IN ('pending', 'approved', 'flagged', 'rejected')),
    is_teacher_verified INTEGER DEFAULT 0,
    download_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploader_id) REFERENCES profiles(id)
);

-- General Platform & School Settings (e.g. Current Academic Year)
CREATE TABLE IF NOT EXISTS school_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- PHASE 2: In-Database Chunk Storage with Binary BLOB & Compression
CREATE TABLE IF NOT EXISTS note_files (
    note_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    chunk_data BLOB NOT NULL,
    PRIMARY KEY (note_id, chunk_index),
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

-- PHASE 2: Note Flagging & Reports
CREATE TABLE IF NOT EXISTS note_reports (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    reporter_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (note_id) REFERENCES notes(id),
    FOREIGN KEY (reporter_id) REFERENCES profiles(id)
);

-- PHASE 3: Academic Q&A Questions
CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    subject TEXT NOT NULL,
    class_name TEXT NOT NULL,
    is_resolved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES profiles(id)
);

-- PHASE 3 & 6: Academic Q&A Answers
CREATE TABLE IF NOT EXISTS answers (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    answer_text TEXT NOT NULL,
    is_accepted INTEGER DEFAULT 0,
    is_faculty_endorsed INTEGER DEFAULT 0,
    endorsed_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES questions(id),
    FOREIGN KEY (author_id) REFERENCES profiles(id)
);

-- PHASE 3: School Polls & Elections
CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    creator_id TEXT NOT NULL,
    question TEXT NOT NULL,
    options_json TEXT NOT NULL,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES profiles(id)
);

-- PHASE 3: Duplicate-Proof Vote Ledger
CREATE TABLE IF NOT EXISTS poll_votes (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    option_index INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(poll_id, user_id),
    FOREIGN KEY (poll_id) REFERENCES polls(id),
    FOREIGN KEY (user_id) REFERENCES profiles(id)
);

-- Production Hardening: Rate Limiting Ledger (Brute-Force & Abuse Prevention)
CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER DEFAULT 1,
    reset_at INTEGER NOT NULL
);

-- PHASE 4 & 6: Realtime School & Class Chat Messages (Ephemeral 7-Day Auto-Purge)
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'school',
    content TEXT NOT NULL,
    is_edited INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    pinned_by TEXT,
    has_attachment INTEGER DEFAULT 0,
    attachment_name TEXT,
    attachment_type TEXT,
    attachment_size INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 4: Compressed In-Database Binary Storage for Chat Attachments (Scientific Lossless Gzip)
CREATE TABLE IF NOT EXISTS message_attachments (
    message_id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    compressed_data BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- PHASE 4: Direct Message Consent & Conversations (Permission-Based Direct Messaging)
CREATE TABLE IF NOT EXISTS direct_chats (
    id TEXT PRIMARY KEY,
    user1_id TEXT NOT NULL,
    user2_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
    requested_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user1_id, user2_id),
    FOREIGN KEY (user1_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 4: Study Groups & Custom Group Chats
CREATE TABLE IF NOT EXISTS chat_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    class_name TEXT DEFAULT 'all',
    creator_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (creator_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    invite_status TEXT NOT NULL DEFAULT 'accepted' CHECK(invite_status IN ('pending', 'accepted', 'rejected')),
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 5 & 6: Official Examination Schedules & Class Unit Tests
CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    class_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    room_or_hall TEXT,
    syllabus TEXT,
    drive_link TEXT,
    exam_type TEXT NOT NULL DEFAULT 'board' CHECK(exam_type IN ('board', 'unit_test')),
    academic_year TEXT NOT NULL DEFAULT '2026-2027',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES profiles(id)
);

-- PHASE 6: Chapter-Wise Teacher Lessons (YouTube Unlisted + Drive + Summary)
CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    title TEXT NOT NULL,
    class_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    chapter TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    video_url TEXT,
    resource_url TEXT,
    academic_year TEXT NOT NULL DEFAULT '2026-2027',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 6: 5-Minute Auto-Graded MCQ Quizzes
CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    title TEXT NOT NULL,
    class_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    chapter TEXT DEFAULT '',
    questions_json TEXT NOT NULL,
    is_published INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 6: Student Quiz Attempts (Single-Attempt Auto-Score Ledger)
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    score INTEGER NOT NULL,
    total INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(quiz_id, student_id),
    FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- PHASE 6: Lightweight Daily Homework Feed
CREATE TABLE IF NOT EXISTS homework (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    class_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    due_date TEXT,
    resource_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES profiles(id) ON DELETE CASCADE
);
