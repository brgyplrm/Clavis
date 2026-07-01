use sqlx::SqlitePool;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::crypto::kdf::derive_key;
use crate::error::{Error, MutexExt, Result};

#[cfg(unix)]
extern "C" {
    fn mlock(addr: *const std::ffi::c_void, len: usize) -> std::ffi::c_int;
    fn munlock(addr: *const std::ffi::c_void, len: usize) -> std::ffi::c_int;
}

#[cfg(target_os = "windows")]
extern "system" {
    fn VirtualLock(lpAddress: *mut std::ffi::c_void, dwSize: usize) -> std::ffi::c_int;
    fn VirtualUnlock(lpAddress: *mut std::ffi::c_void, dwSize: usize) -> std::ffi::c_int;
}
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

fn generate_secure_token() -> Result<String> {
    let mut token_bytes = [0u8; 32];
    use ring::rand::SecureRandom;
    if ring::rand::SystemRandom::new()
        .fill(&mut token_bytes)
        .is_err()
    {
        return Err(Error::Crypto(
            "Failed to generate secure random token due to entropy failure".to_string(),
        ));
    }
    Ok(hex::encode(token_bytes))
}

pub fn get_pool(state: &State<'_, AppState>) -> Result<SqlitePool> {
    state.db.lock_safe().clone().ok_or(Error::VaultLocked)
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
    if state.db.lock_safe().is_some() {
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

    // Record EULA acceptance and timestamp in the settings table
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('eula_accepted', 'true')")
        .execute(&pool)
        .await?;

    let now_str = now.to_string();
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('eula_accepted_at', ?)")
        .bind(&now_str)
        .execute(&pool)
        .await?;

    // Store pool and key in state
    *state.db.lock_safe() = Some(pool);
    {
        let mut key_guard = state.session_key.lock_safe();
        *key_guard = Some(derived_key);
        if let Some(ref key) = *key_guard {
            let ptr = key.as_ptr() as *const std::ffi::c_void;
            unsafe {
                #[cfg(unix)]
                let _ = mlock(ptr, 32);
                #[cfg(target_os = "windows")]
                let _ = VirtualLock(ptr as *mut std::ffi::c_void, 32);
            }
        }
    }

    // Generate and set secure WebSocket token on initialization/unlock
    {
        let mut ws_token_guard = state.ws_token.lock_safe();
        *ws_token_guard = generate_secure_token()?;
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

    if state.db.lock_safe().is_some() {
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
    *state.db.lock_safe() = Some(pool);
    {
        let mut key_guard = state.session_key.lock_safe();
        *key_guard = Some(derived_key);
        if let Some(ref key) = *key_guard {
            let ptr = key.as_ptr() as *const std::ffi::c_void;
            unsafe {
                #[cfg(unix)]
                let _ = mlock(ptr, 32);
                #[cfg(target_os = "windows")]
                let _ = VirtualLock(ptr as *mut std::ffi::c_void, 32);
            }
        }
    }

    // Generate and set secure WebSocket token on unlock
    {
        let mut ws_token_guard = state.ws_token.lock_safe();
        *ws_token_guard = generate_secure_token()?;
    }

    Ok(())
}

/// Locks the vault, wiping the derived key and closing database connections.
#[tauri::command]
pub fn lock(state: State<'_, AppState>) -> Result<()> {
    // Zero out memory and close connections
    *state.db.lock_safe() = None;
    {
        let mut key_guard = state.session_key.lock_safe();
        if let Some(ref key) = *key_guard {
            let ptr = key.as_ptr() as *const std::ffi::c_void;
            unsafe {
                #[cfg(unix)]
                let _ = munlock(ptr, 32);
                #[cfg(target_os = "windows")]
                let _ = VirtualUnlock(ptr as *mut std::ffi::c_void, 32);
            }
        }
        *key_guard = None;
    }

    // Clear WebSocket token on lock
    state.ws_token.lock_safe().clear();

    Ok(())
}

/// Checks whether the vault is locked.
#[tauri::command]
pub fn is_vault_locked(state: State<'_, AppState>) -> Result<bool> {
    Ok(state.db.lock_safe().is_none())
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
        let guard = state.session_key.lock_safe();
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
        let guard = state.session_key.lock_safe();
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
        let guard = state.session_key.lock_safe();
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

/// Adds a domain to the extension blocklist setting.
#[tauri::command]
pub async fn add_to_blocklist(domain: String, state: State<'_, AppState>) -> Result<()> {
    let pool = get_pool(&state)?;
    let clean_domain = domain.trim().to_lowercase();
    if clean_domain.is_empty() {
        return Ok(());
    }

    // Try reading current list
    let current_val = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'extension_blocklist'",
    )
    .fetch_optional(&pool)
    .await?;

    let mut list: Vec<String> = if let Some(val) = current_val {
        serde_json::from_str(&val).unwrap_or_default()
    } else {
        Vec::new()
    };

    if !list.contains(&clean_domain) {
        list.push(clean_domain);
        let new_val = serde_json::to_string(&list).unwrap_or_default();
        sqlx::query(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('extension_blocklist', ?)",
        )
        .bind(new_val)
        .execute(&pool)
        .await?;
    }

    Ok(())
}

/// Removes a domain from the extension blocklist setting.
#[tauri::command]
pub async fn remove_from_blocklist(domain: String, state: State<'_, AppState>) -> Result<()> {
    let pool = get_pool(&state)?;
    let clean_domain = domain.trim().to_lowercase();

    let current_val = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'extension_blocklist'",
    )
    .fetch_optional(&pool)
    .await?;

    if let Some(val) = current_val {
        let mut list: Vec<String> = serde_json::from_str(&val).unwrap_or_default();
        let original_len = list.len();
        list.retain(|d| d != &clean_domain);

        if list.len() != original_len {
            let new_val = serde_json::to_string(&list).unwrap_or_default();
            sqlx::query(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('extension_blocklist', ?)",
            )
            .bind(new_val)
            .execute(&pool)
            .await?;
        }
    }

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct RecoveryConfig {
    pub password_hint: Option<String>,
    pub question1_id: i32,
    pub question2_id: i32,
    pub encrypted_key: String,
    pub nonce: String,
    #[serde(default)]
    pub failed_attempts: i32,
    #[serde(default)]
    pub lockout_until: Option<u64>,
}

#[tauri::command]
pub async fn create_vault_with_security(
    password: String,
    hint: Option<String>,
    question1_id: i32,
    mut answer1: String,
    question2_id: i32,
    mut answer2: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let password_wrap = zeroize::Zeroizing::new(password);

    if state.db.lock_safe().is_some() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    let (db_path, salt_path) = get_db_paths(&app_handle)?;
    if salt_path.exists() || db_path.exists() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    let salt = get_or_create_salt(&salt_path)?;
    let derived_key = derive_key(&*password_wrap, &salt)?;
    let pool = connect_to_db(&db_path, &*derived_key).await?;

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

    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('eula_accepted', 'true')")
        .execute(&pool)
        .await?;

    let now_str = now.to_string();
    sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('eula_accepted_at', ?)")
        .bind(&now_str)
        .execute(&pool)
        .await?;

    if let Some(ref h) = hint {
        sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('password_hint', ?)")
            .bind(h)
            .execute(&pool)
            .await?;
    }

    let mut combined_answers = format!(
        "{}:{}",
        answer1.trim().to_lowercase(),
        answer2.trim().to_lowercase()
    );
    let recovery_kdf_key = derive_key(&combined_answers, &salt)?;
    use zeroize::Zeroize;
    combined_answers.zeroize();
    let (encrypted_key, nonce) = crate::crypto::cipher::encrypt(&*recovery_kdf_key, &*derived_key)?;

    let recovery_config = RecoveryConfig {
        password_hint: hint.clone(),
        question1_id,
        question2_id,
        encrypted_key: hex::encode(encrypted_key),
        nonce: hex::encode(nonce),
        failed_attempts: 0,
        lockout_until: None,
    };

    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let recovery_path = app_dir.join("recovery.json");
    let recovery_json = serde_json::to_string_pretty(&recovery_config)
        .map_err(|e| Error::Crypto(format!("Failed to serialize recovery config: {}", e)))?;
    std::fs::write(recovery_path, recovery_json)?;

    // Transition window to decorated main view
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 800.0,
            height: 600.0,
        }));
        let _ = window.center();
    }

    *state.db.lock_safe() = Some(pool);
    {
        let mut key_guard = state.session_key.lock_safe();
        *key_guard = Some(derived_key);
        if let Some(ref key) = *key_guard {
            let ptr = key.as_ptr() as *const std::ffi::c_void;
            unsafe {
                #[cfg(unix)]
                let _ = mlock(ptr, 32);
                #[cfg(target_os = "windows")]
                let _ = VirtualLock(ptr as *mut std::ffi::c_void, 32);
            }
        }
    }

    {
        let mut ws_token_guard = state.ws_token.lock_safe();
        *ws_token_guard = generate_secure_token()?;
    }

    answer1.zeroize();
    answer2.zeroize();
    Ok(())
}

