use crate::error::{Error, MutexExt, Result};
use crate::vault::command::AppState;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// Copies the given sensitive text (password, TOTP code) to the clipboard.
/// Spawns an asynchronous background task (tokio::spawn) that sleeps for exactly 30 seconds
/// then clears the clipboard if the contents have not been modified/replaced in the meantime.
#[tauri::command]
pub async fn copy_to_clipboard(
    text: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // 1. Increment the epoch sequence to identify this copy operation uniquely
    let epoch = {
        let mut guard = state.clipboard_epoch.lock_safe();
        *guard += 1;
        *guard
    };

    // 2. Write the text to system clipboard via arboard (no logging of the text variable)
    let mut cb = arboard::Clipboard::new()
        .map_err(|e| Error::Memory(format!("Clipboard initialization failed: {}", e)))?;
    cb.set_text(text.clone())
        .map_err(|e| Error::Memory(format!("Writing to clipboard failed: {}", e)))?;

    // 3. Spawn a tokio task that sleeps for 30s and then clears if epoch matches
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;

        let state_in_thread = app_handle.state::<AppState>();
        let current_epoch = {
            let guard = state_in_thread.clipboard_epoch.lock_safe();
            *guard
        };

        if current_epoch == epoch {
            if let Ok(mut cb) = arboard::Clipboard::new() {
                if let Ok(current_text) = cb.get_text() {
                    if current_text == text {
                        let _ = cb.clear();
                    }
                }
            }
        }
    });

    Ok(())
}
