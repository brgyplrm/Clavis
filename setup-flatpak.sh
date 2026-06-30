#!/bin/bash
set -e

echo "Setting up Native Messaging bridge for Chrome, Brave, Chromium, Firefox, and Floorp with debug logging..."

# 1. Grant Flatpak spawn host permissions (for Flatpak browsers)
flatpak override --user --talk-name=org.freedesktop.Flatpak one.ablaze.floorp || true
flatpak override --user --talk-name=org.freedesktop.Flatpak org.mozilla.firefox || true
flatpak override --user --talk-name=org.freedesktop.Flatpak com.google.Chrome || true
flatpak override --user --talk-name=org.freedesktop.Flatpak com.brave.Browser || true

# 2. Host registry paths (points directly to host binary)
FIREFOX_HOST_DIRS=(
  "$HOME/.floorp/native-messaging-hosts"
  "$HOME/.mozilla/native-messaging-hosts"
)

CHROME_HOST_DIRS=(
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/chromium/NativeMessagingHosts"
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  "$HOME/.config/vivaldi/NativeMessagingHosts"
)

BRIDGE_PATH="/home/achyllisss/Documents/Projects/Clavis/src-tauri/target/debug/clavis-bridge"

# Write Firefox Host Configurations
for dir in "${FIREFOX_HOST_DIRS[@]}"; do
  mkdir -p "$dir"
  cat << EOF > "$dir/com.achyllisss.clavis.json"
{
  "allowed_extensions": [
    "clavis@clavis.app"
  ],
  "description": "Clavis Browser Companion Broker",
  "name": "com.achyllisss.clavis",
  "path": "$BRIDGE_PATH",
  "type": "stdio"
}
EOF
done

# Write Chrome Host Configurations
for dir in "${CHROME_HOST_DIRS[@]}"; do
  mkdir -p "$dir"
  cat << EOF > "$dir/com.achyllisss.clavis.json"
{
  "allowed_origins": [
    "chrome-extension://bnalgnlpnmlnfflconnhgggaoabkdbok/"
  ],
  "description": "Clavis Browser Companion Broker",
  "name": "com.achyllisss.clavis",
  "path": "$BRIDGE_PATH",
  "type": "stdio"
}
EOF
done

# 3. Flatpak registry paths (points to wrapper script that calls flatpak-spawn)
FIREFOX_FLATPAK_DIRS=(
  "$HOME/.var/app/one.ablaze.floorp/.floorp/native-messaging-hosts"
  "$HOME/.var/app/one.ablaze.floorp/.mozilla/native-messaging-hosts"
  "$HOME/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts"
)

CHROME_FLATPAK_DIRS=(
  "$HOME/.var/app/com.google.Chrome/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.var/app/com.brave.Browser/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
)

# Write Firefox Flatpak Wrappers
for dir in "${FIREFOX_FLATPAK_DIRS[@]}"; do
  APP_BASE=$(echo "$dir" | cut -d'/' -f1-6)
  if [ -d "$APP_BASE" ]; then
    mkdir -p "$dir"
    WRAPPER_PATH="$dir/com.achyllisss.clavis-wrapper"
    cat << EOF > "$WRAPPER_PATH"
#!/bin/bash
flatpak-spawn --host "$BRIDGE_PATH" "\$@"
EOF
    chmod +x "$WRAPPER_PATH"
    
    cat << EOF > "$dir/com.achyllisss.clavis.json"
{
  "allowed_extensions": [
    "clavis@clavis.app"
  ],
  "description": "Clavis Browser Companion Broker (Flatpak wrapper)",
  "name": "com.achyllisss.clavis",
  "path": "$WRAPPER_PATH",
  "type": "stdio"
}
EOF
  fi
done

# Write Chrome Flatpak Wrappers
for dir in "${CHROME_FLATPAK_DIRS[@]}"; do
  APP_BASE=$(echo "$dir" | cut -d'/' -f1-6)
  if [ -d "$APP_BASE" ]; then
    mkdir -p "$dir"
    WRAPPER_PATH="$dir/com.achyllisss.clavis-wrapper"
    cat << EOF > "$WRAPPER_PATH"
#!/bin/bash
flatpak-spawn --host "$BRIDGE_PATH" "\$@"
EOF
    chmod +x "$WRAPPER_PATH"
    
    cat << EOF > "$dir/com.achyllisss.clavis.json"
{
  "allowed_origins": [
    "chrome-extension://bnalgnlpnmlnfflconnhgggaoabkdbok/"
  ],
  "description": "Clavis Browser Companion Broker (Flatpak wrapper)",
  "name": "com.achyllisss.clavis",
  "path": "$WRAPPER_PATH",
  "type": "stdio"
}
EOF
  fi
done

# 4. Compile extensions
echo "Building extension ZIP packages for automatic local deployment..."
cd extension
npm run build:all
cd ..

# 5. Automatically deploy/sideload extensions locally
echo "Registering extensions automatically in your local browsers..."
EXT_CHROME_PATH="/home/achyllisss/Documents/Projects/Clavis/extension/build/chrome"

# Google Chrome, Chromium, Brave, Edge, Vivaldi External Extension Directories
CHROME_EXT_DIRS=(
  "$HOME/.config/google-chrome/External Extensions"
  "$HOME/.config/chromium/External Extensions"
  "$HOME/.config/BraveSoftware/Brave-Browser/External Extensions"
  "$HOME/.config/microsoft-edge/External Extensions"
  "$HOME/.config/vivaldi/External Extensions"
  # Flatpak versions
  "$HOME/.var/app/com.google.Chrome/config/google-chrome/External Extensions"
  "$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/External Extensions"
)

for dir in "${CHROME_EXT_DIRS[@]}"; do
  # Determine if we should create this directory (always create native dirs, only create Flatpak if the base Flatpak dir exists)
  if [[ "$dir" == *".var/app/"* ]]; then
    APP_BASE=$(echo "$dir" | cut -d'/' -f1-6)
    if [ ! -d "$APP_BASE" ]; then
      continue
    fi
  fi

  mkdir -p "$dir"
  cat << EOF > "$dir/bnalgnlpnmlnfflconnhgggaoabkdbok.json"
{
  "external_path": "$EXT_CHROME_PATH"
}
EOF
done

# Firefox and Floorp local extension directories
FIREFOX_EXT_DIRS=(
  "$HOME/.mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
  "$HOME/.floorp/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
  # Flatpak versions
  "$HOME/.var/app/org.mozilla.firefox/.mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
  "$HOME/.var/app/one.ablaze.floorp/.floorp/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
  "$HOME/.var/app/one.ablaze.floorp/.mozilla/extensions/{ec8030f7-c20a-464f-9b0e-13a3a9e97384}"
)

for dir in "${FIREFOX_EXT_DIRS[@]}"; do
  # Determine if we should create this directory (always create native dirs, only create Flatpak if the base Flatpak dir exists)
  if [[ "$dir" == *".var/app/"* ]]; then
    APP_BASE=$(echo "$dir" | cut -d'/' -f1-6)
    if [ ! -d "$APP_BASE" ]; then
      continue
    fi
  fi

  mkdir -p "$dir"
  cp "/home/achyllisss/Documents/Projects/Clavis/extension/clavis-extension-firefox.zip" "$dir/clavis@clavis.app.xpi"
done

echo "--------------------------------------------------------"
echo "SUCCESS: Registered Clavis Native Messaging Host & Loaded Extensions!"
echo "Please completely restart your browsers and check your extensions list."
echo "--------------------------------------------------------"
