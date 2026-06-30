use crate::crypto::memlock::LockedVec;
use crate::error::{Error, MutexExt, Result};
use crate::vault::command::{get_pool, AppState};
use enigo::{Enigo, Key, KeyboardControllable};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
use zeroize::Zeroize;

#[derive(serde::Serialize, Clone)]
pub struct AutotypeMatch {
    pub id: String,
    pub title: String,
    pub username: String,
}

// Global state to store active matches for the picker window
pub struct AutotypeState {
    pub matches: Mutex<Vec<AutotypeMatch>>,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetForegroundWindow() -> *mut std::ffi::c_void;
    fn GetWindowTextW(hwnd: *mut std::ffi::c_void, lp_string: *mut u16, n_max_count: i32) -> i32;
    fn GetCursorPos(lp_point: *mut POINT) -> i32;
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct POINT {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
fn get_cursor_pos() -> (i32, i32) {
    let mut pt = POINT { x: 0, y: 0 };
    unsafe {
        GetCursorPos(&mut pt);
    }
    (pt.x, pt.y)
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_pos() -> (i32, i32) {
    (0, 0)
}

#[cfg(target_os = "windows")]
fn get_active_window_title() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut buffer = [0u16; 512];
        let len = GetWindowTextW(hwnd, buffer.as_mut_ptr(), 512);
        if len > 0 {
            Some(String::from_utf16_lossy(&buffer[..len as usize]))
        } else {
            None
        }
    }
}

#[cfg(target_os = "linux")]
fn get_active_window_title() -> Option<String> {
    if std::env::var("DISPLAY").is_err() {
        return None;
    }
    // 1. Get active window ID
    let root_out = std::process::Command::new("xprop")
        .args(["-root", "_NET_ACTIVE_WINDOW"])
        .output()
        .ok()?;
    let root_str = String::from_utf8_lossy(&root_out.stdout);
    let parts: Vec<&str> = root_str.split("window id #").collect();
    if parts.len() < 2 {
        return None;
    }
    let win_id = parts[1].trim().trim_start_matches("0x");
    let win_id_hex = u32::from_str_radix(win_id, 16).ok()?;

    // 2. Get active window name
    let name_out = std::process::Command::new("xprop")
        .args(["-id", &format!("0x{:x}", win_id_hex), "_NET_WM_NAME"])
        .output()
        .ok()?;
    let name_str = String::from_utf8_lossy(&name_out.stdout);
    let name_parts: Vec<&str> = name_str.split(" = ").collect();
    if name_parts.len() < 2 {
        return None;
    }
    let title = name_parts[1].trim().trim_matches('"').to_string();
    Some(title)
}

#[cfg(target_os = "macos")]
fn get_active_window_title() -> Option<String> {
    let script =
        "tell application \"System Events\" to get name of first process whose frontmost is true";
    let output = std::process::Command::new("osascript")
        .args(["-e", script])
        .output()
        .ok()?;
    let title = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

fn show_safety_warning(body: &str) {
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("notify-send")
            .args(["Clavis Autotype Blocked", body])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "display notification \"{}\" with title \"Clavis Autotype Blocked\"",
            body
        );
        let _ = std::process::Command::new("osascript")
            .args(["-e", &script])
            .status();
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!("[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('{}', 'Clavis Autotype Blocked')", body);
        let _ = std::process::Command::new("powershell")
            .args(["-Command", &script])
            .status();
    }
}

pub async fn trigger_autotype_flow(app: &AppHandle) -> Result<()> {
    let app_state = app.state::<AppState>();

    // Check lock state
    {
        let db_guard = app_state.db.lock_safe();
        if db_guard.is_none() {
            show_safety_warning("Vault is encrypted. Please unlock Clavis first.");
            return Ok(());
        }
    }

    let win_title = match get_active_window_title() {
        Some(t) => t,
        None => {
            show_safety_warning("Could not resolve current active window title.");
            return Ok(());
        }
    };

    let pool = get_pool(&app_state)?;
    let rows = sqlx::query("SELECT id, title, username, ciphertext, nonce FROM entries")
        .fetch_all(&pool)
        .await?;

    let mut matches = Vec::new();
    let win_title_lower = win_title.to_lowercase();

    for row in rows {
        use sqlx::Row;
        let id: String = row.try_get("id")?;
        let title: String = row.try_get("title")?;
        let username_opt: Option<String> = row.try_get("username")?;
        let username = username_opt.unwrap_or_default();
        let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
        let nonce: Vec<u8> = row.try_get("nonce")?;

        let title_lower = title.to_lowercase();
        // Check heuristics: matching title substring or domain pattern
        if win_title_lower.contains(&title_lower) || title_lower.contains(&win_title_lower) {
            matches.push((id, title, username, ciphertext, nonce));
        }
    }

    if matches.is_empty() {
        show_safety_warning(&format!(
            "No credentials found matching active window title: '{}'",
            win_title
        ));
        return Ok(());
    }

    if matches.len() == 1 {
        // Single match: Autotype directly
        let (_id, _, username, ciphertext, nonce) = matches.remove(0);
        let password = decrypt_entry_password(&app_state, &ciphertext, &nonce)?;
        perform_typing(&username, password).await;
    } else {
        // Multi-match: Show tiny picker window at cursor coordinates
        let state = app.state::<AutotypeState>();
        let mut matches_guard = state.matches.lock_safe();
        matches_guard.clear();
        for (id, title, username, _, _) in matches {
            matches_guard.push(AutotypeMatch {
                id,
                title,
                username,
            });
        }

        let cursor = get_cursor_pos();
        let mut picker_builder = WebviewWindowBuilder::new(
            app,
            "autotype_picker",
            WebviewUrl::App("index.html#/autotype-picker".into()),
        )
        .title("Select Account")
        .inner_size(280.0, 190.0)
        .decorations(false)
        .always_on_top(true)
        .resizable(false)
        .visible(false);

        if cursor != (0, 0) {
            picker_builder = picker_builder.position(cursor.0 as f64, cursor.1 as f64);
        } else {
            picker_builder = picker_builder.center();
        }

        let picker = picker_builder.build()?;
        let _ = picker.show();
        let _ = picker.set_focus();
    }

    Ok(())
}

