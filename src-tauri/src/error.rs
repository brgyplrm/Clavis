use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Crypto error: {0}")]
    Crypto(String),

    #[error("Argon2 error: {0}")]
    Argon2(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Zeroize / Memory error: {0}")]
    Memory(String),

    #[error("Invalid master password")]
    InvalidPassword,

    #[error("Vault is locked")]
    VaultLocked,

    #[error("Vault is already unlocked")]
    VaultAlreadyUnlocked,

    #[error("TOTP error: {0}")]
    Totp(String),

    #[error("Breach detection error: {0}")]
    Breach(String),

    #[error("Migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),
}

// Convert the error into a serialized string for Tauri's IPC bridge
impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

pub trait MutexExt<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T>;
}

impl<T> MutexExt<T> for std::sync::Mutex<T> {
    fn lock_safe(&self) -> std::sync::MutexGuard<'_, T> {
        match self.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

// Register this module in lib.rs by adding at the top:
//  pub mod error;
