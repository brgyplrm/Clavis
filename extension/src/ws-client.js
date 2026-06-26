"use strict";
function logToTab(msg, ...args) {
    console.log(msg, ...args);
    try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0] && typeof tabs[0].id === "number") {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "bg_log",
                    message: msg,
                    args: args
                }, () => {
                    const err = chrome.runtime.lastError;
                });
            }
        });
    }
    catch (e) {
        // Ignore errors in environments where tabs API is not available
    }
}
let wsConfig = null;
let socket = null;
let isAuthenticated = false;
let isConnecting = false;
let pendingResponses = new Map();
let currentMessageId = 0;
function fetchTokenAndConnect() {
    if (isConnecting || socket)
        return;
    isConnecting = true;
    chrome.runtime.sendNativeMessage("com.achyllisss.clavis", { type: "get_token" }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
            logToTab("[WS Client] Native messaging host not available yet. Retrying...", err.message);
            isConnecting = false;
            setTimeout(fetchTokenAndConnect, 5000);
            return;
        }
        if (response && response.success) {
            wsConfig = {
                port: response.port || 59001,
                token: response.token
            };
            logToTab("[WS Client] Retrieved WebSocket config from broker:", wsConfig);
            connectWebSocket();
        }
        else {
            logToTab("[WS Client] Broker returned error or no configuration:", response ? response.error : "empty response");
            isConnecting = false;
            setTimeout(fetchTokenAndConnect, 5000);
        }
    });
}
function connectWebSocket() {
    if (!wsConfig) {
        isConnecting = false;
        return;
    }
    const url = `ws://127.0.0.1:${wsConfig.port}`;
    logToTab("[WS Client] Connecting to WebSocket server:", url);
    socket = new WebSocket(url, wsConfig.token);
    socket.onopen = () => {
        logToTab("[WS Client] WebSocket connection opened.");
    };
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleWsMessage(data);
        }
        catch (e) {
            logToTab("[WS Client] Failed to parse WebSocket message:", e);
        }
    };
    socket.onclose = () => {
        logToTab("[WS Client] WebSocket connection closed. Resetting connection...");
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
function sendWsMessage(payload) {
    return new Promise((resolve) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            logToTab("[WS Client] sendWsMessage aborted: WebSocket not open. readyState:", socket ? socket.readyState : "no socket");
            return resolve({ success: false, error: "vault_locked" });
        }
        const msgId = (++currentMessageId).toString();
        const message = { id: msgId, ...payload };
        pendingResponses.set(msgId, (response) => {
            logToTab("[WS Client] Received response for message ID " + msgId + ":", response);
            resolve(response);
        });
        logToTab("[WS Client] Sending WebSocket message ID " + msgId + ":", payload);
        socket.send(JSON.stringify(message));
    });
}
function handleWsMessage(data) {
    if (data.type === "auth_response") {
        isAuthenticated = data.success;
        isConnecting = false;
        logToTab("[WS Client] WebSocket authentication response:", data.success);
    }
    else if (data.id) {
        const resolve = pendingResponses.get(data.id);
        if (resolve) {
            resolve(data);
            pendingResponses.delete(data.id);
        }
    }
}
function ensureConnected() {
    if (socket && socket.readyState === WebSocket.OPEN && isAuthenticated) {
        return Promise.resolve(true);
    }
    logToTab("[WS Client] ensureConnected: connection is not ready. socket status:", socket ? socket.readyState : "null", "isAuthenticated:", isAuthenticated);
    return new Promise((resolve) => {
        fetchTokenAndConnect();
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            if (socket && socket.readyState === WebSocket.OPEN && isAuthenticated) {
                clearInterval(interval);
                logToTab("[WS Client] ensureConnected succeeded after attempts:", attempts);
                resolve(true);
            }
            else if (attempts >= 15 || (!isConnecting && !socket)) { // 1.5 seconds timeout
                clearInterval(interval);
                logToTab("[WS Client] ensureConnected timed out or failed. attempts:", attempts, "isConnecting:", isConnecting, "socket:", socket ? "present" : "null");
                resolve(false);
            }
        }, 100);
    });
}
