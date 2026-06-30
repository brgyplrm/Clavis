use tauri::{AppHandle, Manager};

/// Displays a native OS desktop notification if the app window is currently out of focus.
/// It uses native FFI commands depending on the host operating system.
#[tauri::command]
pub fn show_native_notification(title: String, body: String, app_handle: AppHandle) {
    // Determine focus state to prevent spamming native notifications when user is looking at the app
    let is_focused = if let Some(window) = app_handle.get_webview_window("main") {
        window.is_focused().unwrap_or(false)
    } else {
        false
    };

    if !is_focused {
        #[cfg(target_os = "linux")]
        {
            let _ = std::process::Command::new("notify-send")
                .arg(&title)
                .arg(&body)
                .spawn();
        }

        #[cfg(target_os = "macos")]
        {
            let script = format!("display notification \"{}\" with title \"{}\"", body, title);
            let _ = std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn();
        }

        #[cfg(target_os = "windows")]
        {
            let script = format!(
                "[void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); \
                 $objNotification = New-Object System.Windows.Forms.NotifyIcon; \
                 $objNotification.Icon = [System.Drawing.SystemIcons]::Information; \
                 $objNotification.BalloonTipText = '{}'; \
                 $objNotification.BalloonTipTitle = '{}'; \
                 $objNotification.Visible = $True; \
                 $objNotification.ShowBalloonTip(5000);",
                body.replace("'", "''"), title.replace("'", "''")
            );
            let _ = std::process::Command::new("powershell")
                .arg("-Command")
                .arg(&script)
                .spawn();
        }
    }
}
