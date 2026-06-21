# Clavis

A local-first desktop password manager. All data is encrypted on your device and never leaves it. There is no server, no cloud sync, and no telemetry.

---

## Overview

Clavis is a cross-platform desktop application built with Tauri 2, Rust, and React. It stores credentials in a SQLCipher-encrypted database in the OS app-data directory. A companion browser extension connects to the desktop app over a local WebSocket and handles form detection and credential autofill. A breach detection feature checks whether stored passwords have appeared in known data breaches using the HaveIBeenPwned API with k-anonymity, so the plaintext password never leaves the device.

---

## Stack

**Desktop**
- Tauri 2 (desktop shell)
- Rust (all backend logic)
- React 18 with TypeScript (UI)
- Vite (build tool)
- Tailwind CSS v4
- shadcn/ui (component library)
- Zustand (state management)
- react-hook-form and Zod (forms and validation)

**Rust crates**
- sqlx with SQLCipher for the encrypted database
- argon2 for key derivation (Argon2id, m=65536, t=3, p=4)
- aes-gcm for field-level encryption
- ring for random number generation
- zeroize for wiping key material from memory
- tokio and tokio-tungstenite for the local WebSocket server
- reqwest and sha1 for HIBP k-anonymity breach checks
- totp-rs for TOTP code generation

**Browser extension**
- Manifest V3 for Chrome, Edge, and Brave
- Manifest V2 for Firefox

---

## Security model

The master password is never stored anywhere. Clavis derives a 256-bit key from it using Argon2id and uses that key as the SQLCipher database key. The derived key is held in a zeroize-protected wrapper and wiped from memory when the session locks or the app closes.

Passwords in the database are stored as AES-256-GCM ciphertext alongside a freshly generated nonce. Plaintext passwords never appear in logs, IPC messages, or JavaScript state.

The browser extension authenticates to the desktop app using a one-time session token generated at startup and held only in memory. No credential fill occurs without explicit user approval in the extension popup.

Breach detection works by computing the SHA-1 hash of a password locally, sending only the first five hex characters to the HIBP API, receiving the list of hash suffixes back, and comparing locally. The full hash and plaintext password never leave the process.

Clipboard writes are cleared automatically after 30 seconds.

---

## Project structure

```
clavis/
  src/                    React frontend
    pages/
    components/
    hooks/
    lib/
      tauri.ts            Typed IPC wrappers
  src-tauri/
    src/
      vault/              Database logic and Tauri commands
      crypto/             Key derivation and encryption
      breach/             HIBP integration
      totp/               TOTP code generation
      ws/                 Local WebSocket server
      clipboard/          Clipboard management
      error.rs            Unified error type
    migrations/           Numbered SQL migration files
  extension/
    src/
      content.ts          Form detection and field filling
      background.ts       WebSocket connection
      popup/              Extension popup UI
```

---

## Development

Requirements: Rust (stable), Node.js 20+, and the Tauri CLI.

```bash
# Install dependencies
npm install

# Run in development
npm run tauri dev

# Build for production
npm run tauri build

# Run security audits
cargo audit
cargo deny check
```

---

## License

MIT
