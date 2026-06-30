use crate::error::{Error, Result};
use sha1::{Digest, Sha1};
use std::fs;
use tauri::{AppHandle, Manager};
use zeroize::Zeroizing;

#[derive(serde::Serialize)]
pub struct BreachCheckResponse {
    pub count: u32,
}

/// Checks if a password has been breached using the HaveIBeenPwned range API.
/// Employs k-anonymity by only sending the first 5 characters of the SHA-1 hash.
#[tauri::command]
pub async fn check_password_breached(password: String) -> Result<BreachCheckResponse> {
    // Wrap password in Zeroizing to guarantee deletion from heap
    let password_zero = Zeroizing::new(password);

    // 1. Compute SHA-1 hash locally
    let mut hasher = Sha1::new();
    hasher.update(password_zero.as_bytes());
    let hash_result = hasher.finalize();

    // Hex-encode and wrap the full hash in Zeroizing
    let hash_hex = hex::encode(hash_result).to_uppercase();
    let hash_zero = Zeroizing::new(hash_hex);

    if hash_zero.len() < 40 {
        return Err(Error::Breach("Invalid SHA-1 hash length".to_string()));
    }

    let prefix = &hash_zero[0..5];
    let suffix = &hash_zero[5..40];

    // 2. Fetch hashes sharing the prefix from HIBP API (using rustls-tls for HTTPS)
    let url = format!("https://api.pwnedpasswords.com/range/{}", prefix);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| Error::Breach(format!("Failed to build client: {}", e)))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| Error::Breach(format!("API request failed: {}", e)))?;

    if !response.status().is_success() {
        return Err(Error::Breach(format!(
            "API returned status: {}",
            response.status()
        )));
    }

    let body = response
        .text()
        .await
        .map_err(|e| Error::Breach(format!("Failed to read response body: {}", e)))?;

    // 3. Compare suffixes locally
    let mut count = 0;
    for line in body.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() == 2 {
            let line_suffix = parts[0].trim();
            if line_suffix == suffix {
                count = parts[1].trim().parse::<u32>().unwrap_or(0);
                break;
            }
        }
    }

    // Zeroizing drops automatically clear original password and hash strings from memory here

    Ok(BreachCheckResponse { count })
}

/// Fetches the latest list of data breaches from HaveIBeenPwned and caches it locally.
#[tauri::command]
pub async fn update_breaches_cache(app_handle: AppHandle) -> Result<String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let cache_path = app_dir.join("breaches.json");

    let url = "https://haveibeenpwned.com/api/v3/breaches";
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| Error::Breach(format!("Failed to build client: {}", e)))?;

    let response = client
        .get(url)
        .header("User-Agent", "Clavis Password Manager")
        .send()
        .await
        .map_err(|e| Error::Breach(format!("Failed to fetch breaches: {}", e)))?;

    if !response.status().is_success() {
        return Err(Error::Breach(format!(
            "API returned status: {}",
            response.status()
        )));
    }

    let text = response
        .text()
        .await
        .map_err(|e| Error::Breach(format!("Failed to read body: {}", e)))?;

    fs::write(&cache_path, &text)?;

    Ok(text)
}

/// Reads the cached list of data breaches if it exists.
#[tauri::command]
pub async fn get_cached_breaches(app_handle: AppHandle) -> Result<Option<String>> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| {
        Error::Io(std::io::Error::new(
            std::io::ErrorKind::Other,
            e.to_string(),
        ))
    })?;
    let cache_path = app_dir.join("breaches.json");

    if cache_path.exists() {
        let content = fs::read_to_string(cache_path)?;
        Ok(Some(content))
    } else {
        Ok(None)
    }
}
