pub mod crypto;
pub mod error;
pub mod totp;
pub mod vault;

use std::sync::Mutex;
use totp::{capture_source, get_totp_code, list_capture_sources};
use vault::command::{
    create_entry, create_vault, create_vault_partition, delete_entry, delete_vault, get_entry,
    get_setting, is_vault_initialized, is_vault_locked, list_entries, list_vaults, lock,
    set_setting, unlock, update_entry, AppState,
};

// Add the greet command back:
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(None),
            session_key: Mutex::new(None),
        })
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            create_vault,
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
            list_capture_sources,
            capture_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
