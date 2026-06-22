# Clavis — Project Context

Last updated: June 2026
Status: Active development — scaffold and dependency setup in progress.

---

## What this app is

Clavis is a local-first desktop password manager. All credentials are stored in an encrypted database on the user's machine. There is no server, no cloud sync, and no telemetry of any kind. The app is built with Tauri 2 as the desktop shell, Rust for all backend logic, and React with TypeScript for the UI.

A companion browser extension connects to the desktop app over a local WebSocket and handles auto-detecting and filling login forms in the browser. A breach detection feature checks whether stored passwords have appeared in known data breaches using the HaveIBeenPwned API with k-anonymity, so the plaintext password never leaves the device.

---

## Stack

### Desktop — Backend (Rust)

| Concern | Crate |
|---|---|
| Desktop shell | tauri 2 |
| Encrypted database | sqlx with SQLCipher |
| Key derivation | argon2 (Argon2id, m=65536, t=3, p=4) |
| Field encryption | aes-gcm (AES-256-GCM) |
| Random number generation | ring::rand::SystemRandom |
| Memory wiping | zeroize |
| TOTP generation | totp-rs |
| WebSocket server | tokio + tokio-tungstenite |
| HIBP breach check | reqwest + sha1 |
| Error handling | thiserror + anyhow |
| UUID generation | uuid v4 |
| Secret wrapping | secrecy |

Only the crates listed above may make outbound network calls. No other crate is permitted to do so.

### Desktop — Frontend (React + TypeScript)

| Concern | Library |
|---|---|
| Framework | React 18 with TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (Radix, Nova preset) |
| State | Zustand |
| Forms | react-hook-form + Zod |
| Icons | lucide-react |
| IPC | Tauri invoke() via typed wrappers only |

### Browser Extension

| Target | Manifest |
|---|---|
| Chrome, Edge, Brave | Manifest V3 |
| Firefox | Manifest V2 |

---

## Security rules — never break these

**Master password** — never stored anywhere. Not on disk, not in logs, not in a variable that outlives the KDF call. Only the derived 256-bit key is used downstream, held in a zeroize-protected wrapper and wiped from memory when the session locks or the app closes.

**Plaintext passwords** — never stored anywhere. Not in the database, not in logs, not in IPC messages, not in JavaScript state. Passwords in the database are stored as AES-256-GCM ciphertext alongside a freshly generated nonce. The nonce must be generated per-encryption using ring::rand::SystemRandom.

**WebSocket authentication** — the browser extension connects to the Tauri WebSocket server using a one-time session token generated at startup and held only in memory. The extension reads this token via native messaging at launch. No fill operation happens without explicit user approval in the extension popup. The content script never auto-fills without a user action.

**HIBP k-anonymity flow** — compute the SHA-1 hash of the plaintext password locally, send only the first five hex characters to the HIBP API, receive the list of suffixes back, compare locally, return the breach count. The plaintext password and the full hash never leave the process.

**Clipboard** — writes must schedule an automatic clear after 30 seconds via a Tauri background task.

**Secrets** — never stored in environment variables, config files, or localStorage. All secrets live in the encrypted vault or in memory only.

**CI** — run cargo audit and cargo deny check on every push. Never merge code with unresolved audit findings.

Quick unlock methods (PIN, fingerprint) are 
shortcuts only — they never replace the master 
password as the root of key derivation. Quick 
unlock is only available after at least one 
successful master password unlock per app 
session. A full restart always requires the 
master password. The derived vault key is held 
in a zeroize-protected wrapper and is wiped on 
full lock. Biometric authentication is handled 
entirely by the OS (Windows Hello / Touch ID) 
via Tauri plugins — no biometric data ever 
touches PassVault's code or database. PIN 
attempts are limited to 5 before falling back 
to master password only.

---

## Project structure

```
Clavis/
  src/
    pages/                  One file per route/screen
    components/             Reusable UI components
    hooks/                  Custom React hooks
    lib/
      tauri.ts              All typed Tauri IPC wrappers — invoke() is never called directly elsewhere
  src-tauri/
    src/
      vault/                Database logic and Tauri commands
      crypto/               Key derivation and AES-GCM encryption
      breach/               HIBP k-anonymity integration
      totp/                 TOTP code generation
      ws/                   Local WebSocket server (127.0.0.1 only)
      clipboard/            Clipboard write and auto-clear
      error.rs              Unified error type used by all modules
      main.rs
      lib.rs
    migrations/
      0001_initial.sql      Applied automatically by sqlx at startup
  extension/
    src/
      content.ts            Form detection and field filling
      background.ts         WebSocket connection management
      popup/                Extension popup UI
    manifest.chrome.json
    manifest.firefox.json
  README.md
  .gitignore
  CONTEXT.md                This file
```

---

## Code style expectations

### Rust

- Use Result and the ? operator for all error propagation.
- Define a unified Error type in error.rs that all modules use.
- Never use unwrap() or expect() in production code paths.
- Document every public function with a doc comment covering what it does, its inputs, and its return value.
- Keep modules focused — no module does more than one thing.

### TypeScript

- strict: true in tsconfig, no any.
- All Tauri command inputs and outputs have explicit types defined in src/lib/tauri.ts.
- Every invoke() call is wrapped in a typed helper function. No other file calls invoke() directly.
- Components stay under roughly 200 lines. If a component exceeds that, split it.
- Business logic lives in hooks. Components stay presentational.

### General

- Write complete files — no placeholder comments like "rest of code here".
- When writing a Tauri command, always produce both the Rust handler and the corresponding TypeScript wrapper in the same response.
- When a security decision arises that is not covered here, default to the most conservative option and document the reasoning.
- When unsure whether a dependency is acceptable, ask before adding it.

---

## Build order

1. Tauri scaffold and project structure
2. SQLCipher integration and migrations
3. Crypto layer (key derivation, AES-GCM)
4. Lock and unlock flow
5. Vault CRUD (entries, folders, tags)
6. UI (pages, components, hooks)
7. TOTP support
8. Clipboard management
9. Breach detection via HIBP
10. Browser extension (WebSocket server first, then content script and popup)
11. CI pipeline (cargo audit, cargo deny, tests)

---

## Current status

Fedora Linux development machine.
Rust stable installed via rustup.
Node.js 22 and npm 10 confirmed.
Tauri system dependencies installed via dnf.
Frontend dependencies installed: zustand, react-hook-form, zod, lucide-react.
shadcn/ui init in progress — Tailwind CSS v4 configuration pending.
Nothing in src-tauri has been written yet.
Next step: complete Tailwind and shadcn setup, then begin the Tauri scaffold and src-tauri module structure.