fn decrypt_entry_password(state: &AppState, ciphertext: &[u8], nonce: &[u8]) -> Result<LockedVec> {
    let guard = state.session_key.lock_safe();
    let session_key = guard.as_ref().ok_or(Error::VaultLocked)?;
    let password_bytes = crate::crypto::cipher::decrypt(&**session_key, ciphertext, nonce)?;
    Ok(LockedVec::new(password_bytes))
}

async fn perform_typing(username: &str, locked_pw: LockedVec) {
    // Sleep briefly to let user release Ctrl/Shift modifier keys
    tokio::time::sleep(Duration::from_millis(350)).await;

    let mut enigo = Enigo::new();

    // Type username
    for c in username.chars() {
        enigo.key_sequence(&c.to_string());
        std::thread::sleep(Duration::from_millis(20));
    }

    // Tab press
    enigo.key_click(Key::Tab);
    std::thread::sleep(Duration::from_millis(150));

    // Type password
    let pw_slice = locked_pw.as_slice();
    let pw_str = String::from_utf8_lossy(pw_slice);
    let mut password_mut = pw_str.to_string();
    for c in password_mut.chars() {
        enigo.key_sequence(&c.to_string());
        std::thread::sleep(Duration::from_millis(20));
    }
    password_mut.zeroize();

    // Submit
    enigo.key_click(Key::Return);
}

#[tauri::command]
pub fn get_autotype_matches(state: State<'_, AutotypeState>) -> Vec<AutotypeMatch> {
    let guard = state.matches.lock_safe();
    guard.clone()
}

#[tauri::command]
pub async fn submit_autotype_selection(
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<()> {
    // Close picker window first
    if let Some(picker) = app.get_webview_window("autotype_picker") {
        let _ = picker.close();
    }

    let pool = get_pool(&state)?;
    let row = sqlx::query("SELECT username, ciphertext, nonce FROM entries WHERE id = ?")
        .bind(id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| Error::Database(sqlx::Error::RowNotFound))?;

    use sqlx::Row;
    let username_opt: Option<String> = row.try_get("username")?;
    let username = username_opt.unwrap_or_default();
    let ciphertext: Vec<u8> = row.try_get("ciphertext")?;
    let nonce: Vec<u8> = row.try_get("nonce")?;

    let password = decrypt_entry_password(&state, &ciphertext, &nonce)?;
    perform_typing(&username, password).await;

    Ok(())
}

#[tauri::command]
pub fn update_autotype_shortcut(
    shortcut_str: String,
    app_handle: AppHandle,
) -> std::result::Result<(), String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let manager = app_handle.global_shortcut();
    let _ = manager.unregister_all();

    if shortcut_str.is_empty() {
        return Ok(());
    }

    let lower = shortcut_str.to_lowercase();
    let has_modifier = lower.contains("ctrl")
        || lower.contains("control")
        || lower.contains("shift")
        || lower.contains("alt")
        || lower.contains("super")
        || lower.contains("cmd")
        || lower.contains("command")
        || lower.contains("meta");
    if !has_modifier {
        return Err(
            "Global shortcuts must include at least one modifier key (e.g., Ctrl, Alt, Shift)"
                .to_string(),
        );
    }

    let shortcut = Shortcut::from_str(&shortcut_str)
        .map_err(|e| format!("Invalid shortcut pattern: {}", e))?;

    manager
        .register(shortcut)
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn clear_all_shortcuts(app_handle: AppHandle) -> std::result::Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let _ = app_handle.global_shortcut().unregister_all();
    Ok(())
}
