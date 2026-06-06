# CodexSwitcher

CodexSwitcher is a local-first profile and account switcher for the official OpenAI Codex desktop app. It is built with Rust on Tauri 2.0 and a React + TypeScript frontend with custom vanilla CSS, giving the app a dark, glassmorphic control-room interface without depending on external services for profile analysis.

---

## 🛠️ Technology Stack & Architecture

- **Backend**: Rust + Tauri 2.0
  - Secure credential storage through the system keychain via `keyring`
  - Process detection and lifecycle handling through `sysinfo`
  - Local SQLite analytics parsing through `rusqlite`
  - Offline JWT claim parsing from `auth.json` for plan, email, and display-name discovery
- **Frontend**: React + TypeScript + Vanilla CSS
  - Dark-mode-first styling with neon blue accents and glassmorphic cards
  - Roomier high-aspect-ratio layouts with stricter minimum window height constraints
  - Micro-animated loading and metrics feedback for smoother state transitions
- **Cross-platform desktop integration**
  - XDG-aware configuration storage on Linux under `~/.config/codex-switcher/`
  - Native Codex session detection and switching across macOS, Windows, and Linux
  - Platform keychain integration through `keyring`, including Secret Service support on Linux

---

## 🔒 Security Model

1. **Local and offline-first**
   - CodexSwitcher does not upload passwords, auth tokens, emails, or usage history anywhere. All profile scanning and metric generation happen on your machine.
2. **Secure OS keychain integration**
   - Optional app-lock credentials are stored in your platform keychain.
   - macOS: Keychain Services
   - Windows: Credential Manager
   - Linux: Secret Service / `libsecret`
3. **Zero secrets in logs**
   - The local activity log tracks app actions while filtering sensitive values such as tokens, passwords, cookies, and email addresses.
4. **Safe file operations**
   - Profile switching works on Codex data directories with explicit safety checks so file mutations stay inside approved locations.
   - SQLite databases are opened in read-only mode when analytics are scanned, reducing lock contention and protecting local Codex state from accidental writes.

---

## ⚡ How Profile Switching Works

1. **Capture the active state**
   - When you switch profiles, CodexSwitcher closes any running Codex process first so configuration files and SQLite databases are not left locked.
   - The current `~/.codex` contents are copied into the app-managed profiles directory.
2. **Restore the target profile**
   - The chosen profile is copied back into the active Codex directory and becomes the live configuration for the next launch.
3. **Hydrate local identity and analytics**
   - During boot and analytics refreshes, CodexSwitcher reads local profile data, parses offline JWT claims from `auth.json`, and inspects local SQLite/history files to populate plan badges and dashboard metrics.
4. **Relaunch Codex**
   - After the file swap completes, Codex can be launched again using the newly restored profile.

---

## ⚠️ Limitations

- **Profile swaps require a restart**
  - Codex loads its configuration on startup and can hold local databases open while running, so switching profiles still requires closing and relaunching the desktop app.
- **Expired sessions must be renewed in Codex**
  - If OpenAI expires the saved login for a profile, you still need to sign in again inside the official Codex app. CodexSwitcher only reads locally stored session metadata; it does not automate login.

---

## 🚀 Setup & Build Instructions

### Prerequisites

1. **Rust toolchain**
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. **Node.js**
   - Node.js 18+ and npm are required for the React frontend and Tauri workflow.
3. **Platform build tools**
   - macOS: Xcode Command Line Tools via `xcode-select --install`
   - Linux: `build-essential`, `pkg-config`, `libssl-dev`, `libdbus-1-dev`, and `libsecret-1-dev`

### Linux Prerequisites

CodexSwitcher is Linux-compatible, but Tauri and the keyring integration require native libraries to be present at build time.

Ubuntu / Debian:

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libssl-dev \
  libdbus-1-dev \
  libsecret-1-dev \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev
```

Notes:
- CodexSwitcher stores its own config, profiles, and backup state under `~/.config/codex-switcher/` through the `dirs` crate and XDG config resolution.
- The active Codex working directory remains `~/.codex/` on Linux, matching the macOS and Windows switching model conceptually.
- If App Lock or other keychain-backed features fail on Linux, verify that a Secret Service provider is running in your desktop session, such as `gnome-keyring-daemon` or `kwallet`.

### Running in Development

```bash
npm install
npm run tauri dev
```

### Building Production Binaries

```bash
npm run tauri build
```

Release bundles are written to `src-tauri/target/release/bundle/`.

Linux bundle outputs include:
- `.deb` packages for Debian/Ubuntu-style distributions
- `.AppImage` bundles for portable standalone execution
