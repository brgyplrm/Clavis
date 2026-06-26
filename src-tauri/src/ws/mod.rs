use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_hdr_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use crate::vault::command::AppState;
use crate::error::{Error, Result};
use zeroize::Zeroize;

#[derive(Deserialize, Debug)]
pub struct ExtensionEnvelope {
    pub id: Option<String>,
    #[serde(flatten)]
    pub payload: ExtensionRequest,
}

#[derive(Serialize, Debug)]
pub struct ExtensionEnvelopeResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(flatten)]
    pub payload: ExtensionResponse,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum ExtensionRequest {
    #[serde(rename = "auth")]
    Auth { token: String },
    #[serde(rename = "get_status")]
    GetStatus,
    #[serde(rename = "list_entries")]
    ListEntries,
    #[serde(rename = "decrypt_entry")]
    DecryptEntry { entry_id: String },
    #[serde(rename = "create_entry")]
    CreateEntry {
        title: String,
        username: Option<String>,
        password: String,
    },
}

#[derive(Serialize, Debug)]
#[serde(tag = "type")]
pub enum ExtensionResponse {
    #[serde(rename = "auth_response")]
    AuthResponse { success: bool },
    #[serde(rename = "status_response")]
    StatusResponse { unlocked: bool },
    #[serde(rename = "entries_response")]
    EntriesResponse {
        entries: Vec<ExtensionEntrySummary>,
    },
    #[serde(rename = "decrypt_response")]
    DecryptResponse {
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        entry_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        password: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        totp: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "create_response")]
    CreateResponse {
        success: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Serialize, Debug)]
pub struct ExtensionEntrySummary {
    pub id: String,
    pub title: String,
    pub username: Option<String>,
    pub has_totp: bool,
}

/// Start the WebSocket server listening on 127.0.0.1:59001.
pub async fn start_server(app_handle: AppHandle) -> Result<()> {
    // Start the in-memory IPC server for native messaging
    start_ipc_server(app_handle.clone()).await?;

    // Automatically register the Native Messaging Host manifest for Chrome, Chromium, and Firefox!
    let _ = register_native_messaging_host(&app_handle);

    let addr = SocketAddr::from(([127, 0, 0, 1], 59001));
    let listener = TcpListener::bind(&addr).await?;

    while let Ok((stream, _)) = listener.accept().await {
        let app_handle_clone = app_handle.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(stream, app_handle_clone).await {
                eprintln!("Error handling connection: {:?}", e);
            }
        });
    }

    Ok(())
}

async fn handle_connection(stream: TcpStream, app_handle: AppHandle) -> Result<()> {
    let state = app_handle.state::<AppState>();
    let expected_token = state.ws_token.lock().unwrap().clone();

    // 1. Perform handshake and validate token in Sec-WebSocket-Protocol header
    use std::sync::atomic::{AtomicBool, Ordering};
    let is_valid = std::sync::Arc::new(AtomicBool::new(false));
    let is_valid_clone = is_valid.clone();
    let expected_token_clone = expected_token.clone();

    let ws_stream = accept_hdr_async(stream, move |request: &Request, mut response: Response| {
        if let Some(protocol) = request.headers().get("Sec-WebSocket-Protocol") {
            if let Ok(protocol_str) = protocol.to_str() {
                if protocol_str == expected_token_clone {
                    is_valid_clone.store(true, Ordering::SeqCst);
                    let headers = response.headers_mut();
                    headers.insert("Sec-WebSocket-Protocol", protocol.clone());
                }
            }
        }
        Ok(response)
    })
    .await
    .map_err(|e| Error::Totp(format!("WebSocket handshake failed: {}", e)))?;

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // If token validation failed, close immediately with code 1008 (Policy)
    if !is_valid.load(Ordering::SeqCst) {
        let close_frame = CloseFrame {
            code: CloseCode::Policy,
            reason: std::borrow::Cow::Borrowed("Policy Violation"),
        };
        let _ = ws_sender.send(Message::Close(Some(close_frame))).await;
        return Ok(());
    }

    // Auth succeeded - notify the client immediately
    let resp = ExtensionEnvelopeResponse {
        id: None,
        payload: ExtensionResponse::AuthResponse { success: true },
    };
    ws_sender.send(Message::Text(serde_json::to_string(&resp).unwrap()))
        .await
        .map_err(|e| Error::Totp(e.to_string()))?;

    // 2. Start request handling loop
    while let Some(msg_result) = ws_receiver.next().await {
        // Active session invalidation check on lock/rotation
        {
            let current_token = state.ws_token.lock().unwrap().clone();
            if current_token.is_empty() || current_token != expected_token {
                break;
            }
        }

        let msg = match msg_result {
            Ok(m) => m,
            Err(e) => {
                eprintln!("WS read error: {:?}", e);
                break;
            }
        };

        if msg.is_close() {
            break;
        }

        if let Message::Text(text) = msg {
            let req: ExtensionEnvelope = match serde_json::from_str(&text) {
                Ok(r) => r,
                Err(e) => {
                    let resp = ExtensionEnvelopeResponse {
                        id: None,
                        payload: ExtensionResponse::Error { message: format!("Invalid request JSON: {}", e) },
                    };
                    let _ = ws_sender.send(Message::Text(serde_json::to_string(&resp).unwrap())).await;
                    continue;
                }
            };

            let response = process_request(&req.payload, &state).await;
            let resp_envelope = ExtensionEnvelopeResponse {
                id: req.id,
                payload: response,
            };
            let resp_str = serde_json::to_string(&resp_envelope).unwrap();
            if ws_sender.send(Message::Text(resp_str)).await.is_err() {
                break;
            }
        }
    }

    Ok(())
}

