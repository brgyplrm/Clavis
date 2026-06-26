
// In worker environments, import the shared websocket client.
// In Firefox MV2 classic script environments, both scripts are loaded in order via manifest.json.
if (typeof importScripts === "function") {
  importScripts("./ws-client.js");
}

// Startup connection
fetchTokenAndConnect();

function matchHostname(title: string, hostname: string): boolean {
  title = title.toLowerCase().trim();
  hostname = hostname.toLowerCase().trim();
  
  if (!title || !hostname) return false;

  // 1. Direct substring checks
  if (hostname.includes(title) || title.includes(hostname)) {
    return true;
  }

  // 2. Simplified alphanumeric checks (e.g. "Cutout Pro" matches "www.cutout.pro" / "wwwcutoutpro" matches "cutoutpro")
  const cleanTitle = title.replace(/[^a-z0-9]/g, "");
  const cleanHost = hostname.replace(/[^a-z0-9]/g, "");
  if (cleanTitle.length > 2) {
    if (cleanHost.includes(cleanTitle) || cleanTitle.includes(cleanHost)) {
      return true;
    }
  }

  // 3. Main domain word match
  // Split hostname by dots to get segments (e.g., ["www", "cutout", "pro"], ["accounts", "google", "com"])
  const hostSegments = hostname.split(".").filter(seg => {
    // Ignore common TLDs and subdomains
    const ignoreList = ["www", "com", "org", "net", "edu", "gov", "co", "io", "pro", "xyz", "info", "app", "me", "biz"];
    return seg.length > 1 && !ignoreList.includes(seg);
  });

  // Check if any significant hostname segment is in the title, or vice-versa
  for (const seg of hostSegments) {
    if (title.includes(seg) || seg.includes(title)) {
      return true;
    }
  }

  return false;
}

let pendingSave: any = null;

// Listen for messages from the popup and content script
chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  console.log("[Background] Received message type:", message.type, "from sender:", sender);
  
  if (message.type === "set_pending_save") {
    console.log("[Background] Setting pending save:", message.pending);
    pendingSave = message.pending;
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "get_pending_save") {
    console.log("[Background] Getting pending save for hostname:", message.hostname, "Current pending:", pendingSave);
    if (pendingSave) {
      const currentHost = (message.hostname || "").toLowerCase();
      const pendingHost = pendingSave.hostname.toLowerCase();
      
      const getBaseDomain = (host: string) => {
        const parts = host.split(".");
        return parts.length >= 2 ? parts.slice(-2).join(".") : host;
      };

      if (getBaseDomain(currentHost) === getBaseDomain(pendingHost)) {
        console.log("[Background] Pending save matches current domain, returning it.");
        sendResponse({ success: true, pending: pendingSave });
        pendingSave = null; // Consume
        return true;
      }
    }
    sendResponse({ success: true, pending: null });
    return true;
  }

  if (message.type === "credential_request") {
    console.log("[Background] Handling credential_request for hostname:", message.hostname);
    ensureConnected().then((connected) => {
      console.log("[Background] credential_request connection state:", connected);
      if (!connected) {
        sendResponse({ success: false, error: "vault_locked" });
        return;
      }

      sendWsMessage({ type: "list_entries" }).then((resp) => {
        console.log("[Background] credential_request list_entries response:", resp);
        if (resp.type === "entries_response") {
          const entries = resp.entries || [];
          const hostname = (message.hostname || "").toLowerCase();
          const matches = entries.filter((entry: any) => {
            return matchHostname(entry.title || "", hostname);
          });
          sendResponse({ success: true, matches });
        } else {
          sendResponse({ success: false, error: resp.message || "Failed to fetch entries" });
        }
      });
    });
    return true;
  }

  // All popup requests require a valid WebSocket connection
  ensureConnected().then((connected) => {
    console.log("[Background] Request connection state:", connected);
    if (!connected) {
      sendResponse({ success: false, error: "vault_locked" });
      return;
    }

    if (message.type === "get_status") {
      sendWsMessage({ type: "get_status" }).then((resp) => {
        sendResponse({ success: true, unlocked: resp.unlocked });
      });
    } else if (message.type === "list_entries") {
      sendWsMessage({ type: "list_entries" }).then((resp) => {
        if (resp.type === "entries_response") {
          sendResponse({ success: true, entries: resp.entries });
        } else {
          sendResponse({ success: false, error: resp.message || "Failed to fetch entries" });
        }
      });
    } else if (message.type === "fill_entry") {
      logToTab("[Background] fill_entry requested for ID:", message.id);
      sendWsMessage({ type: "decrypt_entry", entry_id: message.id }).then((resp) => {
        if (resp.success) {
          const targetTabId = sender && sender.tab ? sender.tab.id : null;
          logToTab("[Background] Decrypted entry successfully. Target tab from sender:", targetTabId, "username:", resp.username);
          
          const fillPayload = {
            action: "fill",
            username: resp.username,
            password: resp.password,
            totp: resp.totp
          };

          const callback = (result: any) => {
            const err = chrome.runtime.lastError;
            if (err) {
              logToTab("[Background] Content script communication warning:", err.message);
            } else {
              logToTab("[Background] Fill instruction sent successfully, response:", result);
            }
          };

          if (typeof targetTabId === "number") {
            chrome.tabs.sendMessage(targetTabId, fillPayload, callback);
          } else {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
              if (tabs && tabs[0] && typeof tabs[0].id === "number") {
                logToTab("[Background] Sending fill to active tab:", tabs[0].id);
                chrome.tabs.sendMessage(tabs[0].id, fillPayload, callback);
              } else {
                logToTab("[Background] No active tab found to send fill instruction.");
              }
            });
          }
          sendResponse({ success: true });
        } else {
          logToTab("[Background] Failed to decrypt entry:", resp.error);
          sendResponse({ success: false, error: resp.error || "Failed to decrypt entry" });
        }
      });
    } else if (message.type === "create_entry") {
      console.log("[Background] Handling create_entry request:", message);
      logToTab("[Background] create_entry requested for title:", message.title, "username:", message.username);
      sendWsMessage({
        type: "create_entry",
        title: message.title,
        username: message.username,
        password: message.password
      }).then((resp) => {
        console.log("[Background] create_entry ws response:", resp);
        if (resp.type === "create_response" && resp.success) {
          logToTab("[Background] Entry created successfully in database.");
          sendResponse({ success: true });
        } else {
          logToTab("[Background] Failed to create entry:", resp.error);
          sendResponse({ success: false, error: resp.error || "Failed to create entry" });
        }
      });
    }
  });

  return true;
});
