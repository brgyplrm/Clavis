-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

-- Insert default configurations
INSERT OR IGNORE INTO settings (key, value) VALUES ('idle_timeout', '300');
INSERT OR IGNORE INTO settings (key, value) VALUES ('lock_on_focus_lost', 'false');

-- Insert security configurations default placeholders
INSERT OR IGNORE INTO settings (key, value) VALUES ('password_hint', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_q1_hash', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_q2_hash', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_q1_text', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('security_q2_text', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('emergency_key_ciphertext', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('emergency_key_nonce', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('eula_accepted', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tour_completed', 'false');
