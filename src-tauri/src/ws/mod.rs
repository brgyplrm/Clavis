use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;
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
    DecryptEntry { id: String },
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
        id: Option<String>,
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

/// Start the WebSocket server listening on 127.0.0.1:32200.
pub async fn start_server(app_handle: AppHandle) -> Result<()> {
    let state = app_handle.state::<AppState>();
    let token = state.ws_token.clone();

    // Write the ws.json file with the port and token
    if let Ok(app_dir) = app_handle.path().app_data_dir() {
        if !app_dir.exists() {
            let _ = std::fs::create_dir_all(&app_dir);
        }
        let ws_info_path = app_dir.join("ws.json");
        let ws_info = serde_json::json!({
            "port": 32200,
            "token": token
        });
        if let Ok(ws_info_str) = serde_json::to_string(&ws_info) {
            let _ = std::fs::write(&ws_info_path, ws_info_str);
        }
    }

    // Automatically register the Native Messaging Host manifest for Chrome, Chromium, and Firefox!
    let _ = register_native_messaging_host(&app_handle);

    let addr = SocketAddr::from(([127, 0, 0, 1], 32200));
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
    let ws_stream = accept_async(stream)
        .await
        .map_err(|e| Error::Totp(format!("WebSocket handshake failed: {}", e)))?;

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let state = app_handle.state::<AppState>();
    let expected_token = state.ws_token.clone();

    // 1. Perform authentication within a 5-second timeout
    let auth_future = async {
        if let Some(msg_result) = ws_receiver.next().await {
            let msg = msg_result.map_err(|e| Error::Totp(e.to_string()))?;
            if let Message::Text(text) = msg {
                if let Ok(req) = serde_json::from_str::<ExtensionEnvelope>(&text) {
                    if let ExtensionRequest::Auth { token } = req.payload {
                        if token == expected_token {
                            return std::result::Result::<bool, Error>::Ok(true);
                        }
                    }
                }
            }
        }
        std::result::Result::<bool, Error>::Ok(false)
    };

    let auth_success = tokio::time::timeout(std::time::Duration::from_secs(5), auth_future)
        .await
        .map_err(|_| Error::Totp("Auth timeout".to_string()))?
        .unwrap_or(false);

    if !auth_success {
        let resp = ExtensionEnvelopeResponse {
            id: None,
            payload: ExtensionResponse::AuthResponse { success: false },
        };
        let _ = ws_sender.send(Message::Text(serde_json::to_string(&resp).unwrap())).await;
        return Ok(());
    }

    // Auth succeeded
    let resp = ExtensionEnvelopeResponse {
        id: None,
        payload: ExtensionResponse::AuthResponse { success: true },
    };
    ws_sender.send(Message::Text(serde_json::to_string(&resp).unwrap()))
        .await
        .map_err(|e| Error::Totp(e.to_string()))?;

    // 2. Start request handling loop
    while let Some(msg_result) = ws_receiver.next().await {
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
        ExtensionRequest::DecryptEntry { id } => {
            let pool_opt = state.db.lock().unwrap().clone();
            let pool = match pool_opt {
                Some(p) => p,
                None => return ExtensionResponse::DecryptResponse { success: false, id: None, title: None, username: None, password: None, totp: None, error: Some("vault_locked".to_string()) },
            };

            let row_res = sqlx::query("SELECT id, title, username, ciphertext, nonce, totp_secret FROM entries WHERE id = ?")
                .bind(id)
                .fetch_optional(&pool)
                .await;

            let row = match row_res {
                Ok(Some(r)) => r,
                Ok(None) => return ExtensionResponse::DecryptResponse { success: false, id: None, title: None, username: None, password: None, totp: None, error: Some("entry_not_found".to_string()) },
                Err(e) => return ExtensionResponse::DecryptResponse { success: false, id: None, title: None, username: None, password: None, totp: None, error: Some(format!("Database error: {}", e)) },
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
                    None => return ExtensionResponse::DecryptResponse { success: false, id: None, title: None, username: None, password: None, totp: None, error: Some("vault_locked".to_string()) },
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
                Err(e) => return ExtensionResponse::DecryptResponse { success: false, id: None, title: None, username: None, password: None, totp: None, error: Some(e) },
            };

            let totp_secret = match totp_secret_res {
                Ok(t) => t,
                Err(e) => {
                    password.zeroize();
                    return ExtensionResponse::DecryptResponse { success: false, id: None, title: None, username: None, password: None, totp: None, error: Some(e) };
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
                id: Some(id.clone()),
                title: Some(title),
                username,
                password: Some(password.clone()),
                totp: totp_code,
                error: None,
            };

            password.zeroize();

            resp
        }
    }
}

pub fn register_native_messaging_host(_app_handle: &AppHandle) -> Result<()> {
    let current_exe = std::env::current_exe()
        .map_err(|e| Error::Io(e))?;
    let exe_path = current_exe.to_string_lossy().to_string();

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

    Ok(())
}

pub fn run_native_messaging() {
    use std::io::{self, Read, Write};
    use serde_json::json;

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

        let home = std::env::var("HOME").unwrap_or_default();
        let ws_path = std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.achyllisss.clavis")
            .join("ws.json");

        let response = if ws_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&ws_path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    json!({
                        "success": true,
                        "port": 32200,
                        "token": val.get("token")
                    })
                } else {
                    json!({ "success": false, "error": "Invalid ws.json format" })
                }
            } else {
                json!({ "success": false, "error": "Could not read ws.json" })
            }
        } else {
            json!({ "success": false, "error": "Vault is locked or Clavis is not running" })
        };

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
