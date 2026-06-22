pub mod error;
pub mod crypto;
pub mod vault;

use std::sync::Mutex;
use vault::command::{AppState, unlock_vault, lock_vault, is_vault_locked, create_vault, list_vaults, delete_vault, create_entry, list_entries, get_entry, update_entry, delete_entry, is_vault_initialized};

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
          unlock_vault,
          lock_vault,
          is_vault_locked,
          create_vault,
          list_vaults,
          delete_vault,
          create_entry,
          list_entries,
          get_entry,
          update_entry,
          delete_entry,
          is_vault_initialized
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
