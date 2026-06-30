use crate::error::{Error, MutexExt, Result};
use crate::vault::command::AppState;
use sqlx::sqlite::SqlitePool;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use totp_rs::{Algorithm, Secret, TOTP};
use zeroize::{Zeroize, Zeroizing};

fn get_pool(state: &State<'_, AppState>) -> Result<SqlitePool> {
    state.db.lock_safe().clone().ok_or(Error::VaultLocked)
}

#[derive(serde::Serialize)]
pub struct TotpResponse {
    code: String,
    seconds_remaining: u64,
}

/// Retrieves the database entry, decrypts the TOTP secret, generates the 6-digit code,
/// and returns the code along with the remaining seconds in the 30-second time slice.
#[tauri::command]
pub async fn get_totp_code(entry_id: String, state: State<'_, AppState>) -> Result<TotpResponse> {
    let pool = get_pool(&state)?;

    let row = sqlx::query("SELECT totp_secret FROM entries WHERE id = ?")
        .bind(entry_id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| Error::Database(sqlx::Error::RowNotFound))?;

    use sqlx::Row;
    let totp_blob: Option<Vec<u8>> = row.try_get("totp_secret")?;
    let totp_blob =
        totp_blob.ok_or_else(|| Error::Totp("No TOTP secret stored for this entry".to_string()))?;

    // Decrypt the TOTP secret inside a short-lived scope to release the MutexGuard immediately
    let mut decrypted_totp = {
        let guard = state.session_key.lock_safe();
        let session_key = guard.as_ref().ok_or(Error::VaultLocked)?;

        if totp_blob.len() < 12 {
            return Err(Error::Crypto("Invalid TOTP blob length".to_string()));
        }
        let (totp_nonce, totp_cipher) = totp_blob.split_at(12);
        let decrypted = crate::crypto::cipher::decrypt(&**session_key, totp_cipher, totp_nonce)?;
        String::from_utf8(decrypted)
            .map_err(|e| Error::Crypto(format!("Invalid UTF-8 in TOTP secret: {}", e)))?
    };

    // Clean up spaces, dashes, and ensure uppercase (standard RFC-4648 Base32 alphabet normalization)
    let cleaned_secret = Zeroizing::new(
        decrypted_totp
            .replace(' ', "")
            .replace('-', "")
            .to_uppercase(),
    );
    // Wipes original temporary decrypted string
    decrypted_totp.zeroize();

    let secret = Secret::Encoded(cleaned_secret.to_string());
    let step = 30;

    let secret_bytes = secret
        .to_bytes()
        .map_err(|e| Error::Totp(format!("Invalid Base32 secret: {}", e)))?;
    let zeroized_bytes = Zeroizing::new(secret_bytes);

    let totp = TOTP::new(Algorithm::SHA1, 6, 1, step, zeroized_bytes.to_vec())
        .map_err(|e| Error::Totp(e.to_string()))?;

    let code = totp
        .generate_current()
        .map_err(|e| Error::Totp(e.to_string()))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| Error::Crypto(e.to_string()))?
        .as_secs();

    let seconds_remaining = step - (now % step);

    Ok(TotpResponse {
        code,
        seconds_remaining,
    })
}

#[derive(serde::Serialize, Clone)]
pub struct CaptureSource {
    pub id: String,
    pub name: String,
    pub source_type: String, // "screen" or "window"
    pub app_name: Option<String>,
    pub title: Option<String>,
    pub width: u32,
    pub height: u32,
}

/// Lists all active screens and application windows.
#[tauri::command]
pub async fn list_capture_sources() -> Result<Vec<CaptureSource>> {
    let mut sources = Vec::new();

    // 1. Add Monitors (Screens)
    if let Ok(monitors) = xcap::Monitor::all() {
        for (i, monitor) in monitors.iter().enumerate() {
            let name = monitor.name().unwrap_or_else(|_| format!("{}", i + 1));
            let width = monitor.width().unwrap_or(0);
            let height = monitor.height().unwrap_or(0);
            sources.push(CaptureSource {
                id: format!("screen:{}", i),
                name: format!("Screen {} ({})", i + 1, name),
                source_type: "screen".to_string(),
                app_name: None,
                title: None,
                width,
                height,
            });
        }
    }

    // 2. Add Windows (Applications)
    if let Ok(windows) = xcap::Window::all() {
        for (i, window) in windows.iter().enumerate() {
            let title = window.title().unwrap_or_default();
            let app_name = window.app_name().unwrap_or_default();
            if title.is_empty() && app_name.is_empty() {
                continue;
            }
            let width = window.width().unwrap_or(0);
            let height = window.height().unwrap_or(0);
            sources.push(CaptureSource {
                id: format!("window:{}", i),
                name: format!("{} - {}", app_name, title),
                source_type: "window".to_string(),
                app_name: Some(app_name),
                title: Some(title),
                width,
                height,
            });
        }
    }

    Ok(sources)
}

/// Captures a screenshot of the specified screen or window and returns a base64 PNG data URL.
#[tauri::command]
pub async fn capture_source(id: String) -> Result<String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use image::ImageFormat;
    use std::io::Cursor;

    if id.starts_with("screen:") {
        let index_str = id.trim_start_matches("screen:");
        let index: usize = index_str
            .parse()
            .map_err(|e| Error::Totp(format!("Invalid screen ID: {}", e)))?;
        let monitors = xcap::Monitor::all().map_err(|e| Error::Totp(e.to_string()))?;
        let monitor = monitors
            .get(index)
            .ok_or_else(|| Error::Totp("Screen index out of bounds".to_string()))?;
        let img = monitor
            .capture_image()
            .map_err(|e| Error::Totp(e.to_string()))?;
        let mut buffer = Vec::new();
        img.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
            .map_err(|e| Error::Totp(e.to_string()))?;
        return Ok(format!("data:image/png;base64,{}", STANDARD.encode(buffer)));
    } else if id.starts_with("window:") {
        let index_str = id.trim_start_matches("window:");
        let index: usize = index_str
            .parse()
            .map_err(|e| Error::Totp(format!("Invalid window ID: {}", e)))?;
        let windows = xcap::Window::all().map_err(|e| Error::Totp(e.to_string()))?;
        let window = windows
            .get(index)
            .ok_or_else(|| Error::Totp("Window index out of bounds".to_string()))?;
        let img = window
            .capture_image()
            .map_err(|e| Error::Totp(e.to_string()))?;
        let mut buffer = Vec::new();
        img.write_to(&mut Cursor::new(&mut buffer), ImageFormat::Png)
            .map_err(|e| Error::Totp(e.to_string()))?;
        return Ok(format!("data:image/png;base64,{}", STANDARD.encode(buffer)));
    }
    Err(Error::Totp("Invalid capture source format".to_string()))
}
