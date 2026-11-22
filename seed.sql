-- VIDYASPHERE INITIAL SEED DATA
-- Default Admin Root Profile & Inaugural Welcome Announcement

INSERT OR IGNORE INTO profiles (id, username, password_hash, salt, full_name, class_name, division, roll_number, email, role, account_status, is_root_admin)
VALUES (
    'admin-root-001',
    'admin',
    '7f618b9b659c43083b0fd1351f60725ec58df3ae592fe3c803fa1a6985134fb7',
    '0a141e28323c46505a646e78828c96a0',
    'Sriramik Sanjiv Sahu',
    '9th',
    'Shraddha',
    '01',
    'admin@vidyasphere.internal',
    'admin',
    'active',
    1
);

-- Default Platform Settings
INSERT OR IGNORE INTO school_settings (key, value)
VALUES ('academic_year', '2026-2027');

-- Inaugural Global Chat Announcement from Founder & Lead Admin
INSERT OR IGNORE INTO messages (id, sender_id, channel, content, created_at)
VALUES (
    'msg-welcome-001',
    'admin-root-001',
    'school',
    '👋 Hello everyone! Welcome to **VidyaSphere**!

I am **Sriramik Sanjiv Sahu** from **Class 9th Shraddha**, the founder and lead developer of this platform.

I built VidyaSphere to give our school a modern, distraction-free digital ecosystem for Class 1 to 12. Whether it is downloading verified academic notes, staying up-to-date with official exam timetables without confusion, asking questions in Academic Q&A, or collaborating in real time — VidyaSphere is crafted by students, for students.

Feel free to explore your dashboard, share notes, and participate actively. Let us learn, collaborate, and excel together! 🚀',
    CURRENT_TIMESTAMP
);
