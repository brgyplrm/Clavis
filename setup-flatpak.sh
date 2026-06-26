#!/bin/bash
set -e

echo "Setting up Native Messaging bridge for Floorp/Firefox Flatpak with debug logging..."

# 1. Grant Flatpak spawn host permissions
flatpak override --user --talk-name=org.freedesktop.Flatpak one.ablaze.floorp || true
flatpak override --user --talk-name=org.freedesktop.Flatpak org.mozilla.firefox || true

# 2. Host registry paths (points directly to host binary)
HOST_DIRS=(
  "$HOME/.floorp/native-messaging-hosts"
  "$HOME/.mozilla/native-messaging-hosts"
)

for dir in "${HOST_DIRS[@]}"; do
  mkdir -p "$dir"
  cat << EOF > "$dir/com.achyllisss.clavis.json"
{
  "allowed_extensions": [
    "clavis@achyllisss.com"
  ],
  "description": "Clavis Browser Companion Broker",
  "name": "com.achyllisss.clavis",
  "path": "/home/achyllisss/Documents/Projects/Clavis/src-tauri/target/debug/clavis-bridge",
  "type": "stdio"
}
EOF
done

# 3. Flatpak registry paths (points to wrapper script that calls flatpak-spawn)
FLATPAK_DIRS=(
  "$HOME/.var/app/one.ablaze.floorp/.floorp/native-messaging-hosts"
  "$HOME/.var/app/one.ablaze.floorp/.mozilla/native-messaging-hosts"
  "$HOME/.var/app/org.mozilla.firefox/.mozilla/native-messaging-hosts"
)

for dir in "${FLATPAK_DIRS[@]}"; do
  # Check if parent app directory exists (meaning flatpak app is installed/has run)
  APP_BASE=$(echo "$dir" | cut -d'/' -f1-6)
  if [ -d "$APP_BASE" ]; then
    mkdir -p "$dir"
    
    WRAPPER_PATH="$dir/com.achyllisss.clavis-wrapper"
    cat << 'EOF' > "$WRAPPER_PATH"
#!/bin/bash
LOG_FILE="$HOME/clavis-wrapper.log"
echo "[$(date)] Wrapper started with args: $@" >> "$LOG_FILE"
flatpak-spawn --host /home/achyllisss/Documents/Projects/Clavis/src-tauri/target/debug/clavis-bridge "$@" 2>> "$LOG_FILE"
CODE=$?
echo "[$(date)] Wrapper finished with exit code: $CODE" >> "$LOG_FILE"
exit $CODE
EOF
    chmod +x "$WRAPPER_PATH"
    
    cat << EOF > "$dir/com.achyllisss.clavis.json"
{
  "allowed_extensions": [
    "clavis@achyllisss.com"
  ],
  "description": "Clavis Browser Companion Broker (Flatpak wrapper)",
  "name": "com.achyllisss.clavis",
  "path": "$WRAPPER_PATH",
  "type": "stdio"
}
EOF
  fi
done

echo "--------------------------------------------------------"
echo "SUCCESS: Registered Clavis Native Messaging Host with logging!"
echo "Please completely restart Floorp/Firefox (close all windows) and try again."
echo "--------------------------------------------------------"