#[tauri::command]
pub fn get_password_hint(app_handle: AppHandle) -> Result<Option<String>> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let recovery_path = app_dir.join("recovery.json");
    if !recovery_path.exists() {
        return Ok(None);
    }
    let data = std::fs::read_to_string(recovery_path)?;
    let config: RecoveryConfig = serde_json::from_str(&data)
        .map_err(|e| Error::Crypto(format!("Failed to parse recovery file: {}", e)))?;
    Ok(config.password_hint)
}

#[tauri::command]
pub fn get_recovery_questions(app_handle: AppHandle) -> Result<Vec<i32>> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let recovery_path = app_dir.join("recovery.json");
    if !recovery_path.exists() {
        return Err(Error::Crypto(
            "Recovery configuration not found".to_string(),
        ));
    }
    let data = std::fs::read_to_string(recovery_path)?;
    let config: RecoveryConfig = serde_json::from_str(&data)
        .map_err(|e| Error::Crypto(format!("Failed to parse recovery file: {}", e)))?;
    Ok(vec![config.question1_id, config.question2_id])
}

#[tauri::command]
pub async fn recover_vault(
    mut answer1: String,
    mut answer2: String,
    new_password: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    let new_password_wrap = zeroize::Zeroizing::new(new_password);

    if state.db.lock_safe().is_some() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    let (db_path, salt_path) = get_db_paths(&app_handle)?;
    if !salt_path.exists() || !db_path.exists() {
        return Err(Error::Crypto("Vault database not initialized".to_string()));
    }

    let salt = get_or_create_salt(&salt_path)?;

    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let recovery_path = app_dir.join("recovery.json");
    if !recovery_path.exists() {
        return Err(Error::Crypto("Recovery config not found".to_string()));
    }
    let recovery_data = std::fs::read_to_string(&recovery_path)?;
    let mut config: RecoveryConfig = serde_json::from_str(&recovery_data)
        .map_err(|e| Error::Crypto(format!("Failed to parse recovery file: {}", e)))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Some(until) = config.lockout_until {
        if now < until {
            let diff = until - now;
            return Err(Error::Crypto(format!(
                "Locked out. Try again in {} seconds",
                diff
            )));
        }
    }

    let mut combined_answers = format!(
        "{}:{}",
        answer1.trim().to_lowercase(),
        answer2.trim().to_lowercase()
    );
    let recovery_kdf_key = derive_key(&combined_answers, &salt)?;
    use zeroize::Zeroize;
    combined_answers.zeroize();

    let encrypted_key_bytes = hex::decode(&config.encrypted_key)
        .map_err(|_| Error::Crypto("Invalid encrypted key hex".to_string()))?;
    let nonce_bytes =
        hex::decode(&config.nonce).map_err(|_| Error::Crypto("Invalid nonce hex".to_string()))?;

    let db_key_bytes =
        crate::crypto::cipher::decrypt(&*recovery_kdf_key, &encrypted_key_bytes, &nonce_bytes)
            .map_err(|_| Error::InvalidPassword)?;

    let mut db_key = [0u8; 32];
    db_key.copy_from_slice(&db_key_bytes[..32]);
    let db_key_wrap = zeroize::Zeroizing::new(db_key);

    let pool = connect_to_db(&db_path, &*db_key_wrap).await?;
    let new_derived_key = derive_key(&*new_password_wrap, &salt)?;

    let mut new_hex_key = hex::encode(&*new_derived_key);
    let mut rekey_pragma = format!("PRAGMA rekey = \"x'{}'\"", new_hex_key);
    sqlx::query(&rekey_pragma).execute(&pool).await?;
    new_hex_key.zeroize();
    rekey_pragma.zeroize();

    // Auto-mark tour_completed as true during recovery to prevent setup guide from launching
    let _ = sqlx::query(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('tour_completed', 'true')",
    )
    .execute(&pool)
    .await;

    let (new_encrypted_key, new_nonce) =
        crate::crypto::cipher::encrypt(&*recovery_kdf_key, &*new_derived_key)?;

    config.encrypted_key = hex::encode(new_encrypted_key);
    config.nonce = hex::encode(new_nonce);
    config.failed_attempts = 0;
    config.lockout_until = None;
    let recovery_json = serde_json::to_string_pretty(&config)
        .map_err(|e| Error::Crypto(format!("Failed to serialize recovery config: {}", e)))?;
    std::fs::write(recovery_path, recovery_json)?;

    // Transition window to decorated main view
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 800.0,
            height: 600.0,
        }));
        let _ = window.center();
    }

    *state.db.lock_safe() = Some(pool);
    {
        let mut key_guard = state.session_key.lock_safe();
        *key_guard = Some(new_derived_key);
        if let Some(ref key) = *key_guard {
            let ptr = key.as_ptr() as *const std::ffi::c_void;
            unsafe {
                #[cfg(unix)]
                let _ = mlock(ptr, 32);
                #[cfg(target_os = "windows")]
                let _ = VirtualLock(ptr as *mut std::ffi::c_void, 32);
            }
        }
    }

    {
        let mut ws_token_guard = state.ws_token.lock_safe();
        *ws_token_guard = generate_secure_token()?;
    }

    answer1.zeroize();
    answer2.zeroize();
    Ok(())
}

