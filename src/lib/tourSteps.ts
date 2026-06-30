export type PageView = "dashboard" | "security" | "authenticator" | "activity" | "settings" | "help";

export interface TourStop {
  title: string;
  description: string;
  selector: string | null;
  view: PageView;
}

export const TOUR_STOPS: TourStop[] = [
  // SECTION: DASHBOARD (Steps 1–6)
  {
    title: "Welcome to Clavis 🗝️",
    description: "You saved your first entry. Let's take a 2-minute tour so you know exactly where everything is and what everything does. You can skip at any time — and replay this tour later from the Help page.",
    selector: null,
    view: "dashboard"
  },
  {
    title: "Your Vaults",
    description: "The sidebar shows all your vaults. Think of a vault like a folder — you could have one called 'Personal', one called 'Work', and one called 'Crypto'. All entries in the selected vault appear in the main panel to the right. 💡 You can create multiple vaults to keep things organised.",
    selector: "#tour-sidebar",
    view: "dashboard"
  },
  {
    title: "Your Password List",
    description: "This is your list of saved entries. Each entry shows the title, username, and website. Click any entry to see its full details on the right. 💡 Entries never show your actual password here — only in the detail view when you explicitly reveal it.",
    selector: "#tour-entry-list",
    view: "dashboard"
  },
  {
    title: "Search Instantly",
    description: "Type anything here to search by entry title, username, or URL. Results filter as you type — no Enter key needed. Works across all entries in the current vault.",
    selector: "#tour-search",
    view: "dashboard"
  },
  {
    title: "Add New Entries",
    description: "Click the + button anytime to add a new password entry. You can store a username, password, website URL, notes, and even your 2FA (TOTP) code all in one place. 💡 The Clavis browser extension can also save entries for you automatically when you create an account on a website.",
    selector: "#tour-add-entry",
    view: "dashboard"
  },
  {
    title: "Locking Your Vault",
    description: "Click the lock icon to lock Clavis immediately. Your vault also locks automatically after 5 minutes of inactivity — you can change this timeout in Settings → Security. 💡 When locked, no one can see your passwords — not even if they have access to your computer.",
    selector: "#tour-lock",
    view: "dashboard"
  },
  // SECTION: ENTRY DETAIL (Steps 7–10)
  {
    title: "Entry Details",
    description: "This is what an entry looks like. You can see the title, username, website URL, and notes. The password is hidden by default to protect you from shoulder surfing.",
    selector: "#tour-detail-pane",
    view: "dashboard"
  },
  {
    title: "Revealing a Password",
    description: "Click the eye 👁 icon to temporarily reveal the password. It re-hides automatically after 10 seconds. Clavis also blocks screen recording software, so it cannot be captured by anyone watching your screen.",
    selector: "#tour-reveal-eye",
    view: "dashboard"
  },
  {
    title: "Copying to Clipboard",
    description: "Click the copy icon to copy the password to your clipboard. Clavis automatically clears your clipboard after 30 seconds so the password doesn't linger there after you've pasted it.",
    selector: "#tour-copy-button",
    view: "dashboard"
  },
  {
    title: "Editing and Deleting",
    description: "Use the Edit button to update an entry's details. The Delete button removes it permanently — Clavis will ask you to confirm before deleting. 💡 Deleted entries cannot be recovered unless you have a backup. Set up backups in Settings → Backup.",
    selector: "#tour-edit-button",
    view: "dashboard"
  },
  // SECTION: SETTINGS — GENERAL TAB (Steps 11–12)
  {
    title: "Settings → General",
    description: "Here you control the app's appearance and behaviour: Theme (switch between Light, Dark, or follow your OS), Start at login (launch Clavis when your computer starts), and Start minimised (keep Clavis in the tray without the window opening on startup).",
    selector: "#tour-settings-general",
    view: "settings"
  },
  {
    title: "Settings → Security",
    description: "This is where your vault's security is controlled: Auto-lock timeout (how long before Clavis locks itself), Screen capture protection (always on, but configurable), Change Master Password (safely change your password without losing any data), and Security Questions (update your recovery questions).",
    selector: "#tour-settings-security",
    view: "settings"
  },
  // SECTION: SETTINGS — AUTOTYPE (Step 13)
  {
    title: "Settings → Autotype",
    description: "Autotype is a background feature — not a button you click. Press Ctrl+Shift+V (or Cmd+Shift+V on Mac) in ANY application and Clavis will automatically type your username and password into the focused field. It never uses the clipboard. Set your preferred hotkey here and adjust typing speed if needed. 💡 Autotype works in desktop apps, login screens, and anywhere you can type — not just browsers.",
    selector: "#tour-settings-autotype",
    view: "settings"
  },
  // SECTION: SETTINGS — EXTENSION TAB (Step 14)
  {
    title: "Settings → Browser Extension",
    description: "This tab shows your browser extension connection status. When the extension is installed and connected, Clavis can: Auto-fill usernames and passwords on websites, Detect when you create a new account and offer to save it, Alert you when you log in to a site with no saved password. You can also manage which sites are blocked from showing save prompts here.",
    selector: "#tour-extensions",
    view: "settings"
  },
  // SECTION: SETTINGS — BACKUP TAB (Step 15)
  {
    title: "Settings → Backup",
    description: "Clavis automatically backs up your vault to an encrypted file on your computer. If anything goes wrong, you can restore from a backup and get all your passwords back. Set how often backups run, choose where backup files are saved, and use 'Backup Now' to create one immediately. 💡 Back up to an external drive or USB stick for extra safety.",
    selector: "#tour-settings-backup",
    view: "settings"
  },
  // SECTION: WRAP UP (Steps 16–17)
  {
    title: "Clavis Stays in Your Tray",
    description: "Closing the Clavis window doesn't quit the app. It keeps running silently in your system tray so Autotype and the browser extension keep working in the background. Right-click the tray icon to lock or quit.",
    selector: null,
    view: "dashboard"
  },
  {
    title: "You're all set! 🎉",
    description: "You've seen everything Clavis has to offer. You can always come back to this tour or find detailed help from the Help page in the sidebar.",
    selector: null,
    view: "help"
  }
];