async fn process_request(req: &ExtensionRequest, state: &AppState) -> ExtensionResponse {
    match req {
        ExtensionRequest::Auth { .. } => ExtensionResponse::Error {
            message: "Already authenticated".to_string(),
        },
        ExtensionRequest::GetStatus => {
            let unlocked = state.db.lock().unwrap().is_some();
            ExtensionResponse::StatusResponse { unlocked }
        }
        ExtensionRequest::ListEntries => {
            let pool_opt = state.db.lock().unwrap().clone();
            let pool = match pool_opt {
                Some(p) => p,
                None => return ExtensionResponse::Error { message: "vault_locked".to_string() },
            };

            match sqlx::query("SELECT id, title, username, totp_secret FROM entries ORDER BY title ASC")
                .fetch_all(&pool)
                .await
            {
                Ok(rows) => {
                    let mut entries = Vec::new();
                    for row in rows {
                        use sqlx::Row;
                        let id: String = row.get("id");
                        let title: String = row.get("title");
                        let username: Option<String> = row.get("username");
                        let totp_blob: Option<Vec<u8>> = row.get("totp_secret");
                        entries.push(ExtensionEntrySummary {
                            id,
                            title,
                            username,
                            has_totp: totp_blob.is_some(),
                        });
                    }
                    ExtensionResponse::EntriesResponse { entries }
                }
                Err(e) => ExtensionResponse::Error { message: format!("Database error: {}", e) },
            }
        }
        ExtensionRequest::DecryptEntry { entry_id } => {
            let pool_opt = state.db.lock().unwrap().clone();
            let pool = match pool_opt {
                Some(p) => p,
                None => return ExtensionResponse::DecryptResponse { success: false, entry_id: None, title: None, username: None, password: None, totp: None, error: Some("vault_locked".to_string()) },
            };

            let row_res = sqlx::query("SELECT id, title, username, ciphertext, nonce, totp_secret FROM entries WHERE id = ?")
                .bind(entry_id)
                .fetch_optional(&pool)
                .await;

            let row = match row_res {
                Ok(Some(r)) => r,
                Ok(None) => return ExtensionResponse::DecryptResponse { success: false, entry_id: None, title: None, username: None, password: None, totp: None, error: Some("entry_not_found".to_string()) },
                Err(e) => return ExtensionResponse::DecryptResponse { success: false, entry_id: None, title: None, username: None, password: None, totp: None, error: Some(format!("Database error: {}", e)) },
            };

            use sqlx::Row;
            let title: String = row.get("title");
            let username: Option<String> = row.get("username");
            let ciphertext: Vec<u8> = row.get("ciphertext");
            let nonce: Vec<u8> = row.get("nonce");
            let totp_blob: Option<Vec<u8>> = row.get("totp_secret");

            let decrypted_res = {
                let guard = state.session_key.lock().unwrap();
                let session_key = match guard.as_ref() {
                    Some(key) => key,
                    None => return ExtensionResponse::DecryptResponse { success: false, entry_id: None, title: None, username: None, password: None, totp: None, error: Some("vault_locked".to_string()) },
                };

                let password_bytes_res = crate::crypto::cipher::decrypt(&**session_key, &ciphertext, &nonce);
                let password_res = match password_bytes_res {
                    Ok(bytes) => match String::from_utf8(bytes) {
                        Ok(s) => Ok(s),
                        Err(e) => Err(format!("Invalid UTF-8 in password: {}", e)),
                    },
                    Err(e) => Err(format!("Decryption failed: {}", e)),
                };

                let totp_res = if let Some(blob) = totp_blob {
                    if blob.len() < 12 {
                        Err("Invalid TOTP blob length".to_string())
                    } else {
                        let (totp_nonce, totp_cipher) = blob.split_at(12);
                        match crate::crypto::cipher::decrypt(&**session_key, totp_cipher, totp_nonce) {
                            Ok(bytes) => match String::from_utf8(bytes) {
                                Ok(s) => Ok(Some(s)),
                                Err(e) => Err(format!("Invalid UTF-8 in TOTP secret: {}", e)),
                            },
                            Err(e) => Err(format!("Decryption failed: {}", e)),
                        }
                    }
                } else {
                    Ok(None)
                };

                (password_res, totp_res)
            };

            let (password_res, totp_secret_res) = decrypted_res;

            let mut password = match password_res {
                Ok(p) => p,
                Err(e) => return ExtensionResponse::DecryptResponse { success: false, entry_id: None, title: None, username: None, password: None, totp: None, error: Some(e) },
            };

            let totp_secret = match totp_secret_res {
                Ok(t) => t,
                Err(e) => {
                    password.zeroize();
                    return ExtensionResponse::DecryptResponse { success: false, entry_id: None, title: None, username: None, password: None, totp: None, error: Some(e) };
                }
            };

            let totp_code = if let Some(mut secret_str) = totp_secret {
                let cleaned_secret = zeroize::Zeroizing::new(
                    secret_str
                        .replace(' ', "")
                        .replace('-', "")
                        .to_uppercase(),
                );
                secret_str.zeroize();

                let secret = totp_rs::Secret::Encoded(cleaned_secret.to_string());
                let code_opt = if let Ok(bytes) = secret.to_bytes() {
                    if let Ok(totp) = totp_rs::TOTP::new(totp_rs::Algorithm::SHA1, 6, 1, 30, bytes) {
                        totp.generate_current().ok()
                    } else {
                        None
                    }
                } else {
                    None
                };
                code_opt
            } else {
                None
            };

            let resp = ExtensionResponse::DecryptResponse {
                success: true,
                entry_id: Some(entry_id.clone()),
                title: Some(title),
                username,
                password: Some(password.clone()),
                totp: totp_code,
                error: None,
            };

            password.zeroize();

            resp
        }
        ExtensionRequest::CreateEntry { title, username, password } => {
            let pool_opt = state.db.lock().unwrap().clone();
            let pool = match pool_opt {
                Some(p) => p,
                None => return ExtensionResponse::CreateResponse { success: false, error: Some("vault_locked".to_string()) },
            };

            // Get the first vault in the database to save the entry in
            let vault_id: String = match sqlx::query_scalar("SELECT id FROM vaults LIMIT 1")
                .fetch_one(&pool)
                .await
            {
                Ok(id) => id,
                Err(e) => return ExtensionResponse::CreateResponse { success: false, error: Some(format!("No vault found in database: {}", e)) },
            };

            let id = uuid::Uuid::new_v4().to_string();
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;

            // Lock and encrypt the password
            let (ciphertext, nonce) = {
                let guard = state.session_key.lock().unwrap();
                let session_key = match guard.as_ref() {
                    Some(key) => key,
                    None => return ExtensionResponse::CreateResponse { success: false, error: Some("vault_locked".to_string()) },
                };

                match crate::crypto::cipher::encrypt(&**session_key, password.as_bytes()) {
                    Ok(res) => res,
                    Err(e) => return ExtensionResponse::CreateResponse { success: false, error: Some(format!("Encryption failed: {}", e)) },
                }
            };

            match sqlx::query(
                "INSERT INTO entries (id, vault_id, title, username, ciphertext, nonce, totp_secret, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)"
            )
            .bind(&id)
            .bind(&vault_id)
            .bind(title)
            .bind(username)
            .bind(&ciphertext)
            .bind(&nonce)
            .bind(now)
            .bind(now)
            .execute(&pool)
            .await
            {
                Ok(_) => ExtensionResponse::CreateResponse { success: true, error: None },
                Err(e) => ExtensionResponse::CreateResponse { success: false, error: Some(format!("Database error: {}", e)) },
            }
        }
    }
}

