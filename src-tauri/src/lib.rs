pub mod crypto;
pub mod error;
pub mod totp;
pub mod vault;
pub mod clipboard;
pub mod breach;
pub mod ws;

use std::sync::Mutex;
use tauri::Manager;
use totp::{capture_source, get_totp_code, list_capture_sources};
use clipboard::copy_to_clipboard;
use breach::{check_password_breached, get_cached_breaches, update_breaches_cache};
use vault::command::{
    create_entry, create_vault, create_vault_partition, delete_entry, delete_vault, get_entry,
    get_setting, is_vault_initialized, is_vault_locked, list_entries, list_vaults, lock,
    set_setting, unlock, update_entry, AppState,
};
use crypto::generator::generate_password;

// Add the greet command back:
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut token_bytes = [0u8; 32];
    {
        use ring::rand::SecureRandom;
        ring::rand::SystemRandom::new()
            .fill(&mut token_bytes)
            .expect("Failed to generate secure random token");
    }
    let ws_token = hex::encode(token_bytes);

    let app = tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(None),
            session_key: Mutex::new(None),
            clipboard_epoch: Mutex::new(0),
            ws_token: Mutex::new(ws_token),
        })
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ws::start_server(app_handle).await {
                    eprintln!("FATAL: WebSocket server error: {:?}", e);
                    std::process::exit(1);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            create_vault,
            generate_password,
            unlock,
            lock,
            is_vault_locked,
            is_vault_initialized,
            create_vault_partition,
            list_vaults,
            get_setting,
            set_setting,
            delete_vault,
            create_entry,
            list_entries,
            get_entry,
            update_entry,
            delete_entry,
            get_totp_code,
            copy_to_clipboard,
            check_password_breached,
            get_cached_breaches,
            update_breaches_cache,
            list_capture_sources,
            capture_source
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(app_dir) = app_handle.path().app_data_dir() {
                #[cfg(unix)]
                {
                    let socket_path = app_dir.join("ipc.sock");
                    let _ = std::fs::remove_file(socket_path);
                }
            }
        }
    });
}
