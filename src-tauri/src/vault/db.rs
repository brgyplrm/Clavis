use ring::rand::{SecureRandom, SystemRandom};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

use crate::error::{Error, Result};

/// Locates the app data directory and database path.
pub fn get_db_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf)> {
    let app_dir = app.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;

    // Create directory if it doesn't exist
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)?;
    }

    let db_path = app_dir.join("vault.db");
    let salt_path = app_dir.join("salt.bin");

    // Close the get_db_paths function here!
    Ok((db_path, salt_path))
}

// Retrieves or generates the 16-byte KDF salt.
pub fn get_or_create_salt(salt_path: &PathBuf) -> Result<Vec<u8>> {
    if salt_path.exists() {
        let salt = fs::read(salt_path)?;
        if salt.len() == 16 {
            return Ok(salt);
        }
    }

    // Generate a secure 16-byte salt
    let mut salt = vec![0u8; 16];
    let rng = SystemRandom::new();
    rng.fill(&mut salt)
        .map_err(|_| Error::Crypto("Failed to generate secure salt".to_string()))?;

    fs::write(salt_path, &salt)?;
    Ok(salt)
}

/// Connects to SQLCipher database using the derived 32-byte key.
pub async fn connect_to_db(db_path: &PathBuf, derived_key: &[u8; 32]) -> Result<SqlitePool> {
    // Format the binary key to SQLCipher hex syntax: "x'HEX_STRING'"
    let mut hex_key = hex::encode(derived_key);
    let mut key_pragma = format!("\"x'{}'\"", hex_key);

    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .busy_timeout(std::time::Duration::from_secs(5))
        .pragma("key", key_pragma.clone())
        .pragma("foreign_keys", "ON")
        .pragma("journal_mode", "WAL")
        .pragma("synchronous", "NORMAL");

    // Establish the connection pool
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    hex_key.zeroize();
    key_pragma.zeroize();

    // Run the migrations automatically
    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}
