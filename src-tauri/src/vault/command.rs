use secrecy::ExposeSecret;
use sqlx::SqlitePool;
use std::sync::Mutex;
use secrecy::SecretVec;
use tauri::{AppHandle, State};

use crate::error::{Error, Result};
use crate::crypto::kdf::derive_key;
use crate::vault::db::{get_db_paths, get_or_create_salt, connect_to_db};

pub struct AppState {
    pub db: Mutex<Option<SqlitePool>>,
    pub session_key: Mutex<Option<SecretVec<u8>>>,
}

#[tauri::command]
pub async fn unlock_vault(
    password: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // 1. If already unlocked, return error
    if state.db.lock().unwrap().is_some() {
        return Err(Error::VaultAlreadyUnlocked);
    }

    // 2. Fetch salt file
    let (db_path, salt_path) = get_db_paths(&app_handle)?;
    let salt = get_or_create_salt(&salt_path)?;

    // 3. Derive key using Argon2id
    let derived_key = derive_key(&password, &salt)?;

    // Cast the derived key to a fixed-size array for db connection
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(derived_key.expose_secret());

    // 4. Connect to SQLCipher (this implicitly verifies the key via migrations/schema access)
    let pool = match connect_to_db(&db_path, &key_bytes).await {
        Ok(pool) => pool,
        Err(_) => return Err(Error::InvalidPassword),
    };

    // 5. Store session key and connection pool
    *state.db.lock().unwrap() = Some(pool);
    *state.session_key.lock().unwrap() = Some(derived_key);

    Ok(())
}

#[tauri::command]
pub fn lock_vault(state: State<'_, AppState>) -> Result<()> {
    // Zero out memory and close connections
    *state.db.lock().unwrap() = None;
    *state.session_key.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub fn is_vault_locked(state: State<'_, AppState>) -> Result<bool> {
    Ok(state.db.lock().unwrap().is_none())
}