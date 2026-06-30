// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args
        .iter()
        .any(|arg| arg.starts_with("chrome-extension://") || arg.contains("com.achyllisss.clavis"))
    {
        clavis_lib::ws::run_native_messaging();
        return;
    }
    clavis_lib::run();
}