pub fn register_native_messaging_host(_app_handle: &AppHandle) -> Result<()> {
    let current_exe = std::env::current_exe()
        .map_err(|e| Error::Io(e))?;
    let mut bridge_exe = current_exe.clone();
    bridge_exe.set_file_name("clavis-bridge");
    let exe_path = bridge_exe.to_string_lossy().to_string();

    let home = std::env::var("HOME").unwrap_or_default();
    if home.is_empty() {
        return Ok(());
    }

    let manifest_name = "com.achyllisss.clavis";

    let chrome_origins = vec![
        "chrome-extension://bnalgnlpnmlnfflconnhgggaoabkdbok/".to_string()
    ];

    let firefox_extensions = vec![
        "clavis@achyllisss.com".to_string()
    ];

    let chrome_manifest = serde_json::json!({
        "name": manifest_name,
        "description": "Clavis Browser Companion Broker",
        "path": exe_path,
        "type": "stdio",
        "allowed_origins": chrome_origins
    });

    let firefox_manifest = serde_json::json!({
        "name": manifest_name,
        "description": "Clavis Browser Companion Broker",
        "path": exe_path,
        "type": "stdio",
        "allowed_extensions": firefox_extensions
    });

    let chrome_dir = std::path::PathBuf::from(&home)
        .join(".config")
        .join("google-chrome")
        .join("NativeMessagingHosts");
    let chromium_dir = std::path::PathBuf::from(&home)
        .join(".config")
        .join("chromium")
        .join("NativeMessagingHosts");
    let firefox_dir = std::path::PathBuf::from(&home)
        .join(".mozilla")
        .join("native-messaging-hosts");
    let floorp_dir = std::path::PathBuf::from(&home)
        .join(".floorp")
        .join("native-messaging-hosts");

    if let Err(e) = std::fs::create_dir_all(&chrome_dir) {
        eprintln!("Failed to create Google Chrome NativeMessagingHosts dir: {:?}", e);
    } else {
        let manifest_path = chrome_dir.join(format!("{}.json", manifest_name));
        let _ = std::fs::write(&manifest_path, serde_json::to_string_pretty(&chrome_manifest).unwrap());
    }

    if let Err(e) = std::fs::create_dir_all(&chromium_dir) {
        eprintln!("Failed to create Chromium NativeMessagingHosts dir: {:?}", e);
    } else {
        let manifest_path = chromium_dir.join(format!("{}.json", manifest_name));
        let _ = std::fs::write(&manifest_path, serde_json::to_string_pretty(&chrome_manifest).unwrap());
    }

    if let Err(e) = std::fs::create_dir_all(&firefox_dir) {
        eprintln!("Failed to create Firefox native-messaging-hosts dir: {:?}", e);
    } else {
        let manifest_path = firefox_dir.join(format!("{}.json", manifest_name));
        let _ = std::fs::write(&manifest_path, serde_json::to_string_pretty(&firefox_manifest).unwrap());
    }

    if let Err(e) = std::fs::create_dir_all(&floorp_dir) {
        eprintln!("Failed to create Floorp native-messaging-hosts dir: {:?}", e);
    } else {
        let manifest_path = floorp_dir.join(format!("{}.json", manifest_name));
        let _ = std::fs::write(&manifest_path, serde_json::to_string_pretty(&firefox_manifest).unwrap());
    }

    // Register Flatpak wrapper if any Flatpak sandboxed browsers are detected
    let flatpak_dirs = vec![
        (
            "one.ablaze.floorp",
            std::path::PathBuf::from(&home)
                .join(".var")
                .join("app")
                .join("one.ablaze.floorp")
                .join(".floorp")
                .join("native-messaging-hosts"),
            true,
        ),
        (
            "one.ablaze.floorp",
            std::path::PathBuf::from(&home)
                .join(".var")
                .join("app")
                .join("one.ablaze.floorp")
                .join(".mozilla")
                .join("native-messaging-hosts"),
            true,
        ),
        (
            "org.mozilla.firefox",
            std::path::PathBuf::from(&home)
                .join(".var")
                .join("app")
                .join("org.mozilla.firefox")
                .join(".mozilla")
                .join("native-messaging-hosts"),
            true,
        ),
        (
            "com.google.Chrome",
            std::path::PathBuf::from(&home)
                .join(".var")
                .join("app")
                .join("com.google.Chrome")
                .join(".config")
                .join("google-chrome")
                .join("NativeMessagingHosts"),
            false,
        ),
        (
            "org.chromium.Chromium",
            std::path::PathBuf::from(&home)
                .join(".var")
                .join("app")
                .join("org.chromium.Chromium")
                .join(".config")
                .join("chromium")
                .join("NativeMessagingHosts"),
            false,
        ),
    ];

    for (app_id, flatpak_dir, is_firefox) in flatpak_dirs {
        let app_base = std::path::PathBuf::from(&home)
            .join(".var")
            .join("app")
            .join(app_id);
        if app_base.exists() {
            if let Err(e) = std::fs::create_dir_all(&flatpak_dir) {
                eprintln!("Failed to create Flatpak {} native-messaging-hosts dir: {:?}", app_id, e);
                continue;
            }

            let wrapper_path = flatpak_dir.join(format!("{}-wrapper", manifest_name));
            let wrapper_content = format!(
                "#!/bin/bash\nLOG_FILE=\"$HOME/clavis-wrapper.log\"\necho \"[$(date)] Wrapper started with args: $@\" >> \"$LOG_FILE\"\nflatpak-spawn --host {} \"$@\" 2>> \"$LOG_FILE\"\nCODE=$?\necho \"[$(date)] Wrapper finished with exit code: $CODE\" >> \"$LOG_FILE\"\nexit $CODE\n",
                exe_path
            );
            if std::fs::write(&wrapper_path, wrapper_content).is_ok() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if let Ok(metadata) = std::fs::metadata(&wrapper_path) {
                        let mut perms = metadata.permissions();
                        perms.set_mode(0o755);
                        let _ = std::fs::set_permissions(&wrapper_path, perms);
                    }
                }
            }

            let wrapper_path_str = wrapper_path.to_string_lossy().to_string();
            let manifest = if is_firefox {
                serde_json::json!({
                    "name": manifest_name,
                    "description": "Clavis Browser Companion Broker (Flatpak wrapper)",
                    "path": wrapper_path_str,
                    "type": "stdio",
                    "allowed_extensions": firefox_extensions
                })
            } else {
                serde_json::json!({
                    "name": manifest_name,
                    "description": "Clavis Browser Companion Broker (Flatpak wrapper)",
                    "path": wrapper_path_str,
                    "type": "stdio",
                    "allowed_origins": chrome_origins
                })
            };

            let manifest_path = flatpak_dir.join(format!("{}.json", manifest_name));
            let _ = std::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap());
        }
    }

    Ok(())
}

