use secrecy::ExposeSecret;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use ring::rand::{SecureRandom, SystemRandom};
use secrecy::SecretVec;

use crate::error::{Error, Result};

/// Encrypts plaintext bytes using AES-256-GCM and a derived session key.
/// Returns a tuple of (ciphertext, nonce).
pub fn encrypt(plaintext: &[u8], key: &SecretVec<u8>) -> Result<(Vec<u8>, Vec<u8>)> {
    let key_ref = key.expose_secret();
    if key_ref.len() != 32 {
        return Err(Error::Crypto("Invalid encryption key length".to_string()));
    }

    let cipher = Aes256Gcm::new_from_slice(key_ref)
        .map_err(|e| Error::Crypto(e.to_string()))?;

    // Generate secure 96-bit (12-byte) nonce
    let mut nonce_bytes = [0u8; 12];
    let rng = SystemRandom::new();
    rng.fill(&mut nonce_bytes)
        .map_err(|_| Error::Crypto("Failed to generate secure nonce".to_string()))?;

    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| Error::Crypto(e.to_string()))?;

    Ok((ciphertext, nonce_bytes.to_vec()))
}

/// Decrypts ciphertext bytes using AES-256-GCM and the derived session key.
pub fn decrypt(ciphertext: &[u8], nonce_bytes: &[u8], key: &SecretVec<u8>) -> Result<Vec<u8>> {
    let key_ref = key.expose_secret();
    if key_ref.len() != 32 {
        return Err(Error::Crypto("Invalid decryption key length".to_string()));
    }

    if nonce_bytes.len() != 12 {
        return Err(Error::Crypto("Invalid nonce length".to_string()));
    }

    let cipher = Aes256Gcm::new_from_slice(key_ref)
        .map_err(|e| Error::Crypto(e.to_string()))?;

    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| Error::Crypto(e.to_string()))?;

    Ok(plaintext)
}