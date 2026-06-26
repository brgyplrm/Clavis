use std::io::{self, Read, Write};
use std::path::PathBuf;

fn get_app_data_dir() -> Option<PathBuf> {
    let bundle_id = "com.achyllisss.clavis";
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA").ok().map(|p| PathBuf::from(p).join(bundle_id))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var("HOME").ok().map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join(bundle_id)
        })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").ok()?;
        let xdg_data = std::env::var("XDG_DATA_HOME")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(home).join(".local").join("share"));
        Some(xdg_data.join(bundle_id))
    }
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
            Err(e) => {
                // Fallback to standard host directory path in case XDG_DATA_HOME was overridden by Flatpak
                let home = std::env::var("HOME").unwrap_or_default();
                let fallback_path = PathBuf::from(home)
                    .join(".local")
                    .join("share")
                    .join("com.achyllisss.clavis")
                    .join("ipc.sock");
                match UnixStream::connect(&fallback_path) {
                    Ok(s) => s,
                    Err(_) => return serde_json::json!({ "success": false, "error": format!("Could not connect to IPC socket: {}", e) }),
                }
            }
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

fn main() {
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
