declare const chrome: any;

chrome.runtime.onMessage.addListener((message: any, sender: any, sendResponse: any) => {
  if (message.action === "fill") {
    const { username, password } = message;
    const filled = fillLoginForm(username, password);
    sendResponse({ success: filled });
  }
});

function fillLoginForm(username: string | null, password: string): boolean {
  // 1. Locate password fields
  const passwordFields = Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
  if (passwordFields.length === 0) {
    return false;
  }

  let filledAny = false;

  for (const passField of passwordFields) {
    // Fill password
    setValueAndTriggerEvents(passField, password);
    filledAny = true;

    // 2. Find the form or container containing this password field
    const form = passField.form || passField.closest('form') || passField.parentElement;
    if (!form) continue;

    // 3. Look for a username field (text, email, tel) in the same form/container
    const inputs = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
    const usernameTypes = ['text', 'email', 'tel', 'url'];
    
    // Scan inputs appearing before the password field
    const passIndex = inputs.indexOf(passField);
    let usernameField: HTMLInputElement | null = null;

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
      setValueAndTriggerEvents(usernameField, username);
    }
  }

  return filledAny;
}

function setValueAndTriggerEvents(element: HTMLInputElement, value: string) {
  element.value = value;
  
  // Dispatch events to satisfy virtual DOM libraries (React, Angular, Vue)
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}

function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    element.offsetWidth > 0 &&
    element.offsetHeight > 0
  );
}

export {};