#[derive(serde::Serialize)]
pub struct StrengthEstimate {
    pub score: i32,
    pub entropy: f64,
    pub feedback: Vec<String>,
}

#[tauri::command]
pub fn estimate_password_strength(password: String) -> Result<StrengthEstimate> {
    if password.is_empty() {
        return Ok(StrengthEstimate {
            score: 0,
            entropy: 0.0,
            feedback: vec![],
        });
    }

    let mut pool_size: f64 = 0.0;
    let mut has_lower = false;
    let mut has_upper = false;
    let mut has_digit = false;
    let mut has_symbol = false;

    for c in password.chars() {
        if c.is_lowercase() {
            has_lower = true;
        } else if c.is_uppercase() {
            has_upper = true;
        } else if c.is_ascii_digit() {
            has_digit = true;
        } else {
            has_symbol = true;
        }
    }

    if has_lower {
        pool_size += 26.0;
    }
    if has_upper {
        pool_size += 26.0;
    }
    if has_digit {
        pool_size += 10.0;
    }
    if has_symbol {
        pool_size += 32.0;
    }

    let entropy = if pool_size > 0.0 {
        password.len() as f64 * pool_size.log2()
    } else {
        0.0
    };

    let mut feedback = Vec::new();

    if password.len() < 12 {
        feedback.push("Make the password at least 12 characters long".to_string());
    }
    if !has_upper {
        feedback.push("Add an uppercase letter".to_string());
    }
    if !has_lower {
        feedback.push("Add a lowercase letter".to_string());
    }
    if !has_digit {
        feedback.push("Add a number".to_string());
    }
    if !has_symbol {
        feedback.push("Add a special character (symbol)".to_string());
    }

    let pwd_lower = password.to_lowercase();
    let common_words = vec![
        "password",
        "123456",
        "admin",
        "clavis",
        "qwerty",
        "welcome",
        "letmein",
        "12345678",
        "123456789",
        "monkey",
        "charlie",
    ];
    for word in common_words {
        if pwd_lower.contains(word) {
            feedback.push(format!("Contains common dictionary word: '{}'", word));
        }
    }

    let mut score = 0;
    if entropy >= 100.0 {
        score = 4;
    } else if entropy >= 80.0 {
        score = 3;
    } else if entropy >= 60.0 {
        score = 2;
    } else if entropy >= 40.0 {
        score = 1;
    }

    if password.len() < 8 || pwd_lower.contains("password") || pwd_lower.contains("123456") {
        score = 0;
    }

    Ok(StrengthEstimate {
        score,
        entropy,
        feedback,
    })
}

#[tauri::command]
pub fn verify_recovery_answers(
    mut answer1: String,
    mut answer2: String,
    app_handle: AppHandle,
) -> Result<bool> {
    let (db_path, salt_path) = get_db_paths(&app_handle)?;
    if !salt_path.exists() || !db_path.exists() {
        return Err(Error::Crypto("Vault database not initialized".to_string()));
    }

    let salt = get_or_create_salt(&salt_path)?;

    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let recovery_path = app_dir.join("recovery.json");
    if !recovery_path.exists() {
        return Err(Error::Crypto("Recovery config not found".to_string()));
    }
    let recovery_data = std::fs::read_to_string(&recovery_path)?;
    let mut config: RecoveryConfig = serde_json::from_str(&recovery_data)
        .map_err(|e| Error::Crypto(format!("Failed to parse recovery file: {}", e)))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if let Some(until) = config.lockout_until {
        if now < until {
            let diff = until - now;
            return Err(Error::Crypto(format!(
                "Locked out. Try again in {} seconds",
                diff
            )));
        }
    }

    let combined_answers = format!(
        "{}:{}",
        answer1.trim().to_lowercase(),
        answer2.trim().to_lowercase()
    );
    let recovery_kdf_key = derive_key(&combined_answers, &salt)?;

    use zeroize::Zeroize;
    let mut combined_answers = combined_answers;
    combined_answers.zeroize();
    answer1.zeroize();
    answer2.zeroize();

    let encrypted_key_bytes = hex::decode(&config.encrypted_key)
        .map_err(|_| Error::Crypto("Invalid encrypted key hex".to_string()))?;
    let nonce_bytes =
        hex::decode(&config.nonce).map_err(|_| Error::Crypto("Invalid nonce hex".to_string()))?;

    let db_key_bytes =
        crate::crypto::cipher::decrypt(&*recovery_kdf_key, &encrypted_key_bytes, &nonce_bytes);

    let is_ok = db_key_bytes.is_ok();
    if is_ok {
        config.failed_attempts = 0;
        config.lockout_until = None;
    } else {
        config.failed_attempts += 1;
        if config.failed_attempts >= 3 {
            config.lockout_until = Some(now + 300); // 5 minutes lockout
        }
    }

    let recovery_json = serde_json::to_string_pretty(&config)
        .map_err(|e| Error::Crypto(format!("Failed to serialize recovery config: {}", e)))?;
    std::fs::write(&recovery_path, recovery_json)?;

    if !is_ok && config.failed_attempts >= 3 {
        return Err(Error::Crypto(
            "Too many failed attempts. Recovery locked for 5 minutes.".to_string(),
        ));
    }

    Ok(is_ok)
}

