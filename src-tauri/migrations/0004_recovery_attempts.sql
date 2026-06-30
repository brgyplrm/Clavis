-- Insert default lockout settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('failed_recovery_attempts', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('recovery_lockout_until', '0');