fn get_app_data_dir() -> Option<std::path::PathBuf> {
    let bundle_id = "com.achyllisss.clavis";
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(|p| std::path::PathBuf::from(p).join(bundle_id))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(|h| {
            std::path::PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join(bundle_id)
        })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // Linux/Unix fallback
        let home = std::env::var("HOME").ok()?;
        let xdg_data = std::env::var("XDG_DATA_HOME")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(home).join(".local").join("share"));
        Some(xdg_data.join(bundle_id))
    }
}

#[cfg(unix)]
async fn start_ipc_server(app_handle: AppHandle) -> Result<()> {
    let app_dir = app_handle.path().app_data_dir()
        .map_err(|e| Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
    let socket_path = app_dir.join("ipc.sock");
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }
    if !app_dir.exists() {
        let _ = std::fs::create_dir_all(&app_dir);
    }
    let listener = tokio::net::UnixListener::bind(&socket_path)
        .map_err(|e| Error::Io(e))?;

    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let state = app_handle.state::<AppState>();
            let current_token = state.ws_token.lock().unwrap().clone();
            let response = serde_json::json!({
                "success": true,
                "port": 59001,
                "token": current_token
            });
            if let Ok(resp_str) = serde_json::to_string(&response) {
                use tokio::io::AsyncWriteExt;
                let _ = stream.write_all(resp_str.as_bytes()).await;
            }
        }
    });
    Ok(())
}

