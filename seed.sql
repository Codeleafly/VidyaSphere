-- VIDYASPHERE INITIAL SEED DATA
-- Default Admin Root Profile Only (Zero mock/dummy data for clean production-like state)

INSERT OR IGNORE INTO profiles (id, username, password_hash, salt, full_name, class_name, division, roll_number, role, account_status)
VALUES (
    'admin-root-001',
    'admin',
    '7f618b9b659c43083b0fd1351f60725ec58df3ae592fe3c803fa1a6985134fb7',
    '0a141e28323c46505a646e78828c96a0',
    'Platform Creator & Lead Admin',
    'HQ',
    'A',
    '01',
    'admin',
    'active'
);
