
use sqlx::SqlitePool;
use std::sync::Mutex;
use tauri::{AppHandle, State};
use zeroize::Zeroizing;

use crate::crypto::kdf::derive_key;
use crate::error::{Error, Result};
use crate::vault::db::{connect_to_db, get_db_paths, get_or_create_salt};
use crate::vault::models::{DecryptedEntry, EntrySummary, Vault};

/// State managed by Tauri to store database connection pool and derived key.
pub struct AppState {
    /// Active SQLite connection pool (SQLCipher enabled).
    pub db: Mutex<Option<SqlitePool>>,
    /// Derived KDF session key stored securely.
    pub session_key: Mutex<Option<Zeroizing<[u8; 32]>>>,
    /// Global counter representing the current clipboard write sequence to handle concurrent auto-clears.
    pub clipboard_epoch: Mutex<u64>,
    /// WebSocket session token.
    pub ws_token: Mutex<String>,
}

/// Helper function to retrieve the database pool from AppState.
fn get_pool(state: &State<'_, AppState>) -> Result<SqlitePool> {
    state.db.lock().unwrap().clone().ok_or(Error::VaultLocked)
}

/// Initializes the secure database and generates the KDF salt on first-time setup.
#[tauri::command]
pub async fn create_vault(
    password: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Wrap the password to guarantee zeroization on drop/return
    let password_wrap = zeroize::Zeroizing::new(password);

    // Prevent initialization if already unlocked
    if state.db.lock().unwrap().is_some() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    let (db_path, salt_path) = get_db_paths(&app_handle)?;
    if salt_path.exists() || db_path.exists() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    // Generate salt & KDF key
    let salt = get_or_create_salt(&salt_path)?;
    let derived_key = derive_key(&*password_wrap, &salt)?;

    // Create encrypted database file and run migrations
    let pool = connect_to_db(&db_path, &*derived_key).await?;

    // Create a default vault partition for the user
    let default_vault_id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    sqlx::query(
        "INSERT INTO vaults (id, name, created_at, updated_at) VALUES (?, 'Primary Vault', ?, ?)",
    )
    .bind(&default_vault_id)
    .bind(now)
    .bind(now)
    .execute(&pool)
    .await?;

    // Store pool and key in state
    *state.db.lock().unwrap() = Some(pool);
    *state.session_key.lock().unwrap() = Some(derived_key);

    // Generate and set secure WebSocket token on initialization/unlock
    {
        let mut ws_token_guard = state.ws_token.lock().unwrap();
        let mut token_bytes = [0u8; 32];
        use ring::rand::SecureRandom;
        ring::rand::SystemRandom::new()
            .fill(&mut token_bytes)
            .expect("Failed to generate secure random token");
        *ws_token_guard = hex::encode(token_bytes);
    }

    Ok(())
}

/// Unlocks the existing database using the master password.
#[tauri::command]
pub async fn unlock(
    password: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Wrap the password to guarantee zeroization on drop/return
    let password_wrap = zeroize::Zeroizing::new(password);

    if state.db.lock().unwrap().is_some() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    let (db_path, salt_path) = get_db_paths(&app_handle)?;
    if !salt_path.exists() {
        return Err(Error::InvalidPassword);
    }

    // Load salt and derive key
    let salt = get_or_create_salt(&salt_path)?;
    let derived_key = derive_key(&*password_wrap, &salt)?;

    // Connect to database
    let pool = match connect_to_db(&db_path, &*derived_key).await {
        Ok(pool) => pool,
        Err(e) => {
            println!("DEBUG: Connection error during unlock: {:?}", e);
            let err_msg = e.to_string().to_lowercase();
            // Generic authentication error returned to frontend
            if err_msg.contains("file is not a database")
                || err_msg.contains("file is encrypted")
                || err_msg.contains("not a database")
            {
                return Err(Error::InvalidPassword);
            }
            return Err(e);
        }
    };

    // Store pool and key
    *state.db.lock().unwrap() = Some(pool);
    *state.session_key.lock().unwrap() = Some(derived_key);

    // Generate and set secure WebSocket token on unlock
    {
        let mut ws_token_guard = state.ws_token.lock().unwrap();
        let mut token_bytes = [0u8; 32];
        use ring::rand::SecureRandom;
        ring::rand::SystemRandom::new()
            .fill(&mut token_bytes)
            .expect("Failed to generate secure random token");
        *ws_token_guard = hex::encode(token_bytes);
    }

    Ok(())
}

/// Locks the vault, wiping the derived key and closing database connections.
#[tauri::command]
pub fn lock(state: State<'_, AppState>) -> Result<()> {
    // Zero out memory and close connections
    *state.db.lock().unwrap() = None;
    *state.session_key.lock().unwrap() = None;

    // Clear WebSocket token on lock
    state.ws_token.lock().unwrap().clear();

    Ok(())
}