#[derive(serde::Serialize)]
pub struct ExportEntry {
    pub title: String,
    pub username: Option<String>,
    pub password_plaintext: String,
    pub totp_secret_plaintext: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(serde::Serialize)]
pub struct ExportMatrix {
    pub vaults_count: usize,
    pub entries: Vec<ExportEntry>,
}

#[tauri::command]
pub async fn export_vault_encrypted(
    passphrase: String,
    save_path: String,
    state: State<'_, AppState>
) -> Result<()> {
    use zeroize::Zeroize;
    use ring::rand::SecureRandom;
    let pool = get_pool(&state)?;

    let session_key = {
        let guard = state.session_key.lock_safe();
        match guard.as_ref() {
            Some(key) => key.clone(),
            None => return Err(Error::Database(sqlx::Error::RowNotFound)),
        }
    };

    let rows = sqlx::query("SELECT title, username, ciphertext, nonce, totp_secret, created_at, updated_at FROM entries")
        .fetch_all(&pool)
        .await?;

    let mut export_entries = Vec::new();
    for r in rows {
        use sqlx::Row;
        let title: String = r.get("title");
        let username: Option<String> = r.get("username");
        let ciphertext: Vec<u8> = r.get("ciphertext");
        let nonce: Vec<u8> = r.get("nonce");
        let totp_blob: Option<Vec<u8>> = r.get("totp_secret");
        let created_at: i64 = r.get("created_at");
        let updated_at: i64 = r.get("updated_at");

        let decrypted_pw = match crate::crypto::cipher::decrypt(&*session_key, &ciphertext, &nonce) {
            Ok(bytes) => String::from_utf8(bytes).unwrap_or_default(),
            Err(_) => continue,
        };

        let decrypted_totp = if let Some(blob) = totp_blob {
            if blob.len() >= 12 {
                let (totp_nonce, totp_cipher) = blob.split_at(12);
                match crate::crypto::cipher::decrypt(&*session_key, totp_cipher, totp_nonce) {
                    Ok(bytes) => Some(String::from_utf8(bytes).unwrap_or_default()),
                    Err(_) => None,
                }
            } else {
                None
            }
        } else {
            None
        };

        export_entries.push(ExportEntry {
            title,
            username,
            password_plaintext: decrypted_pw,
            totp_secret_plaintext: decrypted_totp,
            created_at,
            updated_at,
        });
    }

    let mut matrix = ExportMatrix {
        vaults_count: 1,
        entries: export_entries,
    };

    let mut plaintext_json = serde_json::to_string(&matrix).unwrap_or_default();

    let mut salt = [0u8; 16];
    ring::rand::SystemRandom::new().fill(&mut salt).map_err(|_| Error::Crypto("Failed to generate salt".to_string()))?;

    let derived_key = derive_key(&passphrase, &salt)?;

    let (ciphertext, nonce) = crate::crypto::cipher::encrypt(&*derived_key, plaintext_json.as_bytes())
        .map_err(|e| Error::Crypto(e.to_string()))?;

    let mut file_bytes = Vec::new();
    file_bytes.extend_from_slice(b"CLAVIS01");
    file_bytes.extend_from_slice(&salt);
    file_bytes.extend_from_slice(&nonce);
    file_bytes.extend_from_slice(&ciphertext);

    std::fs::write(&save_path, file_bytes).map_err(|e| Error::Io(e))?;

    // Securely zeroize
    plaintext_json.zeroize();
    matrix.entries.iter_mut().for_each(|e| {
        e.password_plaintext.zeroize();
        if let Some(ref mut t) = e.totp_secret_plaintext {
            t.zeroize();
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn export_vault_csv(
    save_path: String,
    state: State<'_, AppState>
) -> Result<()> {
    use zeroize::Zeroize;
    let pool = get_pool(&state)?;

    let session_key = {
        let guard = state.session_key.lock_safe();
        match guard.as_ref() {
            Some(key) => key.clone(),
            None => return Err(Error::Database(sqlx::Error::RowNotFound)),
        }
    };

    let rows = sqlx::query("SELECT title, username, ciphertext, nonce FROM entries")
        .fetch_all(&pool)
        .await?;

    let mut csv_content = String::new();
    csv_content.push_str("title,username,password\n");

    for r in rows {
        use sqlx::Row;
        let title: String = r.get("title");
        let username: Option<String> = r.get("username");
        let ciphertext: Vec<u8> = r.get("ciphertext");
        let nonce: Vec<u8> = r.get("nonce");

        let mut decrypted_pw = match crate::crypto::cipher::decrypt(&*session_key, &ciphertext, &nonce) {
            Ok(bytes) => String::from_utf8(bytes).unwrap_or_default(),
            Err(_) => continue,
        };

        let clean_title = title.replace('"', "\"\"");
        let clean_username = username.unwrap_or_default().replace('"', "\"\"");
        let clean_password = decrypted_pw.replace('"', "\"\"");

        let row_line = format!(
            "\"{}\",\"{}\",\"{}\"\n",
            clean_title, clean_username, clean_password
        );
        csv_content.push_str(&row_line);

        decrypted_pw.zeroize();
    }

    std::fs::write(&save_path, csv_content.as_bytes()).map_err(|e| Error::Io(e))?;

    csv_content.zeroize();

    Ok(())
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct ImportPreviewItem {
    pub title: String,
    pub username: Option<String>,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
pub struct ImportPreview {
    pub success: bool,
    pub items: Vec<ImportPreviewItem>,
    pub error: Option<String>,
}

fn extract_name_from_url(url: &str) -> String {
    let mut s = url.trim().to_lowercase();
    if s.starts_with("https://") {
        s = s.strip_prefix("https://").unwrap_or(&s).to_string();
    } else if s.starts_with("http://") {
        s = s.strip_prefix("http://").unwrap_or(&s).to_string();
    }
    if s.starts_with("www.") {
        s = s.strip_prefix("www.").unwrap_or(&s).to_string();
    }
    if let Some(pos) = s.find('/') {
        s.truncate(pos);
    }
    if let Some(pos) = s.find('.') {
        s.truncate(pos);
    }
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

#[tauri::command]
pub async fn parse_import_file(
    file_path: String,
    passphrase: Option<String>,
    _state: State<'_, AppState>
) -> Result<ImportPreview> {
    let path = std::path::Path::new(&file_path);
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some(format!("Failed to read file: {}", e)) }),
    };

    if bytes.starts_with(b"CLAVIS01") {
        let pass = match passphrase {
            Some(p) => p,
            None => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some("passphrase_required".to_string()) }),
        };

        if bytes.len() < 8 + 16 + 12 {
            return Ok(ImportPreview { success: false, items: Vec::new(), error: Some("invalid_file_header".to_string()) });
        }

        let salt = &bytes[8..24];
        let nonce = &bytes[24..36];
        let ciphertext = &bytes[36..];

        let derived_key = match derive_key(&pass, salt) {
            Ok(k) => k,
            Err(e) => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some(format!("Key derivation failed: {}", e)) }),
        };

        let decrypted_bytes = match crate::crypto::cipher::decrypt(&*derived_key, ciphertext, nonce) {
            Ok(b) => b,
            Err(_) => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some("invalid_passphrase".to_string()) }),
        };

        let decrypted_str = match String::from_utf8(decrypted_bytes) {
            Ok(s) => s,
            Err(_) => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some("invalid_utf8_payload".to_string()) }),
        };

        #[derive(serde::Deserialize)]
        #[allow(dead_code)]
        struct ExportEntry {
            title: String,
            username: Option<String>,
            password_plaintext: String,
            totp_secret_plaintext: Option<String>,
        }

        #[derive(serde::Deserialize)]
        struct ExportMatrix {
            entries: Vec<ExportEntry>,
        }

        let matrix: ExportMatrix = match serde_json::from_str(&decrypted_str) {
            Ok(m) => m,
            Err(e) => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some(format!("Failed to parse JSON export: {}", e)) }),
        };

        let preview_items = matrix.entries.iter().map(|e| ImportPreviewItem {
            title: e.title.clone(),
            username: e.username.clone(),
        }).collect();

        Ok(ImportPreview { success: true, items: preview_items, error: None })
    } else {
        let content_str = match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => return Ok(ImportPreview { success: false, items: Vec::new(), error: Some("CSV file contains invalid UTF-8 characters".to_string()) }),
        };

        let mut preview_items = Vec::new();
        let lines: Vec<&str> = content_str.lines().collect();
        if lines.is_empty() {
            return Ok(ImportPreview { success: true, items: preview_items, error: None });
        }

        let header_line = lines[0];
        let headers: Vec<String> = header_line.split(',').map(|s| s.trim().replace('"', "").to_lowercase()).collect();
        
        let title_idx = headers.iter().position(|h| h.contains("title") || h.contains("name") || h.contains("site"));
        let user_idx = headers.iter().position(|h| h.contains("user") || h.contains("login") || h.contains("email"));
        let website_idx = headers.iter().position(|h| h.contains("website") || h.contains("url") || h.contains("link"));

        let title_col = title_idx.unwrap_or(0);
        let user_col = user_idx.unwrap_or(1);

        for line in lines.iter().skip(1) {
            if line.trim().is_empty() { continue; }
            let row_cells: Vec<String> = line.split(',').map(|s| s.trim().replace('"', "")).collect();
            if row_cells.len() > title_col {
                let mut title = row_cells[title_col].clone();
                if title.trim().is_empty() {
                    if let Some(w_idx) = website_idx {
                        if row_cells.len() > w_idx {
                            let web_val = &row_cells[w_idx];
                            if !web_val.trim().is_empty() {
                                title = extract_name_from_url(web_val);
                            }
                        }
                    }
                }
                let username = if row_cells.len() > user_col {
                    let u = row_cells[user_col].clone();
                    if u.is_empty() { None } else { Some(u) }
                } else {
                    None
                };
                preview_items.push(ImportPreviewItem { title, username });
            }
        }

        Ok(ImportPreview { success: true, items: preview_items, error: None })
    }
}

