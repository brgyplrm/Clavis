use ring::rand::{SecureRandom, SystemRandom};
use crate::error::{Error, Result};

/// Generates a strong, random password using ring::rand::SystemRandom (CSPRNG).
/// Implements rejection sampling to eliminate modulo bias.
#[tauri::command]
pub fn generate_password(
    length: usize,
    uppercase: bool,
    lowercase: bool,
    digits: bool,
    symbols: bool,
) -> Result<String> {
    if length < 8 || length > 64 {
        return Err(Error::Crypto("Length must be between 8 and 64 characters".to_string()));
    }

    let mut pool = String::new();
    if uppercase {
        pool.push_str("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    }
    if lowercase {
        pool.push_str("abcdefghijklmnopqrstuvwxyz");
    }
    if digits {
        pool.push_str("0123456789");
    }
    if symbols {
        pool.push_str("!@#$%^&*()_+-=[]{}|;:,.<>?");
    }

    if pool.is_empty() {
        return Err(Error::Crypto("At least one character set must be selected".to_string()));
    }

    let pool_bytes = pool.as_bytes();
    let set_size = pool_bytes.len();

    // Rejection sampling upper limit to guarantee no modulo bias
    let limit = 256 - (256 % set_size);

    let rng = SystemRandom::new();
    let mut password = String::with_capacity(length);

    let mut random_byte = [0u8; 1];
    while password.len() < length {
        rng.fill(&mut random_byte)
            .map_err(|_| Error::Crypto("Failed to generate secure random byte".to_string()))?;
        
        let byte = random_byte[0] as usize;
        if byte < limit {
            let index = byte % set_size;
            password.push(pool_bytes[index] as char);
        }
    }

    Ok(password)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_password_success() {
        let result = generate_password(16, true, true, true, true);
        assert!(result.is_ok());
        let pwd = result.unwrap();
        assert_eq!(pwd.len(), 16);
    }

    #[test]
    fn test_generate_password_invalid_length() {
        let result_short = generate_password(7, true, true, true, true);
        assert!(result_short.is_err());
        let result_long = generate_password(65, true, true, true, true);
        assert!(result_long.is_err());
    }

    #[test]
    fn test_generate_password_no_charsets() {
        let result = generate_password(16, false, false, false, false);
        assert!(result.is_err());
    }

    #[test]
    fn test_generate_password_only_digits() {
        let result = generate_password(20, false, false, true, false);
        assert!(result.is_ok());
        let pwd = result.unwrap();
        assert_eq!(pwd.len(), 20);
        for c in pwd.chars() {
            assert!(c.is_ascii_digit());
        }
    }
}

