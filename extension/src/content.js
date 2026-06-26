"use strict";
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "bg_log") {
        console.log(message.message, ...(message.args || []));
        sendResponse({ success: true });
        return;
    }
    console.log("[Clavis Content Script] Received message:", message);
    if (message.action === "fill") {
        // Cross-origin iframe security gate
        try {
            if (window.self !== window.top) {
                if (window.top && window.top.location.origin !== window.location.origin) {
                    console.warn("[Clavis Content Script] Cross-origin iframe blocked fill.");
                    sendResponse({ success: false, error: "cross_origin_iframe" });
                    return;
                }
            }
        }
        catch (e) {
            console.warn("[Clavis Content Script] Cross-origin iframe check error, blocked fill.");
            sendResponse({ success: false, error: "cross_origin_iframe" });
            return;
        }
        const { username, password } = message;
        console.log("[Clavis Content Script] Executing fill for username:", username);
        const filled = fillLoginForm(username, password);
        console.log("[Clavis Content Script] Fill result:", filled);
        sendResponse({ success: filled });
    }
});
function findInputsInShadow(root = document) {
    const inputs = [];
    const traverse = (node) => {
        if (node instanceof HTMLInputElement) {
            inputs.push(node);
        }
        node.childNodes.forEach(child => traverse(child));
        if (node instanceof HTMLElement && node.shadowRoot) {
            traverse(node.shadowRoot);
        }
    };
    traverse(root);
    return inputs;
}
function findFormsInShadow(root = document) {
    const forms = [];
    const traverse = (node) => {
        if (node instanceof HTMLFormElement) {
            forms.push(node);
        }
        node.childNodes.forEach(child => traverse(child));
        if (node instanceof HTMLElement && node.shadowRoot) {
            traverse(node.shadowRoot);
        }
    };
    traverse(root);
    return forms;
}
function getClosestComposed(element, selector) {
    let current = element;
    while (current) {
        if (current instanceof Element && current.matches(selector)) {
            return current;
        }
        if (current instanceof ShadowRoot) {
            current = current.host;
        }
        else {
            current = current.parentNode;
        }
    }
    return null;
}
function initGlobalClickBlockers() {
    const blocker = (e) => {
        if (!e.isTrusted)
            return;
        const path = e.composedPath ? e.composedPath() : [];
        let targetsOurComponent = false;
        for (const node of path) {
            if (node instanceof HTMLElement) {
                if (node.id === "clavis-autofill-root" || node.id === "clavis-save-banner-root") {
                    targetsOurComponent = true;
                    break;
                }
            }
        }
        if (targetsOurComponent) {
            e.stopPropagation();
            if (e.type === "click") {
                const target = path[0];
                if (target instanceof HTMLElement) {
                    console.log("[Clavis Content Script] Re-dispatching untrusted click to element:", target);
                    target.click();
                }
            }
        }
    };
    const events = ["mousedown", "mouseup", "click", "pointerdown", "pointerup"];
    events.forEach(type => {
        window.addEventListener(type, blocker, true);
    });
}
function fillLoginForm(username, password) {
    // 1. Locate password fields
    const passwordFields = findInputsInShadow().filter(input => input.type === 'password');
    console.log("[Clavis Content Script] Found password fields count:", passwordFields.length);
    if (passwordFields.length === 0) {
        // If no password fields are found, fill the username field (for multi-step login forms)
        console.log("[Clavis Content Script] No password fields. Scanning for username fields...");
        const fields = getLoginFormFields();
        console.log("[Clavis Content Script] Candidate username fields found:", fields.length);
        const usernameField = fields.find(field => field.getAttribute('type') !== 'password');
        if (usernameField && username) {
            console.log("[Clavis Content Script] Filling username field (multi-step):", usernameField);
            setValueAndTriggerEvents(usernameField, username);
            return true;
        }
        console.warn("[Clavis Content Script] No username field found to fill.");
        return false;
    }
    let filledAny = false;
    for (const passField of passwordFields) {
        // Fill password
        console.log("[Clavis Content Script] Filling password field:", passField);
        setValueAndTriggerEvents(passField, password);
        filledAny = true;
        // 2. Find the form or container containing this password field
        const form = passField.form || getClosestComposed(passField, 'form') || passField.parentElement;
        if (!form) {
            console.warn("[Clavis Content Script] Could not find form or parent container for password field.");
            continue;
        }
        // 3. Look for a username field (text, email, tel) in the same form/container
        const inputs = findInputsInShadow(form);
        const usernameTypes = ['text', 'email', 'tel', 'url'];
        // Scan inputs appearing before the password field
        const passIndex = inputs.indexOf(passField);
        let usernameField = null;
        if (passIndex > 0) {
            for (let i = passIndex - 1; i >= 0; i--) {
                const input = inputs[i];
                const type = (input.getAttribute('type') || 'text').toLowerCase();
                if (usernameTypes.includes(type) && isElementVisible(input)) {
                    usernameField = input;
                    break;
                }
            }
        }
        // Fallback: search anywhere in the form for text-like inputs
        if (!usernameField) {
            usernameField = inputs.find(input => {
                const type = (input.getAttribute('type') || 'text').toLowerCase();
                return usernameTypes.includes(type) && input !== passField && isElementVisible(input);
            }) || null;
        }
        if (usernameField && username) {
            console.log("[Clavis Content Script] Filling matching username field in form:", usernameField);
            setValueAndTriggerEvents(usernameField, username);
        }
        else {
            console.log("[Clavis Content Script] No matching username field found in form or no username provided.");
        }
    }
    return filledAny;
}
function setValueAndTriggerEvents(element, value) {
    console.log("[Clavis Content Script] Setting input value for:", element.id || element.name || "unnamed input", "to:", value ? "***" : "");
    element.value = value;
    // Dispatch events to satisfy virtual DOM libraries (React, Angular, Vue)
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}
function isElementVisible(element) {
    const style = window.getComputedStyle(element);
    return (style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0);
}
// Autofill Dropdown State and Logic
let activeInput = null;
let currentMatches = [];
let dropdownListenersAttached = false;
let boundInputFocus = null;
let boundInputClick = null;
let boundDocumentClick = null;
let boundWindowScrollResize = null;
function getLoginFormFields() {
    const passwordFields = findInputsInShadow().filter(input => input.type === 'password');
    const fields = [];
    for (const passField of passwordFields) {
        if (!fields.includes(passField)) {
            fields.push(passField);
        }
        const form = passField.form || passField.closest('form') || passField.parentElement;
        if (!form)
            continue;
        const inputs = findInputsInShadow(form);
        const usernameTypes = ['text', 'email', 'tel', 'url'];
        const passIndex = inputs.indexOf(passField);
        let usernameField = null;
        if (passIndex > 0) {
            for (let i = passIndex - 1; i >= 0; i--) {
                const input = inputs[i];
                const type = (input.getAttribute('type') || 'text').toLowerCase();
                if (usernameTypes.includes(type) && isElementVisible(input)) {
                    usernameField = input;
                    break;
                }
            }
        }
        if (!usernameField) {
            usernameField = inputs.find(input => {
                const type = (input.getAttribute('type') || 'text').toLowerCase();
                return usernameTypes.includes(type) && input !== passField && isElementVisible(input);
            }) || null;
        }
        if (usernameField && !fields.includes(usernameField)) {
            fields.push(usernameField);
        }
    }
    // Also include standalone username/email fields if no password field is present on the page
    const allInputs = findInputsInShadow();
    for (const input of allInputs) {
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        const name = (input.getAttribute('name') || '').toLowerCase();
        const id = (input.getAttribute('id') || '').toLowerCase();
        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
        if (autocomplete === 'username' ||
            autocomplete === 'email' ||
            type === 'email' ||
            name === 'username' ||
            name === 'login' ||
            name === 'identifier' ||
            id === 'identifierid') {
            if (isElementVisible(input) && !fields.includes(input)) {
                fields.push(input);
            }
        }
    }
    return fields;
}
function setupDropdownListeners(matches) {
    console.log("[Clavis Content Script] setupDropdownListeners called with", matches.length, "matches");
    currentMatches = matches;
    const fields = getLoginFormFields();
    console.log("[Clavis Content Script] Login fields found:", fields.length);
    if (fields.length === 0) {
        console.log("[Clavis Content Script] No login fields found, removing listeners.");
        removeDropdownListeners();
        return;
    }
    // Avoid resetting if already attached and fields are the same
    if (dropdownListenersAttached) {
        console.log("[Clavis Content Script] Listeners already attached, skipping setup.");
        return;
    }
    boundInputFocus = (e) => {
        activeInput = e.currentTarget;
        console.log("[Clavis Content Script] Input focused:", activeInput.name || activeInput.id || "unnamed input");
        showDropdown();
    };
    boundInputClick = (e) => {
        activeInput = e.currentTarget;
        console.log("[Clavis Content Script] Input clicked:", activeInput.name || activeInput.id || "unnamed input");
        showDropdown();
    };
    fields.forEach(field => {
        field.addEventListener("focus", boundInputFocus);
        field.addEventListener("click", boundInputClick);
    });
    boundDocumentClick = (e) => {
        const rootDiv = document.getElementById("clavis-autofill-root");
        if (!rootDiv || !activeInput)
            return;
        const target = e.target;
        const path = e.composedPath ? e.composedPath() : [];
        const isClickInside = activeInput === target ||
            path.includes(activeInput) ||
            rootDiv.contains(target) ||
            path.includes(rootDiv);
        if (!isClickInside) {
            console.log("[Clavis Content Script] Clicked outside dropdown/input, hiding dropdown.");
            hideDropdown();
        }
    };
    document.addEventListener("click", boundDocumentClick);
    boundWindowScrollResize = () => {
        console.log("[Clavis Content Script] Scroll/Resize detected, hiding dropdown.");
        hideDropdown();
    };
    window.addEventListener("scroll", boundWindowScrollResize, true);
    window.addEventListener("resize", boundWindowScrollResize);
    dropdownListenersAttached = true;
    console.log("[Clavis Content Script] Dropdown listeners successfully attached.");
}
function removeDropdownListeners() {
    console.log("[Clavis Content Script] removeDropdownListeners called.");
    const fields = getLoginFormFields();
    if (boundInputFocus) {
        fields.forEach(field => field.removeEventListener("focus", boundInputFocus));
    }
    if (boundInputClick) {
        fields.forEach(field => field.removeEventListener("click", boundInputClick));
    }
    if (boundDocumentClick) {
        document.removeEventListener("click", boundDocumentClick);
    }
    if (boundWindowScrollResize) {
        window.removeEventListener("scroll", boundWindowScrollResize, true);
        window.removeEventListener("resize", boundWindowScrollResize);
    }
    hideDropdown();
    activeInput = null;
    currentMatches = [];
    dropdownListenersAttached = false;
}
function showDropdown() {
    console.log("[Clavis Content Script] showDropdown called. activeInput:", activeInput);
    if (!activeInput || currentMatches.length === 0) {
        console.log("[Clavis Content Script] showDropdown aborted: activeInput is null or currentMatches is empty.");
        return;
    }
    let rootDiv = document.getElementById("clavis-autofill-root");
    if (!rootDiv) {
        console.log("[Clavis Content Script] Creating new clavis-autofill-root element.");
        rootDiv = document.createElement("div");
        rootDiv.id = "clavis-autofill-root";
        rootDiv.style.position = "absolute";
        rootDiv.style.top = "0";
        rootDiv.style.left = "0";
        rootDiv.style.width = "100%";
        rootDiv.style.height = "0";
        rootDiv.style.overflow = "visible";
        rootDiv.style.zIndex = "2147483647";
        rootDiv.style.pointerEvents = "none";
        // Stop all mouse/pointer events from bubbling to prevent underlying page from closing modals
        const stopPropagation = (e) => e.stopPropagation();
        rootDiv.addEventListener("mousedown", stopPropagation);
        rootDiv.addEventListener("mouseup", stopPropagation);
        rootDiv.addEventListener("pointerdown", stopPropagation);
        rootDiv.addEventListener("pointerup", stopPropagation);
        rootDiv.addEventListener("click", stopPropagation);
        document.body.appendChild(rootDiv);
        const shadow = rootDiv.attachShadow({ mode: "open" });
        shadow.innerHTML = `
      <style>
        .clavis-dropdown {
          position: absolute;
          background: #1e1e2e;
          color: #cdd6f4;
          border: 1px solid #45475a;
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.3);
          z-index: 2147483647;
          width: 280px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 13px;
          overflow: hidden;
          display: none;
          box-sizing: border-box;
          pointer-events: auto; /* Enable clicks on the dropdown list */
        }
        .clavis-header {
          padding: 8px 12px;
          border-bottom: 1px solid #45475a;
          font-weight: bold;
          color: #89b4fa;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: #181825;
        }
        .clavis-list {
          max-height: 200px;
          overflow-y: auto;
        }
        .clavis-item {
          padding: 10px 12px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 2px;
          transition: background 0.15s ease;
          box-sizing: border-box;
        }
        .clavis-item:hover {
          background: #313244;
        }
        .clavis-title {
          font-weight: 600;
          color: #cdd6f4;
        }
        .clavis-username {
          font-size: 11px;
          color: #a6adc8;
        }
      </style>
      <div class="clavis-dropdown" id="dropdown-menu">
        <div class="clavis-header">🗝️ Clavis Autofill</div>
        <div class="clavis-list" id="dropdown-list"></div>
      </div>
    `;
    }
    const shadow = rootDiv.shadowRoot;
    const dropdown = shadow.getElementById("dropdown-menu");
    const list = shadow.getElementById("dropdown-list");
    list.innerHTML = "";
    currentMatches.forEach(entry => {
        const item = document.createElement("div");
        item.className = "clavis-item";
        const title = document.createElement("span");
        title.className = "clavis-title";
        title.textContent = entry.title;
        item.appendChild(title);
        const user = document.createElement("span");
        user.className = "clavis-username";
        user.textContent = entry.username || "No username";
        item.appendChild(user);
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            console.log("[Clavis Content Script] Dropdown card clicked for entry ID:", entry.id);
            chrome.runtime.sendMessage({ type: "fill_entry", id: entry.id }, (response) => {
                console.log("[Clavis Content Script] fill_entry sendMessage callback. Response:", response);
            });
            hideDropdown();
        });
        list.appendChild(item);
    });
    const rect = activeInput.getBoundingClientRect();
    const top = rect.bottom + window.scrollY;
    const left = rect.left + window.scrollX;
    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.display = "block";
    console.log("[Clavis Content Script] Dropdown display set to block at top:", top, "left:", left);
}
function hideDropdown() {
    console.log("[Clavis Content Script] hideDropdown called.");
    const rootDiv = document.getElementById("clavis-autofill-root");
    if (rootDiv && rootDiv.shadowRoot) {
        const dropdown = rootDiv.shadowRoot.getElementById("dropdown-menu");
        if (dropdown) {
            dropdown.style.display = "none";
            console.log("[Clavis Content Script] Dropdown display set to none.");
        }
    }
}
// Load and Mutation detection
let timeoutId = null;
function hasLoginForm() {
    const allInputs = findInputsInShadow();
    if (allInputs.some(input => input.type === 'password')) {
        return true;
    }
    for (const input of allInputs) {
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        const name = (input.getAttribute('name') || '').toLowerCase();
        const id = (input.getAttribute('id') || '').toLowerCase();
        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
        if (autocomplete === 'username' ||
            autocomplete === 'email' ||
            type === 'email' ||
            name === 'username' ||
            name === 'login' ||
            name === 'identifier' ||
            id === 'identifierid') {
            if (isElementVisible(input)) {
                return true;
            }
        }
    }
    return false;
}
// Forms capture state
const formsAttached = new Set();
let capturedUsername = "";
let capturedPassword = "";
let capturedHostname = "";
let isNewCredential = false;
let submitAttempted = false;
let submitCaptureAttached = false;
function setupSubmitCapture() {
    if (!submitCaptureAttached) {
        // 2. Listen to all button clicks globally (standard, custom shadow components, role=button)
        // Use a global document listener for click events so we can capture custom button clicks
        // even if they are inside shadow roots or dynamically rendered!
        document.addEventListener("click", (e) => {
            const path = e.composedPath ? e.composedPath() : [];
            let button = null;
            for (const node of path) {
                if (node instanceof HTMLElement) {
                    if (node.matches("button, input[type='button'], input[type='submit'], [role='button'], .btn, .button")) {
                        button = node;
                        break;
                    }
                }
            }
            if (button) {
                console.log("[Clavis Content Script] Click on button-like element detected:", button);
                // Perform submission check using current input values on page
                submitAttempted = true;
                handleFormSubmission(document.body);
            }
        }, true); // Capture phase to guarantee we run before standard page handlers navigate away
        // Window unloading listener to save typed new credentials
        window.addEventListener("beforeunload", () => {
            if (submitAttempted && capturedUsername && capturedPassword) {
                console.log("[Clavis Content Script] beforeunload: storing pending save in background.");
                const pendingSave = {
                    hostname: window.location.hostname,
                    username: capturedUsername,
                    password: capturedPassword
                };
                chrome.runtime.sendMessage({
                    type: "set_pending_save",
                    pending: pendingSave
                });
            }
        });
        submitCaptureAttached = true;
    }
    // 1. Listen for standard form submits (for forms inside shadow DOMs too)
    const forms = findFormsInShadow();
    forms.forEach(form => {
        if (formsAttached.has(form))
            return;
        formsAttached.add(form);
        form.addEventListener("submit", () => {
            console.log("[Clavis Content Script] Form submit intercepted");
            handleFormSubmission(form);
            submitAttempted = true;
        });
    });
    // 3. Monitor and update credentials as user types
    monitorInputs();
}
function monitorInputs() {
    const allInputs = findInputsInShadow();
    const passwordFields = allInputs.filter(input => input.type === 'password');
    passwordFields.forEach(passField => {
        if (passField.getAttribute("data-clavis-monitored") === "true")
            return;
        passField.setAttribute("data-clavis-monitored", "true");
        const updateValues = () => {
            capturedPassword = passField.value;
            // Look for username field in same form/container or page
            const form = passField.form || getClosestComposed(passField, 'form') || getClosestComposed(passField, 'div') || document.body;
            const inputs = findInputsInShadow(form);
            const usernameTypes = ['text', 'email', 'tel', 'url'];
            const userField = inputs.find(input => {
                const type = (input.getAttribute('type') || 'text').toLowerCase();
                return usernameTypes.includes(type) && input.type !== "password" && isElementVisible(input);
            });
            if (userField) {
                capturedUsername = userField.value;
            }
        };
        passField.addEventListener("input", updateValues);
        passField.addEventListener("change", updateValues);
        const form = passField.form || getClosestComposed(passField, 'form') || getClosestComposed(passField, 'div') || document.body;
        const inputs = findInputsInShadow(form);
        const usernameTypes = ['text', 'email', 'tel', 'url'];
        const userField = inputs.find(input => {
            const type = (input.getAttribute('type') || 'text').toLowerCase();
            return usernameTypes.includes(type) && input.type !== "password" && isElementVisible(input);
        });
        if (userField) {
            userField.addEventListener("input", updateValues);
            userField.addEventListener("change", updateValues);
            userField.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    console.log("[Clavis Content Script] Enter key pressed in username field");
                    submitAttempted = true;
                    handleFormSubmission(document.body);
                }
            });
        }
    });
}
function handleFormSubmission(container) {
    const allInputs = findInputsInShadow(container);
    const passwordFields = allInputs.filter(input => input.type === 'password');
    let password = "";
    if (passwordFields.length > 0) {
        password = passwordFields[0].value;
    }
    if (!password)
        return; // Only capture if a password is typed
    const usernameTypes = ['text', 'email', 'tel', 'url'];
    let username = "";
    const usernameField = allInputs.find(input => {
        const type = (input.getAttribute('type') || 'text').toLowerCase();
        return usernameTypes.includes(type) && input.type !== "password" && isElementVisible(input);
    });
    if (usernameField) {
        username = usernameField.value;
    }
    if (!username) {
        const globalInputs = findInputsInShadow();
        const globalUserField = globalInputs.find(input => {
            const type = (input.getAttribute('type') || 'text').toLowerCase();
            return usernameTypes.includes(type) && input.type !== "password" && isElementVisible(input);
        });
        if (globalUserField) {
            username = globalUserField.value;
        }
    }
    if (!username)
        return;
    capturedUsername = username;
    capturedPassword = password;
    capturedHostname = window.location.hostname;
    console.log("[Clavis Content Script] Captured login submission. Username:", username, "Password length:", password.length);
    // Store in background immediately in case of redirection
    const pendingSave = {
        hostname: window.location.hostname,
        username,
        password
    };
    chrome.runtime.sendMessage({
        type: "set_pending_save",
        pending: pendingSave
    });
    // Check if already saved in database
    chrome.runtime.sendMessage({
        type: "credential_request",
        hostname: window.location.hostname
    }, (response) => {
        const err = chrome.runtime.lastError;
        if (err || !response || !response.success || !response.matches) {
            return;
        }
        const alreadySaved = response.matches.some((match) => {
            return (match.username || "").toLowerCase() === username.toLowerCase();
        });
        if (!alreadySaved) {
            // Show banner on current page after a short delay in case we don't redirect
            setTimeout(() => {
                if (!document.getElementById("clavis-save-banner-root")) {
                    chrome.runtime.sendMessage({ type: "set_pending_save", pending: null });
                    showSaveBanner(pendingSave);
                }
            }, 1000);
        }
        else {
            chrome.runtime.sendMessage({ type: "set_pending_save", pending: null });
        }
    });
}
function checkPendingSave() {
    chrome.runtime.sendMessage({
        type: "get_pending_save",
        hostname: window.location.hostname
    }, (response) => {
        const err = chrome.runtime.lastError;
        if (err || !response || !response.pending)
            return;
        const pending = response.pending;
        console.log("[Clavis Content Script] Found pending save from previous session:", pending.username);
        // Check if already saved in database before showing banner
        chrome.runtime.sendMessage({
            type: "credential_request",
            hostname: pending.hostname
        }, (response) => {
            const err = chrome.runtime.lastError;
            if (err || !response || !response.success || !response.matches) {
                showSaveBanner(pending);
                return;
            }
            const alreadySaved = response.matches.some((match) => {
                return (match.username || "").toLowerCase() === pending.username.toLowerCase();
            });
            if (!alreadySaved) {
                showSaveBanner(pending);
            }
            else {
                console.log("[Clavis Content Script] Credentials already saved, skipping banner.");
            }
        });
    });
}
function showSaveBanner(pending) {
    if (document.getElementById("clavis-save-banner-root"))
        return;
    const bannerDiv = document.createElement("div");
    bannerDiv.id = "clavis-save-banner-root";
    bannerDiv.style.position = "fixed";
    bannerDiv.style.top = "16px";
    bannerDiv.style.left = "50%";
    bannerDiv.style.transform = "translateX(-50%)";
    bannerDiv.style.zIndex = "2147483647";
    bannerDiv.style.pointerEvents = "none";
    document.body.appendChild(bannerDiv);
    // Stop mouse/pointer event propagation
    const stopPropagation = (e) => e.stopPropagation();
    bannerDiv.addEventListener("mousedown", stopPropagation);
    bannerDiv.addEventListener("mouseup", stopPropagation);
    bannerDiv.addEventListener("pointerdown", stopPropagation);
    bannerDiv.addEventListener("pointerup", stopPropagation);
    bannerDiv.addEventListener("click", stopPropagation);
    const shadow = bannerDiv.attachShadow({ mode: "open" });
    shadow.innerHTML = `
    <style>
      .clavis-banner {
        background: rgba(30, 30, 46, 0.95);
        backdrop-filter: blur(10px);
        color: #cdd6f4;
        border: 1px solid rgba(137, 180, 250, 0.3);
        border-radius: 12px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 16px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        pointer-events: auto;
        animation: slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        max-width: 480px;
        width: max-content;
        box-sizing: border-box;
      }
      @keyframes slideDown {
        from { transform: translateY(-40px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .clavis-logo {
        font-size: 18px;
      }
      .clavis-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-grow: 1;
      }
      .clavis-title {
        font-weight: 700;
        color: #89b4fa;
      }
      .clavis-details {
        font-size: 11px;
        color: #a6adc8;
      }
      .clavis-buttons {
        display: flex;
        gap: 8px;
      }
      button {
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .btn-save {
        background: linear-gradient(135deg, #cba6f7 0%, #89b4fa 100%);
        color: #11111b;
      }
      .btn-save:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(203, 166, 247, 0.4);
      }
      .btn-cancel {
        background: #313244;
        color: #cdd6f4;
        border: 1px solid #45475a;
      }
      .btn-cancel:hover {
        background: #45475a;
      }
    </style>
    <div class="clavis-banner">
      <span class="clavis-logo">🗝️</span>
      <div class="clavis-text">
        <span class="clavis-title">Save to Clavis?</span>
        <span class="clavis-details">Save password for <strong>${pending.username}</strong> on this site?</span>
      </div>
      <div class="clavis-buttons">
        <button class="btn-cancel" id="btn-cancel">No thanks</button>
        <button class="btn-save" id="btn-save">Save</button>
      </div>
    </div>
  `;
    const btnCancel = shadow.getElementById("btn-cancel");
    const btnSave = shadow.getElementById("btn-save");
    btnCancel.addEventListener("click", () => {
        bannerDiv.remove();
    });
    btnSave.addEventListener("click", () => {
        console.log("[Clavis Content Script] Save button clicked. Preparing to send create_entry message.");
        btnSave.textContent = "Saving...";
        btnSave.disabled = true;
        btnCancel.disabled = true;
        const rawHost = pending.hostname.replace("www.", "");
        const parts = rawHost.split(".");
        let formattedTitle = rawHost;
        if (parts.length >= 2) {
            const tldList = ["co", "com", "org", "net", "gov", "edu", "ac", "sch"];
            let index = parts.length - 2;
            if (tldList.includes(parts[index]) && parts.length >= 3) {
                index = parts.length - 3;
            }
            const base = parts[index];
            formattedTitle = base.charAt(0).toUpperCase() + base.slice(1);
        }
        else {
            formattedTitle = rawHost.charAt(0).toUpperCase() + rawHost.slice(1);
        }
        const payload = {
            type: "create_entry",
            title: formattedTitle,
            username: pending.username,
            password: pending.password
        };
        console.log("[Clavis Content Script] Sending message to background:", payload);
        chrome.runtime.sendMessage(payload, (response) => {
            const err = chrome.runtime.lastError;
            console.log("[Clavis Content Script] Received response from background:", response, "Error:", err);
            if (err || !response || !response.success) {
                console.error("[Clavis Content Script] Failed to save entry:", err || response?.error);
                btnSave.textContent = "Error";
                btnSave.style.background = "#f38ba8";
                setTimeout(() => bannerDiv.remove(), 2000);
            }
            else {
                console.log("[Clavis Content Script] Entry saved successfully!");
                btnSave.textContent = "Saved!";
                btnSave.style.background = "#a6e3a1";
                setTimeout(() => bannerDiv.remove(), 1500);
            }
        });
    });
}
function init() {
    console.log("[Clavis Content Script] Initializing content script for:", window.location.href);
    initGlobalClickBlockers();
    checkPendingSave();
    checkForPasswordFields();
    setupSubmitCapture();
    if (document.body) {
        const observer = new MutationObserver(() => {
            console.log("[Clavis Content Script] Mutation detected, scheduling re-check in 500ms.");
            if (timeoutId)
                clearTimeout(timeoutId);
            timeoutId = setTimeout(checkForPasswordFields, 500);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }
}
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
}
else {
    init();
}
function checkForPasswordFields() {
    // Cross-origin iframe security gate
    try {
        if (window.self !== window.top) {
            if (window.top && window.top.location.origin !== window.location.origin) {
                return;
            }
        }
    }
    catch (e) {
        return;
    }
    const hasForm = hasLoginForm();
    console.log("[Clavis Content Script] checkForPasswordFields. hasLoginForm:", hasForm);
    if (hasForm) {
        setupSubmitCapture();
        console.log("[Clavis Content Script] Sending credential_request for hostname:", window.location.hostname);
        chrome.runtime.sendMessage({
            type: "credential_request",
            hostname: window.location.hostname
        }, (response) => {
            const err = chrome.runtime.lastError;
            if (err) {
                console.error("[Clavis Content Script] credential_request failed:", err.message);
                removeDropdownListeners();
                return;
            }
            console.log("[Clavis Content Script] credential_request response:", response);
            if (!response || !response.success || !response.matches || response.matches.length === 0) {
                console.log("[Clavis Content Script] No matching credentials or request failed, removing listeners.");
                removeDropdownListeners();
                return;
            }
            setupDropdownListeners(response.matches);
        });
    }
    else {
        removeDropdownListeners();
    }
}