#[tauri::command]
pub async fn execute_import(
    file_path: String,
    passphrase: Option<String>,
    conflict_resolution: String,
    state: State<'_, AppState>
) -> Result<()> {
    use zeroize::Zeroize;
    let pool = get_pool(&state)?;
    let bytes = std::fs::read(&file_path).map_err(|e| Error::Io(e))?;

    let session_key = {
        let guard = state.session_key.lock_safe();
        match guard.as_ref() {
            Some(key) => key.clone(),
            None => return Err(Error::Database(sqlx::Error::RowNotFound)),
        }
    };

    let vault_id: String = match sqlx::query_scalar::<_, String>("SELECT id FROM vaults LIMIT 1")
        .fetch_one(&pool)
        .await
    {
        Ok(id) => id,
        Err(sqlx::Error::RowNotFound) => {
            let new_id = uuid::Uuid::new_v4().to_string();
            let now_secs = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            sqlx::query("INSERT INTO vaults (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
                .bind(&new_id)
                .bind("Primary Vault")
                .bind(now_secs)
                .bind(now_secs)
                .execute(&pool)
                .await?;
            new_id
        }
        Err(e) => return Err(Error::Database(e)),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    #[derive(serde::Deserialize)]
    struct ImportItem {
        title: String,
        username: Option<String>,
        password_plaintext: String,
        totp_secret_plaintext: Option<String>,
    }

    let mut import_items = Vec::new();

    if bytes.starts_with(b"CLAVIS01") {
        let pass = passphrase.ok_or_else(|| Error::Crypto("Passphrase required for .clavis import".to_string()))?;
        let salt = &bytes[8..24];
        let nonce = &bytes[24..36];
        let ciphertext = &bytes[36..];

        let derived_key = derive_key(&pass, salt).map_err(|e| Error::Crypto(e.to_string()))?;

        let decrypted_bytes = crate::crypto::cipher::decrypt(&*derived_key, ciphertext, nonce)
            .map_err(|_| Error::Crypto("Decryption failed".to_string()))?;

        let decrypted_str = String::from_utf8(decrypted_bytes).map_err(|_| Error::Crypto("Invalid UTF8".to_string()))?;

        #[derive(serde::Deserialize)]
        struct ExportMatrix {
            entries: Vec<ImportItem>,
        }

        let matrix: ExportMatrix = serde_json::from_str(&decrypted_str).map_err(|_| Error::Crypto("Parse payload failed".to_string()))?;
        import_items = matrix.entries;
    } else {
        let content_str = String::from_utf8(bytes).map_err(|_| Error::Crypto("Invalid UTF8 in CSV".to_string()))?;
        let lines: Vec<&str> = content_str.lines().collect();
        if !lines.is_empty() {
            let header_line = lines[0];
            let headers: Vec<String> = header_line.split(',').map(|s| s.trim().replace('"', "").to_lowercase()).collect();
            
            let title_idx = headers.iter().position(|h| h.contains("title") || h.contains("name") || h.contains("site"));
            let user_idx = headers.iter().position(|h| h.contains("user") || h.contains("login") || h.contains("email"));
            let pw_idx = headers.iter().position(|h| h.contains("pass") || h.contains("key") || h.contains("secret"));
            let website_idx = headers.iter().position(|h| h.contains("website") || h.contains("url") || h.contains("link"));

            let title_col = title_idx.unwrap_or(0);
            let user_col = user_idx.unwrap_or(1);
            let pw_col = pw_idx.unwrap_or(2);

            for line in lines.iter().skip(1) {
                if line.trim().is_empty() { continue; }
                let row_cells: Vec<String> = line.split(',').map(|s| s.trim().replace('"', "")).collect();
                if row_cells.len() > title_col {
                    let mut title = row_cells[title_col].clone();
                    if title.trim().is_empty() {
                        if let Some(w_idx) = website_idx {
                            if row_cells.len() > w_idx {
                                let web_val = &row_cells[w_idx];
                                if !web_val.trim().is_empty() {
                                    title = extract_name_from_url(web_val);
                                }
                            }
                        }
                    }
                    let username = if row_cells.len() > user_col {
                        let u = row_cells[user_col].clone();
                        if u.is_empty() { None } else { Some(u) }
                    } else {
                        None
                    };
                    let password_plaintext = if row_cells.len() > pw_col {
                        row_cells[pw_col].clone()
                    } else {
                        String::new()
                    };
                    import_items.push(ImportItem {
                        title,
                        username,
                        password_plaintext,
                        totp_secret_plaintext: None,
                    });
                }
            }
        }
    }

    let mut tx = pool.begin().await?;

    for mut item in import_items {
        let existing_id: Option<String> = sqlx::query_scalar("SELECT id FROM entries WHERE title = ? AND username = ?")
            .bind(&item.title)
            .bind(&item.username)
            .fetch_optional(&mut *tx)
            .await?;

        if let Some(id) = existing_id {
            if conflict_resolution == "skip" {
                continue;
            } else if conflict_resolution == "overwrite" {
                let (ciphertext, nonce_vec) = crate::crypto::cipher::encrypt(&*session_key, item.password_plaintext.as_bytes())
                    .map_err(|e| Error::Crypto(e.to_string()))?;
                sqlx::query("UPDATE entries SET ciphertext = ?, nonce = ?, updated_at = ? WHERE id = ?")
                    .bind(&ciphertext)
                    .bind(&nonce_vec)
                    .bind(now)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                continue;
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let (ciphertext, nonce_vec) = crate::crypto::cipher::encrypt(&*session_key, item.password_plaintext.as_bytes())
            .map_err(|e| Error::Crypto(e.to_string()))?;
        
        let totp_blob = if let Some(ref totp_plain) = item.totp_secret_plaintext {
            let (totp_cipher, totp_nonce) = crate::crypto::cipher::encrypt(&*session_key, totp_plain.as_bytes())
                .map_err(|e| Error::Crypto(e.to_string()))?;
            let mut blob = Vec::new();
            blob.extend_from_slice(&totp_nonce);
            blob.extend_from_slice(&totp_cipher);
            Some(blob)
        } else {
            None
        };

        sqlx::query("INSERT INTO entries (id, vault_id, title, username, ciphertext, nonce, totp_secret, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(id)
            .bind(&vault_id)
            .bind(item.title)
            .bind(item.username)
            .bind(ciphertext)
            .bind(nonce_vec)
            .bind(totp_blob)
            .bind(now)
            .bind(now)
            .execute(&mut *tx)
            .await?;

          item.password_plaintext.zeroize();
      }

      tx.commit().await?;

      Ok(())
  }

  fn prune_old_backups(dir: &std::path::Path, limit: usize) {
      if let Ok(entries) = std::fs::read_dir(dir) {
          let mut backups = Vec::new();
          for entry in entries.flatten() {
              let path = entry.path();
              if path.is_file() && path.file_name().map(|n| n.to_string_lossy().starts_with("clavis_backup_")).unwrap_or(false) {
                  if let Ok(metadata) = entry.metadata() {
                      if let Ok(modified) = metadata.modified() {
                          backups.push((path, modified));
                      }
                  }
              }
          }

          backups.sort_by_key(|b| b.1);

          if backups.len() > limit {
              let to_remove = backups.len() - limit;
              for i in 0..to_remove {
                  let _ = std::fs::remove_file(&backups[i].0);
              }
          }
      }
  }

  #[tauri::command]
  pub async fn create_backup(state: State<'_, AppState>, app_handle: tauri::AppHandle) -> Result<String> {
      let pool = get_pool(&state)?;
      let app_dir = app_handle.path().app_data_dir().map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string())))?;
      
      let backup_dir_val = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'backup_directory'")
          .fetch_optional(&pool)
          .await?
          .unwrap_or_default();

      let backup_dir = if backup_dir_val.trim().is_empty() {
          app_dir.join("backups")
      } else {
          std::path::PathBuf::from(backup_dir_val)
      };

      std::fs::create_dir_all(&backup_dir).map_err(|e| Error::Io(e))?;

      let now = std::time::SystemTime::now()
          .duration_since(std::time::UNIX_EPOCH)
          .unwrap_or_default()
          .as_secs();
      let filename = format!("clavis_backup_{}.db", now);
      let backup_file_path = backup_dir.join(&filename);

      let db_path = app_dir.join("vault.db");
      if !db_path.exists() {
          return Err(Error::Database(sqlx::Error::RowNotFound));
      }

      sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&pool).await?;
      std::fs::copy(&db_path, &backup_file_path).map_err(|e| Error::Io(e))?;

      let retention_val = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = 'backup_retention'")
          .fetch_optional(&pool)
          .await?
          .unwrap_or_else(|| "5".to_string());
      let retention: usize = retention_val.parse().unwrap_or(5);

      prune_old_backups(&backup_dir, retention);

      Ok(backup_file_path.to_string_lossy().to_string())
  }

  #[tauri::command]
  pub async fn restore_backup(backup_path: String, state: State<'_, AppState>, app_handle: tauri::AppHandle) -> Result<()> {
      let app_dir = app_handle.path().app_data_dir().map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::NotFound, e.to_string())))?;
      let db_path = app_dir.join("vault.db");
      let cache_dir = app_dir.join("cache");
      std::fs::create_dir_all(&cache_dir).map_err(|e| Error::Io(e))?;
      let safety_dump_path = cache_dir.join("vault_safety_dump.db");

      if db_path.exists() {
          let pool_opt = {
              state.db.lock_safe().clone()
          };
          if let Some(pool) = pool_opt {
              let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").execute(&pool).await;
          }
          std::fs::copy(&db_path, &safety_dump_path).map_err(|e| Error::Io(e))?;
      }

      let pool_to_close = {
          let mut db_guard = state.db.lock_safe();
          db_guard.take()
      };
      if let Some(pool) = pool_to_close {
          pool.close().await;
      }

      if let Err(e) = std::fs::copy(&backup_path, &db_path) {
          if safety_dump_path.exists() {
              let _ = std::fs::copy(&safety_dump_path, &db_path);
          }
          return Err(Error::Io(e));
      }

      let _ = std::fs::remove_file(safety_dump_path);

      Ok(())
  }

  #[tauri::command]
  pub async fn change_master_password(
      current_password: String,
      new_password: String,
      state: State<'_, AppState>,
      app_handle: tauri::AppHandle
  ) -> Result<()> {
      let pool = get_pool(&state)?;

      let (_, salt_path) = get_db_paths(&app_handle)?;
      let salt = get_or_create_salt(&salt_path)?;
      let current_derived_key = derive_key(&current_password, &salt)?;

      {
          let active_key_guard = state.session_key.lock_safe();
          let active_key = active_key_guard.as_ref().ok_or_else(|| Error::Database(sqlx::Error::RowNotFound))?;
          if &**active_key != &*current_derived_key {
              return Err(Error::InvalidPassword);
          }
      }

      let new_derived_key = derive_key(&new_password, &salt)?;
      let new_hex_key = hex::encode(&*new_derived_key);
      let rekey_pragma = format!("PRAGMA rekey = \"x'{}'\"", new_hex_key);

      sqlx::query(&rekey_pragma).execute(&pool).await?;

      {
          let mut active_key_guard = state.session_key.lock_safe();
          *active_key_guard = Some(new_derived_key);
      }

      Ok(())
  }

  #[tauri::command]
  pub fn get_app_version() -> String {
      env!("CARGO_PKG_VERSION").to_string()
  }

  #[tauri::command]
  pub async fn set_autostart(enabled: bool) -> Result<()> {
      let _ = enabled;
      #[cfg(target_os = "linux")]
      {
          let home = std::env::var("HOME").unwrap_or_default();
          if !home.is_empty() {
              let autostart_dir = std::path::PathBuf::from(home).join(".config").join("autostart");
              let desktop_file = autostart_dir.join("clavis.desktop");

              if enabled {
                  let current_exe = std::env::current_exe().map_err(|e| Error::Io(e))?;
                  let exe_path = current_exe.to_string_lossy().to_string();

                  std::fs::create_dir_all(&autostart_dir).map_err(|e| Error::Io(e))?;

                  let desktop_content = format!(
                      "[Desktop Entry]\nType=Application\nName=Clavis\nComment=Clavis Password Manager\nExec={} --minimized\nIcon=clavis\nTerminal=false\nCategories=Utility;\n",
                      exe_path
                  );
                  std::fs::write(&desktop_file, desktop_content).map_err(|e| Error::Io(e))?;
              } else {
                  if desktop_file.exists() {
                      std::fs::remove_file(desktop_file).map_err(|e| Error::Io(e))?;
                  }
              }
          }
      }
      Ok(())
  }

