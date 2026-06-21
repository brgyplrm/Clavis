pub mod error;
pub mod crypto;
pub mod vault;

use std::sync::Mutex;
use vault::command::{AppState, unlock_vault, lock_vault, is_vault_locked};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            db: Mutex::new(None),
            session_key: Mutex::new(None),
        })
        
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
          unlock_vault,
          lock_vault,
          is_vault_locked
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
