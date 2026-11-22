-- VIDYASPHERE DATABASE CLEAN RESET SCRIPT
-- Completely wipes all test tables and records for a 100% fresh start

DROP TABLE IF EXISTS exams;
DROP TABLE IF EXISTS school_settings;
DROP TABLE IF EXISTS note_files;
DROP TABLE IF EXISTS note_reports;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS poll_votes;
DROP TABLE IF EXISTS polls;
DROP TABLE IF EXISTS answers;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS activation_codes;
DROP TABLE IF EXISTS registrations;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS profiles;
