declare const chrome: any;

interface WsConfig {
  port: number;
  token: string;
}

let wsConfig: WsConfig | null = null;
let socket: WebSocket | null = null;
let isAuthenticated = false;
let isConnecting = false;
let pendingResponses: Map<string, (response: any) => void> = new Map();
let currentMessageId = 0;

// Retrieve the token and port from the native messaging host and start WebSocket connection
function fetchTokenAndConnect() {
  if (isConnecting || socket) return;
  isConnecting = true;

  chrome.runtime.sendNativeMessage(
    "com.achyllisss.clavis",
    { type: "get_token" },
    (response: any) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn("Native messaging host not available yet. Retrying...", err.message);
        isConnecting = false;
        setTimeout(fetchTokenAndConnect, 5000);
        return;
      }

      if (response && response.success) {
        wsConfig = {
          port: response.port || 32200,
          token: response.token
        };
        console.log("Retrieved WebSocket config from broker:", wsConfig);
        connectWebSocket();
      } else {
        console.warn("Broker returned error or no configuration:", response ? response.error : "empty response");
        isConnecting = false;
        setTimeout(fetchTokenAndConnect, 5000);
      }
    }
  );
}

function connectWebSocket() {
  if (!wsConfig) {
    isConnecting = false;
    return;
  }

  const url = `ws://127.0.0.1:${wsConfig.port}`;
  console.log("Connecting to WebSocket server:", url);
  socket = new WebSocket(url);

  socket.onopen = () => {
    console.log("WebSocket connection opened. Sending auth token...");
    // Direct auth call without pendingResponse ID
    socket?.send(JSON.stringify({ type: "auth", token: wsConfig!.token }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error("Failed to parse WebSocket message:", e);
    }
  };

  socket.onclose = () => {
    console.log("WebSocket connection closed. Resetting connection...");
    socket = null;
    isAuthenticated = false;
    isConnecting = false;
    wsConfig = null;
    
    // Fail any pending responses
    pendingResponses.forEach((resolve) => {
      resolve({ success: false, error: "WebSocket connection closed" });
    });
    pendingResponses.clear();

    // Reconnect after delay
    setTimeout(fetchTokenAndConnect, 5000);
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
}

function sendWsMessage(payload: any): Promise<any> {
  return new Promise((resolve) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return resolve({ success: false, error: "vault_locked" });
    }

    const msgId = (++currentMessageId).toString();
    const message = { id: msgId, ...payload };
    pendingResponses.set(msgId, resolve);
    socket.send(JSON.stringify(message));
  });
}

function handleWsMessage(data: any) {
  if (data.type === "auth_response") {
    isAuthenticated = data.success;
    isConnecting = false;
    console.log("WebSocket authentication response:", data.success);
  } else if (data.id) {
    const resolve = pendingResponses.get(data.id);
    if (resolve) {
      resolve(data);
      pendingResponses.delete(data.id);
    }
  }
}

// Startup connection
fetchTokenAndConnect();

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (!socket || socket.readyState !== WebSocket.OPEN || !isAuthenticated) {
    // Attempt reconnect on popup query if disconnected
    fetchTokenAndConnect();
    sendResponse({ success: false, error: "vault_locked" });
    return true;
  }

  if (message.type === "get_status") {
    sendWsMessage({ type: "get_status" }).then((resp) => {
      sendResponse({ success: true, unlocked: resp.unlocked });
    });
    return true;
  }

  if (message.type === "list_entries") {
    sendWsMessage({ type: "list_entries" }).then((resp) => {
      if (resp.type === "entries_response") {
        sendResponse({ success: true, entries: resp.entries });
      } else {
        sendResponse({ success: false, error: resp.message || "Failed to fetch entries" });
      }
    });
    return true;
  }

  if (message.type === "fill_entry") {
    sendWsMessage({ type: "decrypt_entry", id: message.id }).then((resp) => {
      if (resp.success) {
        // Find the current active tab and send fill instructions
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
          if (tabs && tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "fill",
              username: resp.username,
              password: resp.password,
              totp: resp.totp
            }, (result: any) => {
              // Ignore standard connection errors if content script is not loaded yet
              const err = chrome.runtime.lastError;
              if (err) {
                console.warn("Content script communication warning:", err.message);
              }
            });
          }
        });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: resp.error || "Failed to decrypt entry" });
      }
    });
    return true;
  }

  return false;
});

export {};