#[cfg(windows)]
async fn start_ipc_server(app_handle: AppHandle) -> Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = r"\\.\pipe\com.achyllisss.clavis.ipc";

    tokio::spawn(async move {
        loop {
            let mut server = match ServerOptions::new()
                .first_pipe_instance(true)
                .create(pipe_name)
            {
                Ok(s) => s,
                Err(_) => {
                    match ServerOptions::new().create(pipe_name) {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("Failed to create named pipe instance: {:?}", e);
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            continue;
                        }
                    }
                }
            };

            if server.connect().await.is_ok() {
                let state = app_handle.state::<AppState>();
                let current_token = state.ws_token.lock().unwrap().clone();
                let response = serde_json::json!({
                    "success": true,
                    "port": 59001,
                    "token": current_token
                });
                if let Ok(resp_str) = serde_json::to_string(&response) {
                    use tokio::io::AsyncWriteExt;
                    let _ = server.write_all(resp_str.as_bytes()).await;
                }
            }
        }
    });
    Ok(())
}

fn query_ipc_server() -> serde_json::Value {
    let app_dir = match get_app_data_dir() {
        Some(dir) => dir,
        None => return serde_json::json!({ "success": false, "error": "Could not resolve app data directory" }),
    };

    #[cfg(unix)]
    {
        use std::os::unix::net::UnixStream;
        use std::io::Read;

        let socket_path = app_dir.join("ipc.sock");
        let mut stream = match UnixStream::connect(&socket_path) {
            Ok(s) => s,
            Err(e) => return serde_json::json!({ "success": false, "error": format!("Could not connect to IPC socket: {}", e) }),
        };

        let mut buf = String::new();
        if stream.read_to_string(&mut buf).is_ok() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&buf) {
                val
            } else {
                serde_json::json!({ "success": false, "error": "Invalid IPC response format" })
            }
        } else {
            serde_json::json!({ "success": false, "error": "Could not read from IPC socket" })
        }
    }

    #[cfg(windows)]
    {
        use std::io::Read;
        use std::fs::OpenOptions;

        let pipe_name = r"\\.\pipe\com.achyllisss.clavis.ipc";
        let mut file = match OpenOptions::new()
            .read(true)
            .write(true)
            .open(pipe_name)
        {
            Ok(f) => f,
            Err(e) => return serde_json::json!({ "success": false, "error": format!("Could not connect to Named Pipe: {}", e) }),
        };

        let mut buf = String::new();
        if file.read_to_string(&mut buf).is_ok() {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&buf) {
                val
            } else {
                serde_json::json!({ "success": false, "error": "Invalid IPC response format" })
            }
        } else {
            serde_json::json!({ "success": false, "error": "Could not read from Named Pipe" })
        }
    }
}

pub fn run_native_messaging() {
    if let Some(app_dir) = get_app_data_dir() {
        let log_path = app_dir.join("native-messaging.log");
        let _ = std::fs::write(&log_path, format!("[{:?}] Native Messaging Host started.\n", std::time::SystemTime::now()));
    }

    use std::io::{self, Read, Write};

    let stdin = io::stdin();
    let mut stdin_handle = stdin.lock();
    let stdout = io::stdout();
    let mut stdout_handle = stdout.lock();

    loop {
        let mut len_bytes = [0u8; 4];
        if stdin_handle.read_exact(&mut len_bytes).is_err() {
            break;
        }
        let len = u32::from_ne_bytes(len_bytes) as usize;

        let mut buf = vec![0u8; len];
        if stdin_handle.read_exact(&mut buf).is_err() {
            break;
        }

        let response = query_ipc_server();

        let response_str = response.to_string();
        let response_bytes = response_str.as_bytes();
        let resp_len = response_bytes.len() as u32;

        if stdout_handle.write_all(&resp_len.to_ne_bytes()).is_err() {
            break;
        }
        if stdout_handle.write_all(response_bytes).is_err() {
            break;
        }
        let _ = stdout_handle.flush();
    }
}
