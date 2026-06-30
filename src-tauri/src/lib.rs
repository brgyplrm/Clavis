pub mod breach;
pub mod clipboard;
pub mod crypto;
pub mod error;
pub mod notifications;
pub mod totp;
pub mod vault;
pub mod ws;

use crate::error::MutexExt;
use breach::{check_password_breached, get_cached_breaches, update_breaches_cache};
use clipboard::copy_to_clipboard;
use crypto::generator::generate_password;
use notifications::show_native_notification;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use totp::{capture_source, get_totp_code, list_capture_sources};
use vault::autotype::{
    clear_all_shortcuts, get_autotype_matches, submit_autotype_selection, update_autotype_shortcut,
};
use vault::command::{
    add_to_blocklist, create_entry, create_vault, create_vault_partition,
    create_vault_with_security, delete_entry, delete_vault, estimate_password_strength, get_entry,
    get_password_hint, get_recovery_questions, get_setting, is_vault_initialized, is_vault_locked,
    list_entries, list_vaults, lock, recover_vault, remove_from_blocklist, set_setting, unlock,
    update_entry, verify_recovery_answers, AppState,
    export_vault_encrypted, export_vault_csv, parse_import_file, execute_import,
    create_backup, restore_backup, change_master_password, get_app_version, set_autostart,
    get_active_connections_count, write_text_file,
    attach_file_to_entry, list_attachments, download_attachment, delete_attachment,
    verify_master_password, detect_installed_browsers,
};

// Add the greet command back:
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn close_window(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.close();
    }
}

#[tauri::command]
fn resize_to_main_window(app_handle: tauri::AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.set_decorations(true);
        let _ = window.set_resizable(true);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 800.0,
            height: 600.0,
        }));
        let _ = window.center();
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    disable_core_dumps();

    let mut token_bytes = [0u8; 32];
    {
        use ring::rand::SecureRandom;
        if ring::rand::SystemRandom::new()
            .fill(&mut token_bytes)
            .is_err()
        {
            eprintln!("Warning: entropy source failed. Falling back to pseudorandom key.");
            for (i, byte) in token_bytes.iter_mut().enumerate() {
                *byte = (i * 17) as u8;
            }
        }
    }
    let ws_token = hex::encode(token_bytes);

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            db: Mutex::new(None),
            session_key: Mutex::new(None),
            clipboard_epoch: Mutex::new(0),
            ws_token: Mutex::new(ws_token),
        })
        .manage(vault::autotype::AutotypeState {
            matches: Mutex::new(Vec::new()),
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;

                    if event.state == ShortcutState::Pressed {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) =
                                vault::autotype::trigger_autotype_flow(&app_handle).await
                            {
                                eprintln!("Autotype error: {:?}", e);
                            }
                        });
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = ws::start_server(app_handle).await {
                    eprintln!("FATAL: WebSocket server error: {:?}", e);
                    std::process::exit(1);
                }
            });

            // Check start minimized CLI args
            let args: Vec<String> = std::env::args().collect();
            let start_minimized = args
                .iter()
                .any(|arg| arg == "--minimized" || arg == "--start-minimized");

            // Setup tray icon
            let toggle = tauri::menu::MenuItem::with_id(
                app,
                "toggle",
                "Show/Hide Window",
                true,
                None::<&str>,
            )
            .ok();
            let lock_item =
                tauri::menu::MenuItem::with_id(app, "lock", "Lock Vault", true, None::<&str>).ok();
            let autotype_item = tauri::menu::MenuItem::with_id(
                app,
                "autotype",
                "Trigger Autotype",
                true,
                None::<&str>,
            )
            .ok();
            let exit_item =
                tauri::menu::MenuItem::with_id(app, "exit", "Exit Clavis", true, None::<&str>).ok();

            let menu = if let (Some(t), Some(l), Some(a), Some(e)) =
                (toggle, lock_item, autotype_item, exit_item)
            {
                tauri::menu::Menu::with_items(app, &[&t, &l, &a, &e]).ok()
            } else {
                None
            };

            let default_icon = app.default_window_icon().cloned();
            if let (Some(menu), Some(icon)) = (menu, default_icon) {
                let _tray = tauri::tray::TrayIconBuilder::with_id("main")
                    .icon(icon)
                    .menu(&menu)
                    .tooltip("Clavis - Locked")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "toggle" => {
                            if let Some(win) = app.get_webview_window("main") {
                                if win.is_visible().unwrap_or(false) {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                        "lock" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = app_handle.state::<AppState>();
                                let mut db = state.db.lock_safe();
                                if db.is_some() {
                                    *db = None;
                                    let mut key = state.session_key.lock_safe();
                                    *key = None;
                                    let _ = app_handle.emit("vault-locked", ());
                                    if let Some(tray) = app_handle.tray_by_id("main") {
                                        let _ = tray.set_tooltip(Some("Clavis - Locked"));
                                    }
                                }
                            });
                        }
                        "autotype" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = vault::autotype::trigger_autotype_flow(&app_handle).await;
                            });
                        }
                        "exit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    })
                    .build(app);
            }

            // Register global shortcuts
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
            let ctrl_shift_v = Shortcut::new(
                Some(
                    tauri_plugin_global_shortcut::Modifiers::CONTROL
                        | tauri_plugin_global_shortcut::Modifiers::SHIFT,
                ),
                tauri_plugin_global_shortcut::Code::KeyV,
            );
            let cmd_shift_v = Shortcut::new(
                Some(
                    tauri_plugin_global_shortcut::Modifiers::SUPER
                        | tauri_plugin_global_shortcut::Modifiers::SHIFT,
                ),
                tauri_plugin_global_shortcut::Code::KeyV,
            );
            let _ = app.global_shortcut().register(ctrl_shift_v);
            let _ = app.global_shortcut().register(cmd_shift_v);

            // Adjust main window size and decorations based on initialization state
            let is_initialized = match vault::db::get_db_paths(app.handle()) {
                Ok((_, salt_path)) => salt_path.exists(),
                Err(_) => false,
            };

            if let Some(window) = app.get_webview_window("main") {
                if is_initialized {
                    let _ = window.set_decorations(true);
                    let _ = window.set_resizable(true);
                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                        width: 800.0,
                        height: 600.0,
                    }));
                } else {
                    let _ = window.set_decorations(false);
                    let _ = window.set_resizable(false);
                    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                        width: 640.0,
                        height: 480.0,
                    }));
                }

                if !start_minimized {
                    let _ = window.show();
                    let _ = window.center();
                }
            }

            // Spawn the background auto-backup worker
            let app_handle_clone = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    // Check every 60 seconds
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                    let state = app_handle_clone.state::<AppState>();
                    let pool_opt = {
                        state.db.lock_safe().clone()
                    };

                    if let Some(pool) = pool_opt {
                        let interval: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'backup_interval'")
                            .fetch_optional(&pool)
                            .await
                            .unwrap_or_default()
                            .unwrap_or_else(|| Some("Weekly".to_string()))
                            .unwrap_or_else(|| "Weekly".to_string());

                        if interval != "Off" && interval != "Pre-checkpoint" {
                            let last_backup_str: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = 'last_backup_timestamp'")
                                .fetch_optional(&pool)
                                .await
                                .unwrap_or_default()
                                .unwrap_or_default();

                            let last_backup: u64 = last_backup_str.parse().unwrap_or(0);
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs();

                            let diff = now.saturating_sub(last_backup);
                            let limit = if interval == "Daily" {
                                86400
                            } else {
                                86400 * 7 // Weekly
                            };

                            if diff >= limit {
                                if let Ok(path) = create_backup(state.clone(), app_handle_clone.clone()).await {
                                    let _ = sqlx::query("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_backup_timestamp', ?)")
                                        .bind(now.to_string())
                                        .execute(&pool)
                                        .await;
                                    println!("[Auto Backup] Secure snapshot created at: {}", path);
                                }
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            close_window,
            resize_to_main_window,
            open_url,
            create_vault,
            create_vault_with_security,
            get_password_hint,
            get_recovery_questions,
            recover_vault,
            estimate_password_strength,
            verify_recovery_answers,
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
            capture_source,
            set_screen_capture_protection,
            get_autotype_matches,
            submit_autotype_selection,
            update_autotype_shortcut,
            clear_all_shortcuts,
            show_native_notification,
            add_to_blocklist,
            remove_from_blocklist,
            export_vault_encrypted,
            export_vault_csv,
            parse_import_file,
            execute_import,
            create_backup,
            restore_backup,
            change_master_password,
            get_app_version,
            set_autostart,
            get_active_connections_count,
            write_text_file,
            attach_file_to_entry,
            list_attachments,
            download_attachment,
            delete_attachment,
            verify_master_password,
            detect_installed_browsers
        ])
        .build(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("FATAL: Tauri application build failed: {:?}", e);
            std::process::exit(1);
        });

    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            if label == "main" {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.hide();
                }
                api.prevent_close();
            }
        }
        tauri::RunEvent::Exit => {
            if let Ok(app_dir) = app_handle.path().app_data_dir() {
                #[cfg(unix)]
                {
                    let socket_path = app_dir.join("ipc.sock");
                    let _ = std::fs::remove_file(socket_path);
                }
            }
        }
        _ => {}
    });
}

