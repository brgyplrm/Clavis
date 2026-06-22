    -- Create settings table
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
    );

    -- Insert default configurations
    INSERT OR IGNORE INTO settings (key, value) VALUES ('idle_timeout', '300');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('lock_on_focus_lost', 'false');