-- Folders table
    CREATE TABLE IF NOT EXISTS folders (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    );

    -- Vault entries table
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY NOT NULL,
        folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        username TEXT,
        encrypted_password BLOB,
        password_nonce BLOB,
        url TEXT,
        notes BLOB,
        notes_nonce BLOB,
        totp_secret BLOB,
        totp_nonce BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Tags table
    CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL UNIQUE
    );

    -- Many-to-many junction table for entry-to-tag relationships
    CREATE TABLE IF NOT EXISTS entry_tags (
        entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (entry_id, tag_id)
    );