    -- Create vaults table
    CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Create entries table
    CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY NOT NULL,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        username TEXT,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        totp_secret BLOB,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    -- Index for optimization on vault entries
    CREATE INDEX IF NOT EXISTS idx_entries_vault_id ON entries(vault_id);