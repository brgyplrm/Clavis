-- Insert default configurations for Backup, Theme, Autotype, and Auto-Lock
INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'System');
INSERT OR IGNORE INTO settings (key, value) VALUES ('autostart', 'false');
INSERT OR IGNORE INTO settings (key, value) VALUES ('clipboard_timeout', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('autotype_delay', '50');
INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_interval', 'Weekly');
INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_directory', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_retention', '5');