#[cfg(unix)]
#[repr(C)]
struct rlimit {
    rlim_cur: u64,
    rlim_max: u64,
}

#[cfg(unix)]
extern "C" {
    fn setrlimit(resource: std::ffi::c_int, rlim: *const rlimit) -> std::ffi::c_int;
}

#[cfg(unix)]
const RLIMIT_CORE: std::ffi::c_int = 4;

#[cfg(unix)]
fn disable_core_dumps() {
    let limit = rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    unsafe {
        let _ = setrlimit(RLIMIT_CORE, &limit);
    }
}

#[cfg(target_os = "windows")]
extern "system" {
    fn SetErrorMode(uMode: u32) -> u32;
}

#[cfg(target_os = "windows")]
fn disable_core_dumps() {
    unsafe {
        let _ = SetErrorMode(0x0001 | 0x0002);
    }
}

#[cfg(not(any(unix, target_os = "windows")))]
fn disable_core_dumps() {}

#[tauri::command]
fn set_screen_capture_protection(window: tauri::Window, enabled: bool) -> Result<(), String> {
    let _ = window.set_content_protected(enabled);

    #[cfg(target_os = "linux")]
    {
        if std::env::var("DISPLAY").is_ok() {
            let val = if enabled { "1" } else { "0" };
            let _ = std::process::Command::new("xprop")
                .args([
                    "-name",
                    "clavis",
                    "-f",
                    "_NET_WM_BYPASS_COMPOSITOR",
                    "32c",
                    "-set",
                    "_NET_WM_BYPASS_COMPOSITOR",
                    val,
                ])
                .status();
            let _ = std::process::Command::new("xprop")
                .args([
                    "-name",
                    "Clavis",
                    "-f",
                    "_NET_WM_BYPASS_COMPOSITOR",
                    "32c",
                    "-set",
                    "_NET_WM_BYPASS_COMPOSITOR",
                    val,
                ])
                .status();
        }
    }

    Ok(())
}
