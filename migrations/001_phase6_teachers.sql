-- Phase 6 Migration: Teachers Ecosystem & Scoped Teaching Tools
-- Safe additive alterations for existing Cloudflare D1 / SQLite databases

ALTER TABLE profiles ADD COLUMN teacher_type TEXT DEFAULT NULL CHECK(teacher_type IN ('subject', 'class'));
ALTER TABLE profiles ADD COLUMN assigned_classes TEXT DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN assigned_subjects TEXT DEFAULT '[]';
ALTER TABLE profiles ADD COLUMN allow_student_dms INTEGER DEFAULT 1;

ALTER TABLE notes ADD COLUMN is_teacher_verified INTEGER DEFAULT 0;

ALTER TABLE answers ADD COLUMN is_faculty_endorsed INTEGER DEFAULT 0;
ALTER TABLE answers ADD COLUMN endorsed_by TEXT;

ALTER TABLE messages ADD COLUMN is_pinned INTEGER DEFAULT 0;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;

ALTER TABLE exams ADD COLUMN exam_type TEXT NOT NULL DEFAULT 'board' CHECK(exam_type IN ('board', 'unit_test'));

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