/// Checks whether the vault is locked.
#[tauri::command]
pub fn is_vault_locked(state: State<'_, AppState>) -> Result<bool> {
    Ok(state.db.lock().unwrap().is_none())
}

/// Checks if the vault has been initialized (i.e., if the salt file exists).
#[tauri::command]
pub fn is_vault_initialized(app_handle: AppHandle) -> Result<bool> {
    let (_, salt_path) = get_db_paths(&app_handle)?;
    Ok(salt_path.exists())
}

/// Creates a new vault partition in the database.
#[tauri::command]
pub async fn create_vault_partition(name: String, state: State<'_, AppState>) -> Result<Vault> {
    let pool = get_pool(&state)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    sqlx::query("INSERT INTO vaults (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
        .bind(&id)
        .bind(&name)
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await?;

    Ok(Vault {
        id,
        name,
        created_at: now,
        updated_at: now,
    })
}

/// Lists all vaults in the database.
#[tauri::command]
pub async fn list_vaults(state: State<'_, AppState>) -> Result<Vec<Vault>> {
    let pool = get_pool(&state)?;
    let vaults = sqlx::query_as::<_, Vault>(
        "SELECT id, name, created_at, updated_at FROM vaults ORDER BY name ASC",
    )
    .fetch_all(&pool)
    .await?;
    Ok(vaults)
}

/// Deletes a vault by its ID.
#[tauri::command]
pub async fn delete_vault(id: String, state: State<'_, AppState>) -> Result<()> {
    let pool = get_pool(&state)?;
    sqlx::query("DELETE FROM vaults WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    Ok(())
}

/// Creates a new secure entry in a vault.
#[tauri::command]
pub async fn create_entry(
    vault_id: String,
    title: String,
    username: Option<String>,
    password_plaintext: String,
    totp_secret_plaintext: Option<String>,
    state: State<'_, AppState>,
) -> Result<EntrySummary> {
    let pool = get_pool(&state)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Lock, encrypt password and totp, and drop lock immediately in this scoped block
    let (ciphertext, nonce, totp_secret) = {
        let guard = state.session_key.lock().unwrap();
        let session_key = guard.as_ref().ok_or(Error::VaultLocked)?;

        // Encrypt password using AES-256-GCM
        let (ciphertext, nonce) =
            crate::crypto::cipher::encrypt(&**session_key, password_plaintext.as_bytes())?;

        // Encrypt totp_secret if present, prepending the 12-byte nonce
        let totp_secret = if let Some(totp) = totp_secret_plaintext {
            let (totp_cipher, totp_nonce) =
                crate::crypto::cipher::encrypt(&**session_key, totp.as_bytes())?;
            let mut combined = totp_nonce;
            combined.extend(totp_cipher);
            Some(combined)
        } else {
            None
        };

        (ciphertext, nonce, totp_secret)
    };

    sqlx::query(
            "INSERT INTO entries (id, vault_id, title, username, ciphertext, nonce, totp_secret, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&vault_id)
        .bind(&title)
        .bind(&username)
        .bind(&ciphertext)
        .bind(&nonce)
        .bind(&totp_secret)
        .bind(now)
        .bind(now)
        .execute(&pool)
        .await?;

    Ok(EntrySummary {
        id,
        vault_id,
        title,
        username,
        has_totp: totp_secret.is_some(),
        created_at: now,
        updated_at: now,
    })
}

/// Lists all entry summaries in a vault without decrypting credentials.
#[tauri::command]
pub async fn list_entries(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<EntrySummary>> {
    let pool = get_pool(&state)?;

    let rows = sqlx::query(
            "SELECT id, vault_id, title, username, totp_secret, created_at, updated_at FROM entries WHERE vault_id = ? ORDER BY
  title ASC"
        )
        .bind(vault_id)
        .fetch_all(&pool)
        .await?;

    let mut summaries = Vec::new();
    for row in rows {
        use sqlx::Row;
        let id: String = row.try_get("id")?;
        let vault_id: String = row.try_get("vault_id")?;
        let title: String = row.try_get("title")?;
        let username: Option<String> = row.try_get("username")?;
        let totp_secret: Option<Vec<u8>> = row.try_get("totp_secret")?;
        let created_at: i64 = row.try_get("created_at")?;
        let updated_at: i64 = row.try_get("updated_at")?;

        summaries.push(EntrySummary {
            id,
            vault_id,
            title,
            username,
            has_totp: totp_secret.is_some(),
            created_at,
            updated_at,
        });
    }

    Ok(summaries)
}

/// Retrieves a decrypted entry details.
#[tauri::command]
pub async fn get_entry(id: String, state: State<'_, AppState>) -> Result<DecryptedEntry> {
    let pool = get_pool(&state)?;

    let row = sqlx::query(
            "SELECT id, vault_id, title, username, ciphertext, nonce, totp_secret, created_at, updated_at FROM entries WHERE id
  = ?"
        )
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| Error::Database(sqlx::Error::RowNotFound))?;

    use sqlx::Row;
    let id: String = row.try_get("id")?;
    let vault_id: String = row.try_get("vault_id")?;
    let title: String = row.try_get("title")?;
    let username: Option<String> = row.try_get("username")?;
    let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
    let nonce: Vec<u8> = row.try_get("nonce")?;
    let totp_blob: Option<Vec<u8>> = row.try_get("totp_secret")?;
    let created_at: i64 = row.try_get("created_at")?;
    let updated_at: i64 = row.try_get("updated_at")?;

    // Perform decryption inside a localized scope to drop the MutexGuard immediately
    let (password, totp_secret) = {
        let guard = state.session_key.lock().unwrap();
        let session_key = guard.as_ref().ok_or(Error::VaultLocked)?;

        // Decrypt password using &[u8; 32] key reference
        let password_bytes = crate::crypto::cipher::decrypt(&**session_key, &ciphertext, &nonce)?;
        let password = String::from_utf8(password_bytes)
            .map_err(|e| Error::Crypto(format!("Invalid UTF-8 in password: {}", e)))?;

        // Decrypt totp if present
        let totp_secret = if let Some(blob) = totp_blob {
            if blob.len() < 12 {
                return Err(Error::Crypto("Invalid TOTP blob length".to_string()));
            }
            let (totp_nonce, totp_cipher) = blob.split_at(12);
            let decrypted_totp =
                crate::crypto::cipher::decrypt(&**session_key, totp_cipher, totp_nonce)?;
            Some(
                String::from_utf8(decrypted_totp)
                    .map_err(|e| Error::Crypto(format!("Invalid UTF-8 in TOTP secret: {}", e)))?,
            )
        } else {
            None
        };

        (password, totp_secret)
    };

    Ok(DecryptedEntry {
        id,
        vault_id,
        title,
        username,
        password,
        totp_secret,
        created_at,
        updated_at,
    })
}

/// Updates an existing secure entry details.
#[tauri::command]
pub async fn update_entry(
    id: String,
    title: String,
    username: Option<String>,
    password_plaintext: String,
    totp_secret_plaintext: Option<String>,
    state: State<'_, AppState>,
) -> Result<()> {
    let pool = get_pool(&state)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Lock, encrypt, and drop lock immediately in this block before database .await
    let (ciphertext, nonce, totp_secret) = {
        let guard = state.session_key.lock().unwrap();
        let session_key = guard.as_ref().ok_or(Error::VaultLocked)?;

        // Encrypt password
        let (ciphertext, nonce) =
            crate::crypto::cipher::encrypt(&**session_key, password_plaintext.as_bytes())?;

        // Encrypt totp_secret if present, prepending the 12-byte nonce
        let totp_secret = if let Some(totp) = totp_secret_plaintext {
            let (totp_cipher, totp_nonce) =
                crate::crypto::cipher::encrypt(&**session_key, totp.as_bytes())?;
            let mut combined = totp_nonce;
            combined.extend(totp_cipher);
            Some(combined)
        } else {
            None
        };

        (ciphertext, nonce, totp_secret)
    };

    sqlx::query(
            "UPDATE entries SET title = ?, username = ?, ciphertext = ?, nonce = ?, totp_secret = ?, updated_at = ? WHERE id =
  ?"
        )
        .bind(title)
        .bind(username)
        .bind(ciphertext)
        .bind(nonce)
        .bind(totp_secret)
        .bind(now)
        .bind(id)
        .execute(&pool)
        .await?;

    Ok(())
}

/// Deletes a secure entry by its ID.
#[tauri::command]
pub async fn delete_entry(id: String, state: State<'_, AppState>) -> Result<()> {
    let pool = get_pool(&state)?;
    sqlx::query("DELETE FROM entries WHERE id = ?")
        .bind(id)
        .execute(&pool)
        .await?;
    Ok(())
}

/// Retrieves a setting value by its key.
#[tauri::command]
pub async fn get_setting(key: String, state: State<'_, AppState>) -> Result<String> {
    let pool = get_pool(&state)?;
    let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(&pool)
        .await?;

    if let Some(r) = row {
        use sqlx::Row;
        let val: String = r.try_get("value")?;
        Ok(val)
    } else {
        Err(Error::Database(sqlx::Error::RowNotFound))
    }
}

/// Updates or inserts a setting value.
#[tauri::command]
pub async fn set_setting(key: String, value: String, state: State<'_, AppState>) -> Result<()> {
    let pool = get_pool(&state)?;
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(&pool)
        .await?;
    Ok(())
}
