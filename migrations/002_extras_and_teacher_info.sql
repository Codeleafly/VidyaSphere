-- Migration 002: Teacher Extra Information, Chat Replies & Reactions, and Root Admin Identity Clean-up
-- Safe additive alterations for Cloudflare D1 / SQLite

ALTER TABLE profiles ADD COLUMN teacher_designation TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN teacher_info TEXT DEFAULT '';

ALTER TABLE messages ADD COLUMN reply_to_id TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN reply_preview TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN reactions_json TEXT DEFAULT '{}';

UPDATE profiles
SET class_name = '', division = '', roll_number = ''
WHERE id = 'admin-root-001' OR is_root_admin = 1 OR username = 'admin';