#[tauri::command]
pub fn get_active_connections_count() -> usize {
    crate::ws::ACTIVE_CONNECTIONS.load(std::sync::atomic::Ordering::SeqCst)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> std::result::Result<(), String> {
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct AttachmentInfo {
    pub name: String,
    pub size: u64,
}

#[tauri::command]
pub async fn attach_file_to_entry(
    entry_id: String,
    source_path: String,
    app_handle: tauri::AppHandle,
) -> std::result::Result<AttachmentInfo, String> {
    let src = std::path::Path::new(&source_path);
    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    let file_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();

    let file_size = std::fs::metadata(src)
        .map(|m| m.len())
        .map_err(|e| e.to_string())?;

    let mut dest_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    dest_dir.push("attachments");
    dest_dir.push(&entry_id);

    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    
    let mut dest_file = dest_dir.clone();
    dest_file.push(&file_name);

    std::fs::copy(src, &dest_file).map_err(|e| e.to_string())?;

    Ok(AttachmentInfo {
        name: file_name,
        size: file_size,
    })
}

#[tauri::command]
pub async fn list_attachments(
    entry_id: String,
    app_handle: tauri::AppHandle,
) -> std::result::Result<Vec<AttachmentInfo>, String> {
    let mut dest_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    dest_dir.push("attachments");
    dest_dir.push(&entry_id);

    if !dest_dir.exists() {
        return Ok(Vec::new());
    }

    let mut list = Vec::new();
    let entries = std::fs::read_dir(dest_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        if let Ok(e) = entry {
            let path = e.path();
            if path.is_file() {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                list.push(AttachmentInfo { name, size });
            }
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn download_attachment(
    entry_id: String,
    file_name: String,
    target_path: String,
    app_handle: tauri::AppHandle,
) -> std::result::Result<(), String> {
    let mut src_file = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    src_file.push("attachments");
    src_file.push(&entry_id);
    src_file.push(&file_name);

    if !src_file.exists() {
        return Err("Attachment not found".to_string());
    }

    let dest = std::path::Path::new(&target_path);
    std::fs::copy(&src_file, dest).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_attachment(
    entry_id: String,
    file_name: String,
    app_handle: tauri::AppHandle,
) -> std::result::Result<(), String> {
    let mut src_file = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    src_file.push("attachments");
    src_file.push(&entry_id);
    src_file.push(&file_name);

    if src_file.exists() {
        std::fs::remove_file(src_file).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn verify_master_password(
    password: String,
    state: tauri::State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> std::result::Result<bool, String> {
    let (_, salt_path) = get_db_paths(&app_handle).map_err(|e| e.to_string())?;
    let salt = get_or_create_salt(&salt_path).map_err(|e| e.to_string())?;
    let derived_key = derive_key(&password, &salt).map_err(|e| e.to_string())?;

    let active_key_guard = state.session_key.lock_safe();
    if let Some(active_key) = active_key_guard.as_ref() {
        Ok(&**active_key == &*derived_key)
    } else {
        Err("Vault is locked".to_string())
    }
}

#[derive(serde::Serialize)]
pub struct DetectedBrowser {
    pub name: String,
    pub detected: bool,
    pub extension_installed: bool,
}

fn command_exists(cmd: &str) -> bool {
    std::process::Command::new("which")
        .arg(cmd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn detect_installed_browsers() -> Vec<DetectedBrowser> {
    let home = std::env::var("HOME").unwrap_or_default();
    let home_path = std::path::Path::new(&home);

    let mut list = Vec::new();

    // Chrome
    let chrome_detected = command_exists("google-chrome") || command_exists("google-chrome-stable") || home_path.join(".config/google-chrome").exists() || home_path.join(".var/app/com.google.Chrome").exists();
    let chrome_ext = home_path.join(".config/google-chrome/NativeMessagingHosts/com.achyllisss.clavis.json").exists() ||
                     home_path.join(".var/app/com.google.Chrome/.config/google-chrome/NativeMessagingHosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Google Chrome".to_string(),
        detected: chrome_detected,
        extension_installed: chrome_ext,
    });

    // Firefox
    let firefox_detected = command_exists("firefox") || home_path.join(".mozilla").exists() || home_path.join(".var/app/org.mozilla.firefox").exists();
    let firefox_ext = home_path.join(".mozilla/native-messaging-hosts/com.achyllisss.clavis.json").exists() ||
                      home_path.join(".var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Mozilla Firefox".to_string(),
        detected: firefox_detected,
        extension_installed: firefox_ext,
    });

    // Floorp
    let floorp_detected = command_exists("floorp") || home_path.join(".floorp").exists() || home_path.join(".var/app/one.ablaze.floorp").exists();
    let floorp_ext = home_path.join(".floorp/native-messaging-hosts/com.achyllisss.clavis.json").exists() ||
                     home_path.join(".var/app/one.ablaze.floorp/.floorp/native-messaging-hosts/com.achyllisss.clavis.json").exists() ||
                     home_path.join(".var/app/one.ablaze.floorp/.mozilla/native-messaging-hosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Floorp".to_string(),
        detected: floorp_detected,
        extension_installed: floorp_ext,
    });

    // Brave
    let brave_detected = command_exists("brave-browser") || home_path.join(".config/BraveSoftware").exists() || home_path.join(".var/app/com.brave.Browser").exists();
    let brave_ext = home_path.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.achyllisss.clavis.json").exists() ||
                    home_path.join(".var/app/com.brave.Browser/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Brave Browser".to_string(),
        detected: brave_detected,
        extension_installed: brave_ext,
    });

    // Chromium
    let chromium_detected = command_exists("chromium") || command_exists("chromium-browser") || home_path.join(".config/chromium").exists();
    let chromium_ext = home_path.join(".config/chromium/NativeMessagingHosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Chromium".to_string(),
        detected: chromium_detected,
        extension_installed: chromium_ext,
    });

    // Edge
    let edge_detected = command_exists("microsoft-edge") || command_exists("microsoft-edge-stable") || home_path.join(".config/microsoft-edge").exists();
    let edge_ext = home_path.join(".config/microsoft-edge/NativeMessagingHosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Microsoft Edge".to_string(),
        detected: edge_detected,
        extension_installed: edge_ext,
    });

    // Vivaldi
    let vivaldi_detected = command_exists("vivaldi") || home_path.join(".config/vivaldi").exists();
    let vivaldi_ext = home_path.join(".config/vivaldi/NativeMessagingHosts/com.achyllisss.clavis.json").exists();
    list.push(DetectedBrowser {
        name: "Vivaldi".to_string(),
        detected: vivaldi_detected,
        extension_installed: vivaldi_ext,
    });

    list
}
