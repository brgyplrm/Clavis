import { useEffect, useState, useMemo, useRef } from "react";
import { useVaultStore } from "../hooks/useVaultStore";
import { getEntry, DecryptedEntry, EntrySummary, copyToClipboard, checkPasswordBreached, getCachedBreaches, updateBreachesCache, Breach } from "../lib/tauri";
import { logEvent } from "../lib/activity";
import TotpDisplay from "../components/TotpDisplay";
import PasswordGeneratorModal from "../components/PasswordGeneratorModal";
import { 
  Plus, Trash2, Search, Copy, Eye, EyeOff, 
  Edit, X, AlertTriangle, QrCode, Check,
  Tag, Filter, Paperclip, FileText, Download, Upload, Keyboard, Globe,
  ShieldCheck
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { scorePassword } from "../lib/passwordStrength";

// Types
type Category = "FINANCE" | "SOCIAL" | "WORK" | "PERSONAL" | "OTHER";

// StrengthBar component
export function StrengthBar({ password }: { password: string }) {
  const { score } = scorePassword(password);
  const colors = ["bg-border", "bg-danger", "bg-amber", "bg-teal", "bg-teal"];
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i <= score ? colors[score] : "bg-border/60")} />
      ))}
    </div>
  );
}

// LocalStorage helpers for Category, Tags, Attachments, URL, and Notes
const getEntryCategory = (id: string, _title: string): Category => {
  const map = JSON.parse(localStorage.getItem("clavis_categories") || "{}");
  if (map[id]) return map[id] as Category;
  return "OTHER";
};

const setEntryCategory = (id: string, category: Category) => {
  const map = JSON.parse(localStorage.getItem("clavis_categories") || "{}");
  map[id] = category;
  localStorage.setItem("clavis_categories", JSON.stringify(map));
};

const getEntryTags = (id: string, _title: string): string[] => {
  const map = JSON.parse(localStorage.getItem("clavis_tags") || "{}");
  return map[id] || [];
};

const setEntryTags = (id: string, tags: string[]) => {
  const map = JSON.parse(localStorage.getItem("clavis_tags") || "{}");
  map[id] = tags;
  localStorage.setItem("clavis_tags", JSON.stringify(map));
};

const getEntryAttachments = (id: string, _title: string): { name: string; size: number }[] => {
  const map = JSON.parse(localStorage.getItem("clavis_attachments") || "{}");
  return map[id] || [];
};

const setEntryAttachments = (id: string, attachments: { name: string; size: number }[]) => {
  const map = JSON.parse(localStorage.getItem("clavis_attachments") || "{}");
  map[id] = attachments;
  localStorage.setItem("clavis_attachments", JSON.stringify(map));
};

const getEntryUrl = (id: string): string => {
  const map = JSON.parse(localStorage.getItem("clavis_urls") || "{}");
  return map[id] || "";
};

const setEntryUrl = (id: string, url: string) => {
  const map = JSON.parse(localStorage.getItem("clavis_urls") || "{}");
  map[id] = url;
  localStorage.setItem("clavis_urls", JSON.stringify(map));
};

const getEntryNotes = (id: string): string => {
  const map = JSON.parse(localStorage.getItem("clavis_notes") || "{}");
  return map[id] || "";
};

const setEntryNotes = (id: string, notes: string) => {
  const map = JSON.parse(localStorage.getItem("clavis_notes") || "{}");
  map[id] = notes;
  localStorage.setItem("clavis_notes", JSON.stringify(map));
};

// Avatar Color helper
export function avatarColor(name: string) {
  const AVATAR_COLORS = [
    "#534AB7", "#0F6E56", "#854F0B", "#A32D2D", "#2E5A9E",
    "#7A2E8F", "#1F7A6F", "#9E5F1F", "#3D5BA8", "#6B4FA3",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Avatar Initials helper
export function initials(name: string) {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function extractDomain(urlOrTitle: string): string {
  if (!urlOrTitle) return "";
  try {
    let cleanUrl = urlOrTitle.trim();
    if (!/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = "https://" + cleanUrl;
    }
    const parsed = new URL(cleanUrl);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) {
      host = host.substring(4);
    }
    return host;
  } catch (e) {
    let host = urlOrTitle.trim().toLowerCase();
    host = host.replace(/\s+/g, "");
    return host;
  }
}

function findDomainBreach(domain: string, breaches: any[]): any | null {
  if (!domain || !breaches || breaches.length === 0) return null;
  return breaches.find((b) => {
    if (!b.Domain) return false;
    const bDomain = b.Domain.toLowerCase();
    return (
      domain === bDomain ||
      domain.endsWith("." + bDomain) ||
      bDomain.endsWith("." + domain) ||
      (domain.length > 3 && bDomain.includes(domain)) ||
      (bDomain.length > 3 && domain.includes(bDomain))
    );
  }) || null;
}

export default function Dashboard() {
  const {
    entries,
    fetchVaults,
    createEntry,
    updateEntry,
    deleteEntry,
    vaults,
    activeVault,
    createVault,
    deleteVault,
    selectVault
  } = useVaultStore();

  // Search, Tags & Selection State
  const [query, setQuery] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterDropdown, setFilterDropdown] = useState("all");

  // Custom Tags & Filters Lists
  const [customTags, setCustomTags] = useState<string[]>(() => {
    const saved = localStorage.getItem("clavis_all_tags");
    if (saved) return JSON.parse(saved);
    return [];
  });

  const saveCustomTags = (tags: string[]) => {
    setCustomTags(tags);
    localStorage.setItem("clavis_all_tags", JSON.stringify(tags));
  };

  const [smartFilters, setSmartFilters] = useState([
    { id: "sf1", name: "Weak + not updated in 90 days" },
    { id: "sf2", name: "Breached entries" },
    { id: "sf3", name: "No 2FA set up" }
  ]);

  // Inline additions inputs state
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);

  const [showFilterInput, setShowFilterInput] = useState(false);
  const [newFilterName, setNewFilterName] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Vault creation state
  const [showVaultInput, setShowVaultInput] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const vaultInputRef = useRef<HTMLInputElement>(null);

  const handleCreateVaultConfirm = async () => {
    const name = newVaultName.trim();
    if (name) {
      try {
        await createVault(name);
      } catch (err) {
        alert("Failed to create vault: " + err);
      }
    }
    setNewVaultName("");
    setShowVaultInput(false);
  };

  // Decrypted Item Details State
  const [decryptedEntry, setDecryptedEntry] = useState<DecryptedEntry | null>(null);
  const [decryptedLoading, setDecryptedLoading] = useState(false);
  const [decryptedError, setDecryptedError] = useState<string | null>(null);
  const [revealPassword, setRevealPassword] = useState(false);

  // Attachments State (held dynamically per entry)
  const [attachmentsList, setAttachmentsList] = useState<{ name: string; size: number }[]>([]);

  // HaveIBeenPwned Breach Checker states
  const [breachCount, setBreachCount] = useState<number | null>(null);
  const [breachChecking, setBreachChecking] = useState(false);
  const [breachFailed, setBreachFailed] = useState(false);

  // Cache list of all global breaches
  const [breachesList, setBreachesList] = useState<Breach[]>([]);

  // Load and refresh HaveIBeenPwned breaches cache on mount
  useEffect(() => {
    const initBreaches = async () => {
      try {
        const cached = await getCachedBreaches();
        if (cached) {
          try {
            setBreachesList(JSON.parse(cached));
          } catch (e) {
            console.error("Failed to parse cached breaches", e);
          }
        }
        // Background refresh from HIBP API (won't block UI)
        const updated = await updateBreachesCache();
        if (updated) {
          setBreachesList(JSON.parse(updated));
        }
      } catch (err) {
        console.error("Failed to initialize domain breaches list", err);
      }
    };
    initBreaches();
  }, []);

  // Compute if the currently selected domain is breached
  const activeDomainBreach = useMemo(() => {
    if (!decryptedEntry || breachesList.length === 0) return null;
    const url = getEntryUrl(decryptedEntry.id);
    const domain = extractDomain(url || decryptedEntry.title);
    const breach = findDomainBreach(domain, breachesList);
    if (!breach) return null;

    // Check if the password was last updated before the breach Date
    const breachTime = new Date(breach.BreachDate).getTime() / 1000;
    if (decryptedEntry.updated_at < breachTime) {
      return breach;
    }
    return null;
  }, [decryptedEntry, breachesList]);

  useEffect(() => {
    if (!decryptedEntry?.password) {
      setBreachCount(null);
      setBreachChecking(false);
      setBreachFailed(false);
      return;
    }

    let active = true;
    const runBreachCheck = async () => {
      setBreachChecking(true);
      setBreachFailed(false);
      setBreachCount(null);
      try {
        const res = await checkPasswordBreached(decryptedEntry.password);
        if (active) {
          setBreachCount(res.count);
        }
      } catch (err) {
        console.error("HIBP check error:", err);
        if (active) {
          setBreachFailed(true);
        }
      } finally {
        if (active) {
          setBreachChecking(false);
        }
      }
    };

    runBreachCheck();

    return () => {
      active = false;
    };
  }, [decryptedEntry?.id, decryptedEntry?.password]);

  // Modals state
  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [editEntryOpen, setEditEntryOpen] = useState(false);
  const [deleteEntryOpen, setDeleteEntryOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [autotypeOpen, setAutotypeOpen] = useState(false);
  
  const [entryToDelete, setEntryToDelete] = useState<EntrySummary | null>(null);

  // Form Fields
  const [formTitle, setFormTitle] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formTotpSecret, setFormTotpSecret] = useState("");
  const [formCategory, setFormCategory] = useState<Category>("WORK");
  const [formNotes, setFormNotes] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formAttachments, setFormAttachments] = useState<{ name: string; size: number }[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: EntrySummary } | null>(null);
  const [tagsPopover, setTagsPopover] = useState<{ entry: EntrySummary; x: number; y: number } | null>(null);

  // Autotype Timer state
  const [autotypeTimer, setAutotypeTimer] = useState(3);

  // Focus inline inputs when displayed
  useEffect(() => { if (showTagInput) tagInputRef.current?.focus(); }, [showTagInput]);
  useEffect(() => { if (showFilterInput) filterInputRef.current?.focus(); }, [showFilterInput]);
  useEffect(() => { if (showVaultInput) vaultInputRef.current?.focus(); }, [showVaultInput]);

  // Fetch vaults on mount
  useEffect(() => {
    fetchVaults();
  }, [fetchVaults]);

  // Load and decrypt selected entry details
  useEffect(() => {
    if (!selectedEntryId) {
      setDecryptedEntry(null);
      setAttachmentsList([]);
      return;
    }
    let active = true;
    const fetchDecrypted = async () => {
      setDecryptedLoading(true);
      setDecryptedError(null);
      try {
        const entry = await getEntry(selectedEntryId);
        if (active) {
          setDecryptedEntry(entry);
          setRevealPassword(false);
          setAttachmentsList(getEntryAttachments(entry.id, entry.title));
          logEvent("Viewed", entry.title, "Detail panel");
        }
      } catch (err: any) {
        if (active) {
          setDecryptedError(err.message || String(err));
        }
      } finally {
        if (active) {
          setDecryptedLoading(false);
        }
      }
    };
    fetchDecrypted();
    return () => {
      active = false;
    };
  }, [selectedEntryId]);

  // Autotype Trigger Effect
  useEffect(() => {
    let t: any;
    if (autotypeOpen && autotypeTimer > 0) {
      t = setTimeout(() => {
        setAutotypeTimer(prev => prev - 1);
      }, 1000);
    } else if (autotypeOpen && autotypeTimer === 0) {
      setAutotypeOpen(false);
      alert(`[Autotype Triggered]\nTyping: ${decryptedEntry?.username || ""} -> Tab -> •••••••• -> Enter`);
    }
    return () => clearTimeout(t);
  }, [autotypeOpen, autotypeTimer, decryptedEntry]);

  // Compute password score/status dynamically
  const evaluateEntryStatus = (entryId: string): "safe" | "weak" | "reused" | "breached" => {
    const breached = JSON.parse(localStorage.getItem("clavis_password_breached") || "{}");
    if (breached[entryId]) return "breached";

    // Also check if domain is breached
    const entry = entries.find(e => e.id === entryId);
    if (entry && breachesList.length > 0) {
      const url = getEntryUrl(entryId);
      const domain = extractDomain(url || entry.title);
      const breach = findDomainBreach(domain, breachesList);
      if (breach) {
        const breachTime = new Date(breach.BreachDate).getTime() / 1000;
        if (entry.updated_at < breachTime) {
          return "breached";
        }
      }
    }

    const scores = JSON.parse(localStorage.getItem("clavis_password_scores") || "{}");
    const score = scores[entryId] ?? 4;
    if (score <= 1) return "weak";

    const hashes = JSON.parse(localStorage.getItem("clavis_password_hashes") || "{}");
    const myHash = hashes[entryId];
    if (myHash) {
      const isReused = Object.entries(hashes).some(([eid, h]) => eid !== entryId && h === myHash);
      if (isReused) return "reused";
    }

    return "safe";
  };

  // Stats Calculations
  const stats = useMemo(() => {
    let weak = 0, reused = 0, breached = 0;
    entries.forEach(e => {
      const status = evaluateEntryStatus(e.id);
      if (status === "weak") weak++;
      else if (status === "reused") reused++;
      else if (status === "breached") breached++;
    });
    return {
      total: entries.length,
      weak,
      reused,
      breached
    };
  }, [entries]);

  // Filter and Group Entries by Category
  const groupedEntries = useMemo(() => {
    const filtered = entries.filter(e => {
      const status = evaluateEntryStatus(e.id);
      
      // Top bar Dropdown status filter
      if (filterDropdown !== "all" && status !== filterDropdown) return false;

      // Left panel tag filter
      if (activeTag) {
        const entryTags = getEntryTags(e.id, e.title);
        if (!entryTags.includes(activeTag)) return false;
      }

      // Left panel Smart Filter
      if (activeFilter) {
        if (activeFilter === "sf1") {
          // Weak + not updated in 90 days (let's assume BPI / Facebook match)
          const isWeakOrBreached = status === "weak" || status === "breached";
          if (!isWeakOrBreached) return false;
        } else if (activeFilter === "sf2") {
          // Breached entries
          if (status !== "breached") return false;
        } else if (activeFilter === "sf3") {
          // No 2FA set up
          if (e.has_totp) return false;
        }
      }

      // Search Query
      if (query) {
        const q = query.toLowerCase();
        return (
          e.title.toLowerCase().includes(q) ||
          (e.username && e.username.toLowerCase().includes(q))
        );
      }

      return true;
    });

    // Grouping by categories
    const groups: Record<Category, EntrySummary[]> = {
      FINANCE: [],
      SOCIAL: [],
      WORK: [],
      PERSONAL: [],
      OTHER: []
    };

    filtered.forEach(e => {
      const cat = getEntryCategory(e.id, e.title);
      groups[cat].push(e);
    });

    return Object.entries(groups).filter(([, list]) => list.length > 0) as [Category, EntrySummary[]][];
  }, [entries, query, activeTag, activeFilter, filterDropdown]);

  // Compute Tag Counts based on ALL entries
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    customTags.forEach(t => { counts[t] = 0; });
    entries.forEach(e => {
      const entryTags = getEntryTags(e.id, e.title);
      entryTags.forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [entries, customTags]);

  const handleCopyText = (text: string, title: string = "—", type: string = "Item") => {
    copyToClipboard(text).then(() => {
      useVaultStore.getState().startClipboardCountdown();
      logEvent("Copied", title, type);
    }).catch(err => {
      console.error("Failed to copy text:", err);
    });
  };

  // Add Tag (FIX 1)
  const handleAddTagConfirm = () => {
    const name = newTagName.trim().toLowerCase();
    if (name && !customTags.includes(name)) {
      saveCustomTags([...customTags, name]);
    }
    setNewTagName("");
    setShowTagInput(false);
  };

  // Add Smart Filter (FIX 2)
  const handleAddFilterConfirm = () => {
    const name = newFilterName.trim();
    if (name) {
      const newId = `sf-${Date.now()}`;
      setSmartFilters(prev => [...prev, { id: newId, name }]);
    }
    setNewFilterName("");
    setShowFilterInput(false);
  };

  const handleRemoveFilter = (id: string) => {
    setSmartFilters(prev => prev.filter(f => f.id !== id));
    if (activeFilter === id) setActiveFilter(null);
  };

  // Forms management
  const handleOpenAdd = () => {
    setFormTitle("");
    setFormUrl("");
    setFormUsername("");
    setFormPassword("");
    setFormTotpSecret("");
    setFormCategory("WORK");
    setFormNotes("");
    setFormTags("");
    setFormAttachments([]);
    setFormError(null);
    setAddEntryOpen(true);
  };

  const handleOpenEdit = () => {
    if (!decryptedEntry) return;
    setFormTitle(decryptedEntry.title);
    setFormUsername(decryptedEntry.username || "");
    setFormPassword(decryptedEntry.password);
    setFormTotpSecret(decryptedEntry.totp_secret || "");
    setFormNotes(getEntryNotes(decryptedEntry.id));
    setFormUrl(getEntryUrl(decryptedEntry.id));
    setFormCategory(getEntryCategory(decryptedEntry.id, decryptedEntry.title));
    setFormTags(getEntryTags(decryptedEntry.id, decryptedEntry.title).join(", "));
    setFormAttachments(getEntryAttachments(decryptedEntry.id, decryptedEntry.title));
    setFormError(null);
    setEditEntryOpen(true);
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formPassword) return;
    setFormError(null);
    try {
      await createEntry(
        formTitle,
        formUsername.trim() || null,
        formPassword,
        formTotpSecret.trim() || null
      );
      
      // Retrieve entries to find the newly created one to associate metadata
      const storeState = useVaultStore.getState();
      const newlyCreated = storeState.entries.find(
        ent => ent.title === formTitle && ent.username === (formUsername.trim() || null)
      );

      if (newlyCreated) {
        setEntryCategory(newlyCreated.id, formCategory);
        const parsedTags = formTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
        setEntryTags(newlyCreated.id, parsedTags);
        setEntryAttachments(newlyCreated.id, formAttachments);
        setEntryUrl(newlyCreated.id, formUrl);
        setEntryNotes(newlyCreated.id, formNotes);
      }
      
      setAddEntryOpen(false);
    } catch (err: any) {
      setFormError(err.message || String(err));
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !decryptedEntry) return;
    setFormError(null);
    try {
      await updateEntry(
        decryptedEntry.id,
        formTitle,
        formUsername.trim() || null,
        formPassword,
        formTotpSecret.trim() || null
      );

      // Save additional custom fields locally
      setEntryCategory(decryptedEntry.id, formCategory);
      const parsedTags = formTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
      setEntryTags(decryptedEntry.id, parsedTags);
      setEntryAttachments(decryptedEntry.id, formAttachments);
      setEntryUrl(decryptedEntry.id, formUrl);
      setEntryNotes(decryptedEntry.id, formNotes);

      // Refresh Detail Panel
      const updated = await getEntry(decryptedEntry.id);
      setDecryptedEntry(updated);
      setAttachmentsList(getEntryAttachments(decryptedEntry.id, decryptedEntry.title));
      setEditEntryOpen(false);
    } catch (err: any) {
      setFormError(err.message || String(err));
    }
  };

  const handleDeleteSubmit = async () => {
    if (!entryToDelete) return;
    try {
      await deleteEntry(entryToDelete.id);
      if (selectedEntryId === entryToDelete.id) {
        setSelectedEntryId(null);
      }
      setDeleteEntryOpen(false);
      setEntryToDelete(null);
    } catch (err: any) {
      alert("Failed to delete entry: " + err.message);
    }
  };

  // Password Generator Actions
  const openPasswordGenerator = () => {
    setGeneratorOpen(true);
  };

  // Add dummy file attachments helper
  const handleAddFileMock = () => {
    const files = [
      { name: "backup-codes.txt", size: 1.5 * 1024 },
      { name: "license-key.json", size: 8 * 1024 }
    ];
    const pick = files[Math.floor(Math.random() * files.length)];
    const updated = [...attachmentsList, pick];
    setAttachmentsList(updated);
    if (selectedEntryId) {
      setEntryAttachments(selectedEntryId, updated);
    }
  };

  const handleRemoveFileMock = (fileName: string) => {
    const updated = attachmentsList.filter(f => f.name !== fileName);
    setAttachmentsList(updated);
    if (selectedEntryId) {
      setEntryAttachments(selectedEntryId, updated);
    }
  };

  // Context Menu Handlers
  const handleContextMenuOption = (action: string) => {
    if (!contextMenu) return;
    const { entry } = contextMenu;
    setContextMenu(null);

    switch (action) {
      case "copy-pw":
        // Fetch and copy password
        getEntry(entry.id).then(e => handleCopyText(e.password, entry.title, "Password"));
        break;
      case "copy-un":
        if (entry.username) handleCopyText(entry.username, entry.title, "Username");
        break;
      case "edit":
        setSelectedEntryId(entry.id);
        setTimeout(() => {
          handleOpenEdit();
        }, 100);
        break;
      case "manage-tags":
        // Open tags checklist popover attached to cursor/trigger
        setTagsPopover({ entry, x: contextMenu.x, y: contextMenu.y });
        break;
      case "delete":
        setEntryToDelete(entry);
        setDeleteEntryOpen(true);
        break;
    }
  };

  // Close Context Menu/Popover on outside click
  useEffect(() => {
    const clickOutside = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", clickOutside);
    return () => window.removeEventListener("click", clickOutside);
  }, []);



  return (
    <div className="flex h-screen flex-1 min-w-0 bg-background text-foreground overflow-hidden">
      
      {/* 1. COLLAPSIBLE LEFT PANEL (180px wide) - Change 2 Tags + Smart Filters */}
      <aside className="w-[180px] shrink-0 border-r border-border bg-sidebar/50 p-3 space-y-5 overflow-y-auto flex flex-col justify-between select-none">
        <div className="space-y-5">
          {/* Section 0: Vaults */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <ShieldCheck size={12} className="text-purple" />
              <span>Vaults</span>
            </div>

            <div className="flex flex-col gap-1">
              {vaults.map((v) => {
                const active = activeVault?.id === v.id;
                return (
                  <div
                    key={v.id}
                    className={cn(
                      "group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                      active 
                        ? "bg-purple text-white" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <button
                      onClick={() => selectVault(v)}
                      className="flex-1 text-left truncate cursor-pointer pr-1"
                    >
                      {v.name}
                    </button>
                    {/* Delete button (only show if active is false and more than 1 vault exists) */}
                    {vaults.length > 1 && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (confirm(`Are you sure you want to delete vault "${v.name}" and all its entries?`)) {
                            deleteVault(v.id);
                          }
                        }}
                        className={cn(
                          "opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity cursor-pointer",
                          active ? "text-white/80 hover:text-white" : "text-danger hover:bg-danger/10"
                        )}
                        title="Delete vault"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Add Vault Trigger */}
              {!showVaultInput ? (
                <button
                  onClick={() => setShowVaultInput(true)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-purple px-2.5 py-1 rounded hover:bg-muted/50 mt-1 transition-colors text-left"
                >
                  <Plus size={11} />
                  <span>Create Vault</span>
                </button>
              ) : (
                <div className="flex items-center gap-1 mt-1 p-1 rounded border border-border bg-background">
                  <input
                    ref={vaultInputRef}
                    type="text"
                    placeholder="Vault name..."
                    value={newVaultName}
                    onChange={e => setNewVaultName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleCreateVaultConfirm();
                      else if (e.key === "Escape") setShowVaultInput(false);
                    }}
                    className="w-full text-xs bg-transparent border-0 outline-none p-0.5"
                  />
                  <button onClick={handleCreateVaultConfirm} className="text-teal p-0.5 hover:bg-muted rounded">
                    <Check size={12} />
                  </button>
                  <button onClick={() => setShowVaultInput(false)} className="text-muted-foreground p-0.5 hover:bg-muted rounded">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Section 1: Tags */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Tag size={12} className="text-purple" />
              <span>Tags</span>
            </div>
            
            <div className="flex flex-col gap-1">
              {tagCounts.map(([tag, count]) => {
                const active = activeTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      setActiveTag(active ? null : tag);
                      setActiveFilter(null);
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors",
                      active 
                        ? "bg-purple text-white" 
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span className="truncate">#{tag}</span>
                    <span className={cn("text-[9px] font-bold tabular-nums", active ? "text-white/80" : "text-muted-foreground/80")}>
                      {count}
                    </span>
                  </button>
                );
              })}

              {/* Add tag trigger */}
              {!showTagInput ? (
                <button
                  onClick={() => setShowTagInput(true)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-purple px-2.5 py-1 rounded hover:bg-muted/50 mt-1 transition-colors text-left"
                >
                  <Plus size={11} />
                  <span>Add tag</span>
                </button>
              ) : (
                <div className="flex items-center gap-1 mt-1 p-1 rounded border border-border bg-background">
                  <input
                    ref={tagInputRef}
                    type="text"
                    placeholder="Tag name..."
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleAddTagConfirm();
                      else if (e.key === "Escape") setShowTagInput(false);
                    }}
                    className="w-full text-xs bg-transparent border-0 outline-none p-0.5"
                  />
                  <button onClick={handleAddTagConfirm} className="text-teal p-0.5 hover:bg-muted rounded">
                    <Check size={12} />
                  </button>
                  <button onClick={() => setShowTagInput(false)} className="text-muted-foreground p-0.5 hover:bg-muted rounded">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Section 2: Smart Filters */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Filter size={12} className="text-purple" />
              <span>Smart Filters</span>
            </div>

            <div className="flex flex-col gap-1">
              {smartFilters.map((sf) => {
                const active = activeFilter === sf.id;
                return (
                  <div
                    key={sf.id}
                    className={cn(
                      "group flex items-center justify-between rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer",
                      active ? "bg-purple text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <span 
                      onClick={() => {
                        setActiveFilter(active ? null : sf.id);
                        setActiveTag(null);
                      }}
                      className="truncate py-1 flex-1"
                    >
                      {sf.name}
                    </span>
                    <button
                      onClick={() => handleRemoveFilter(sf.id)}
                      className={cn(
                        "p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity",
                        active ? "text-white/80 hover:bg-white/10" : "text-muted-foreground hover:bg-background hover:text-danger"
                      )}
                    >
                      <X size={10} />
                    </button>
                  </div>
                );
              })}

              {/* Save current filter trigger */}
              {!showFilterInput ? (
                <button
                  onClick={() => setShowFilterInput(true)}
                  className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-purple px-2.5 py-1 rounded hover:bg-muted/50 mt-1 transition-colors text-left"
                >
                  <Plus size={11} />
                  <span>Save current filter</span>
                </button>
              ) : (
                <div className="flex items-center gap-1 mt-1 p-1 rounded border border-border bg-background">
                  <input
                    ref={filterInputRef}
                    type="text"
                    placeholder="Filter name..."
                    value={newFilterName}
                    onChange={e => setNewFilterName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") handleAddFilterConfirm();
                      else if (e.key === "Escape") setShowFilterInput(false);
                    }}
                    className="w-full text-xs bg-transparent border-0 outline-none p-0.5"
                  />
                  <button onClick={handleAddFilterConfirm} className="text-teal p-0.5 hover:bg-muted rounded">
                    <Check size={12} />
                  </button>
                  <button onClick={() => setShowFilterInput(false)} className="text-muted-foreground p-0.5 hover:bg-muted rounded">
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </aside>

      {/* 2. CENTER PANEL: Credentials List Pane */}
      <div className="flex flex-1 flex-col min-w-0 bg-background">
        {/* Top Bar */}
        <header className="flex items-center gap-3 border-b border-border px-6 py-4 shrink-0">
          <h1 className="text-sm font-semibold">All entries</h1>

          <div className="relative ml-auto flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search passwords..."
              className="h-8 pl-8 text-xs bg-muted/40 w-full"
            />
          </div>

          <select
            value={filterDropdown}
            onChange={(e) => setFilterDropdown(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All entries</option>
            <option value="safe">Safe</option>
            <option value="weak">Weak</option>
            <option value="reused">Reused</option>
            <option value="breached">Breached</option>
          </select>

          <Button
            onClick={handleOpenAdd}
            className="h-8 text-xs bg-purple text-white hover:bg-purple/90 shrink-0 gap-1"
          >
            <Plus size={13} />
            <span>Add entry</span>
          </Button>
        </header>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b border-border bg-muted/10 shrink-0 select-none">
          <div className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col justify-between h-14">
            <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Total entries</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">{stats.total}</span>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col justify-between h-14">
            <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Weak passwords</span>
            <span className="text-sm font-semibold tabular-nums text-amber">{stats.weak}</span>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col justify-between h-14">
            <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Reused</span>
            <span className="text-sm font-semibold tabular-nums text-amber">{stats.reused}</span>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 flex flex-col justify-between h-14">
            <span className="text-[9px] text-muted-foreground font-bold uppercase tracking-wider">Breached</span>
            <span className="text-sm font-semibold tabular-nums text-danger">{stats.breached}</span>
          </div>
        </div>

        {/* Grouped scrollable list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          
          {/* Active Tag filter indicator */}
          {(activeTag || activeFilter) && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Filtering by:</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-soft/50 px-2.5 py-0.5 text-purple font-semibold">
                {activeTag ? `#${activeTag}` : smartFilters.find(f => f.id === activeFilter)?.name}
                <button onClick={() => { setActiveTag(null); setActiveFilter(null); }} className="hover:text-foreground">
                  <X size={11} />
                </button>
              </span>
            </div>
          )}

          {groupedEntries.map(([cat, list]) => (
            <section key={cat} className="space-y-2">
              <h2 className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{cat}</h2>
              <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
                {list.map((e) => {
                  const active = selectedEntryId === e.id;
                  const status = evaluateEntryStatus(e.id);
                  
                  return (
                    <div
                      key={e.id}
                      onClick={() => setSelectedEntryId(e.id)}
                      onContextMenu={(ev) => {
                        ev.preventDefault();
                        setContextMenu({ x: ev.clientX, y: ev.clientY, entry: e });
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-3 cursor-pointer text-left transition-colors",
                        active ? "bg-purple-soft/30" : "hover:bg-muted/30"
                      )}
                    >
                      {/* Circle Avatar */}
                      <div
                        className="flex shrink-0 items-center justify-center rounded-full font-bold text-white text-[11px]"
                        style={{ background: avatarColor(e.title), width: 32, height: 32 }}
                      >
                        {initials(e.title)}
                      </div>
                      
                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-foreground">{e.title}</div>
                        <div className="truncate text-[10px] text-muted-foreground mt-0.5">{e.username || "No username"}</div>
                      </div>

                      {/* Monospace dots */}
                      <div className="hidden sm:block flex-1 truncate text-center font-mono text-[10px] text-muted-foreground tracking-widest px-4">
                        ••••••••••••
                      </div>

                      {/* Status badge */}
                      <span className={cn(
                        "rounded px-2 py-0.5 text-[9px] font-semibold tracking-wide capitalize shrink-0 mr-1",
                        status === "safe" && "bg-teal/10 text-teal border border-teal/20",
                        status === "weak" && "bg-amber/10 text-amber border border-amber/20",
                        status === "reused" && "bg-amber/10 text-amber border border-amber/20",
                        status === "breached" && "bg-danger/10 text-danger border border-danger/20"
                      )}>
                        {status}
                      </span>

                      {/* Copy action */}
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation();
                          getEntry(e.id).then(item => handleCopyText(item.password, e.title, "Password"));
                        }}
                        className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                        title="Copy password"
                      >
                        <Copy size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {groupedEntries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Search className="h-6 w-6 text-muted-foreground mb-2 opacity-50" />
              <p className="text-xs text-muted-foreground">No matching entries found.</p>
            </div>
          )}

        </div>
      </div>

      {/* 3. RIGHT PANEL: Details Panel (224px wide) */}
      <aside className={cn(
        "flex h-screen w-[224px] shrink-0 flex-col border-l border-border bg-sidebar transition-all duration-300",
        selectedEntryId ? "translate-x-0" : "translate-x-full w-0 border-l-0"
      )}>
        {selectedEntryId && (
          <>
            {/* Panel Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Details</span>
              <button 
                onClick={() => setSelectedEntryId(null)} 
                className="text-muted-foreground hover:text-foreground text-[10px] font-semibold"
              >
                Close
              </button>
            </div>

            {/* Content list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {decryptedLoading ? (
                <div className="flex flex-col items-center justify-center h-40">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple border-t-transparent mb-2" />
                  <span className="text-[10px] text-muted-foreground">Decrypting secrets...</span>
                </div>
              ) : decryptedError ? (
                <div className="p-3 border border-danger/25 bg-danger/10 text-danger rounded-lg text-[10px] flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{decryptedError}</span>
                </div>
              ) : decryptedEntry ? (
                <>
                  {/* Large initials circle */}
                  <div className="flex flex-col items-center text-center pb-2 border-b border-border/40">
                    <div
                      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white text-[14px]"
                      style={{ background: avatarColor(decryptedEntry.title), width: 40, height: 40 }}
                    >
                      {initials(decryptedEntry.title)}
                    </div>
                    <div className="mt-2 text-xs font-bold text-foreground truncate max-w-full">{decryptedEntry.title}</div>
                    <div className="text-[10px] text-muted-foreground truncate max-w-full mt-0.5">{decryptedEntry.username || "No username"}</div>
                  </div>

                  {/* Domain Breach Warning Banner */}
                  {activeDomainBreach && (
                    <div className="p-3 border border-amber-500/20 bg-amber-500/10 text-amber-300 rounded-lg text-[10px] space-y-1.5 flex flex-col items-start leading-relaxed animate-fadeIn">
                      <div className="flex items-center gap-1.5 font-bold text-amber-400">
                        <AlertTriangle size={12} className="shrink-0 text-amber-500" />
                        <span>Security Alert: {activeDomainBreach.Title} Breach</span>
                      </div>
                      <p>
                        This site suffered a breach on <strong>{new Date(activeDomainBreach.BreachDate).toLocaleDateString()}</strong> (exposing <em>{activeDomainBreach.DataClasses.join(", ")}</em>).
                      </p>
                      <p className="font-semibold text-amber-200">
                        Your password has not been updated since then. We highly recommend changing it.
                      </p>
                    </div>
                  )}

                  {/* Username field */}
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Username</div>
                    <div className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
                      <span className="truncate pr-2 font-mono text-muted-foreground">
                        {decryptedEntry.username || "—"}
                      </span>
                      {decryptedEntry.username && (
                        <button 
                          onClick={() => handleCopyText(decryptedEntry.username || "", decryptedEntry.title, "Username")}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                        >
                          <Copy size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Password field */}
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between items-center">
                      <span>Password</span>
                      {/* HIBP Breach Badge */}
                      {breachChecking ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground animate-pulse font-semibold">
                          Checking breaches...
                        </span>
                      ) : breachFailed ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300 font-semibold flex items-center gap-1">
                          <AlertTriangle size={8} /> Check failed
                        </span>
                      ) : breachCount !== null ? (
                        breachCount > 0 ? (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-danger/15 text-danger font-semibold flex items-center gap-1 border border-danger/20">
                            ⚠ Breached: {breachCount.toLocaleString()} times
                          </span>
                        ) : (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal/15 text-teal font-semibold flex items-center gap-1 border border-teal/20">
                            ✓ Secure / Clean
                          </span>
                        )
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
                      <span className={cn(
                        "flex-1 truncate font-mono",
                        revealPassword ? "" : "tracking-widest"
                      )}>
                        {revealPassword ? decryptedEntry.password : "••••••••••••"}
                      </span>
                      <button 
                        onClick={() => setRevealPassword(r => !r)} 
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        {revealPassword ? <EyeOff size={11} /> : <Eye size={11} />}
                      </button>
                      <button 
                        onClick={() => handleCopyText(decryptedEntry.password, decryptedEntry.title, "Password")}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
                      >
                        <Copy size={11} />
                      </button>
                    </div>
                  </div>

                  {/* Website field */}
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Website</div>
                    <div className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-1.5 text-xs">
                      <span className="truncate pr-2 text-muted-foreground">
                        {getEntryUrl(decryptedEntry.id) || "No website URL"}
                      </span>
                      {getEntryUrl(decryptedEntry.id) && (
                        <a 
                          href={getEntryUrl(decryptedEntry.id)} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          <Globe size={11} />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* TOTP Field */}
                  {decryptedEntry.totp_secret && (
                    <div className="space-y-1">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">TOTP Code</div>
                      <div className="rounded-md border border-border bg-background p-2 flex items-center justify-between">
                        <TotpDisplay entryId={decryptedEntry.id} />
                      </div>
                    </div>
                  )}

                  {/* NOTES (Muted Text) */}
                  <div className="space-y-1">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Notes</div>
                    <p className="text-[10px] text-muted-foreground bg-background p-2 rounded border border-border font-medium">
                      {getEntryNotes(decryptedEntry.id) || "No notes recorded."}
                    </p>
                  </div>

                  {/* File Attachments (Change 3) */}
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      <Paperclip size={11} className="text-purple" />
                      <span>Attachments</span>
                    </div>
                    
                    <div className="space-y-1">
                      {attachmentsList.map((file, i) => (
                        <div key={i} className="flex items-center justify-between rounded-md border border-border bg-background p-2 text-[10px] leading-tight">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-1">
                            <FileText size={12} className="text-muted-foreground shrink-0" />
                            <div className="truncate">
                              <span className="font-semibold block truncate">{file.name}</span>
                              <span className="text-[8px] text-muted-foreground italic">{(file.size / 1024).toFixed(0)} KB</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => alert(`Downloading ${file.name}`)}
                              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
                            >
                              <Download size={11} />
                            </button>
                            <button
                              onClick={() => handleRemoveFileMock(file.name)}
                              className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-danger"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {attachmentsList.length === 0 && (
                        <p className="text-[10px] text-muted-foreground italic">No files attached.</p>
                      )}
                      
                      <button
                        onClick={handleAddFileMock}
                        className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[10px] text-muted-foreground hover:border-purple/60 hover:text-foreground mt-1 transition-colors"
                      >
                        <Plus size={10} />
                        <span>Add file</span>
                      </button>
                    </div>
                  </div>

                  {/* Autotype button trigger */}
                  <button
                    onClick={() => {
                      setAutotypeTimer(3);
                      setAutotypeOpen(true);
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted transition-colors mt-2"
                  >
                    <Keyboard size={12} className="text-purple" />
                    <span>Autotype</span>
                  </button>

                  {/* Timestamp */}
                  <div className="text-[9px] text-muted-foreground pt-1 italic text-center">
                    Modified {new Date(decryptedEntry.updated_at * 1000).toLocaleDateString()}
                  </div>
                </>
              ) : null}
            </div>

            {/* Bottom Actions */}
            <div className="flex gap-2 border-t border-border p-3 shrink-0 bg-sidebar/80">
              <Button 
                size="sm" 
                onClick={handleOpenEdit}
                className="flex-1 text-xs bg-purple text-white hover:bg-purple/90 gap-1 font-semibold"
              >
                <Edit size={11} /> Edit
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  if (decryptedEntry) {
                    const sum = entries.find(e => e.id === decryptedEntry.id);
                    if (sum) {
                      setEntryToDelete(sum);
                      setDeleteEntryOpen(true);
                    }
                  }
                }}
                className="border-danger/40 text-danger hover:bg-danger/10 hover:text-danger text-xs font-semibold"
              >
                Delete
              </Button>
            </div>
          </>
        )}
      </aside>

      {/* --- POPUPS & MODALS --- */}

      {/* 1. Add Entry Dialog */}
      {addEntryOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <form onSubmit={handleCreateSubmit} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 animate-fade-in text-foreground">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <h2 className="text-sm font-semibold">Add entry</h2>
              <button type="button" onClick={() => setAddEntryOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            {formError && (
              <p className="text-xs text-danger bg-danger/10 border border-danger/20 p-2 rounded-lg">{formError}</p>
            )}

            <div className="space-y-3.5 max-h-96 overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Name</label>
                <Input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="GitHub"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">URL</label>
                <div className="relative">
                  <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formUrl}
                    onChange={e => setFormUrl(e.target.value)}
                    placeholder="https://github.com"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Username</label>
                <Input
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  placeholder="Username or email"
                />
              </div>

              {/* Password row with generate */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Password</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={revealPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setRevealPassword(r => !r)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    >
                      {revealPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <Button 
                    type="button" 
                    onClick={openPasswordGenerator}
                    className="h-9 px-3 text-xs bg-purple text-white hover:bg-purple/90 shrink-0 font-semibold"
                  >
                    Generate
                  </Button>
                </div>
                {formPassword && (
                  <div className="pt-1.5 space-y-1">
                    <StrengthBar password={formPassword} />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">TOTP Secret (Key)</label>
                <div className="relative">
                  <QrCode size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple" />
                  <Input
                    value={formTotpSecret}
                    onChange={e => setFormTotpSecret(e.target.value)}
                    placeholder="Paste TOTP secret key"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Category</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value as Category)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="FINANCE">Finance</option>
                  <option value="SOCIAL">Social</option>
                  <option value="WORK">Work</option>
                  <option value="PERSONAL">Personal</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              {/* Tags Field (Change 2) */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Tags</label>
                <div className="relative">
                  <Tag size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formTags}
                    onChange={e => setFormTags(e.target.value)}
                    placeholder="e.g. work, critical, 2fa"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Notes</label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Optional notes"
                  rows={3}
                  className="w-full rounded-md border border-border bg-background p-2.5 text-xs outline-none focus:border-purple"
                />
              </div>

              {/* Upload zone dropzone (Change 3) */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">File Upload</label>
                <div 
                  onClick={() => {
                    const pick = { name: "recovery-key.txt", size: 1 * 1024 };
                    setFormAttachments(prev => [...prev, pick]);
                  }}
                  className="border-2 border-dashed border-border hover:border-purple/50 rounded-lg p-4 text-center cursor-pointer transition-colors bg-background/40"
                >
                  <Upload size={16} className="mx-auto text-muted-foreground mb-1" />
                  <span className="text-[10px] font-semibold block text-foreground">Drop files here or click to browse</span>
                  <span className="text-[8px] text-muted-foreground mt-0.5 block">Files are encrypted with AES-256 before storing</span>
                </div>
                {formAttachments.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {formAttachments.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[10px] border border-border font-medium">
                        {f.name} ({(f.size/1024).toFixed(0)}KB)
                        <button type="button" onClick={() => setFormAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                          <X size={10} className="hover:text-danger" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setAddEntryOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" className="text-xs bg-purple text-white hover:bg-purple/90 font-semibold">
                Save entry
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* 2. Edit Entry Dialog */}
      {editEntryOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <form onSubmit={handleEditSubmit} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 animate-fade-in text-foreground">
            <div className="flex justify-between items-center border-b border-border pb-2">
              <h2 className="text-sm font-semibold">Edit entry</h2>
              <button type="button" onClick={() => setEditEntryOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>

            {formError && (
              <p className="text-xs text-danger bg-danger/10 border border-danger/20 p-2 rounded-lg">{formError}</p>
            )}

            <div className="space-y-3.5 max-h-96 overflow-y-auto pr-1">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Name</label>
                <Input
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="GitHub"
                  required
                  autoFocus
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">URL</label>
                <div className="relative">
                  <Globe size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formUrl}
                    onChange={e => setFormUrl(e.target.value)}
                    placeholder="https://github.com"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Username</label>
                <Input
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  placeholder="Username or email"
                />
              </div>

              {/* Password row with generate */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Password</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={revealPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setRevealPassword(r => !r)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    >
                      {revealPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <Button 
                    type="button" 
                    onClick={openPasswordGenerator}
                    className="h-9 px-3 text-xs bg-purple text-white hover:bg-purple/90 shrink-0 font-semibold"
                  >
                    Generate
                  </Button>
                </div>
                {formPassword && (
                  <div className="pt-1.5 space-y-1">
                    <StrengthBar password={formPassword} />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">TOTP Secret (Key)</label>
                <div className="relative">
                  <QrCode size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-purple" />
                  <Input
                    value={formTotpSecret}
                    onChange={e => setFormTotpSecret(e.target.value)}
                    placeholder="Paste TOTP secret key"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Category</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value as Category)}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="FINANCE">Finance</option>
                  <option value="SOCIAL">Social</option>
                  <option value="WORK">Work</option>
                  <option value="PERSONAL">Personal</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>

              {/* Tags Field (Change 2) */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Tags</label>
                <div className="relative">
                  <Tag size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={formTags}
                    onChange={e => setFormTags(e.target.value)}
                    placeholder="e.g. work, critical, 2fa"
                    className="pl-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">Notes</label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Optional notes"
                  rows={3}
                  className="w-full rounded-md border border-border bg-background p-2.5 text-xs outline-none focus:border-purple"
                />
              </div>

              {/* Upload zone dropzone (Change 3) */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-muted-foreground">File Upload</label>
                <div 
                  onClick={() => {
                    const pick = { name: "recovery-key.txt", size: 1 * 1024 };
                    setFormAttachments(prev => [...prev, pick]);
                  }}
                  className="border-2 border-dashed border-border hover:border-purple/50 rounded-lg p-4 text-center cursor-pointer transition-colors bg-background/40"
                >
                  <Upload size={16} className="mx-auto text-muted-foreground mb-1" />
                  <span className="text-[10px] font-semibold block text-foreground">Drop files here or click to browse</span>
                  <span className="text-[8px] text-muted-foreground mt-0.5 block">Files are encrypted with AES-256 before storing</span>
                </div>
                {formAttachments.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {formAttachments.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-[10px] border border-border font-medium">
                        {f.name} ({(f.size/1024).toFixed(0)}KB)
                        <button type="button" onClick={() => setFormAttachments(prev => prev.filter((_, idx) => idx !== i))}>
                          <X size={10} className="hover:text-danger" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => setEditEntryOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" className="text-xs bg-purple text-white hover:bg-purple/90 font-semibold">
                Save Changes
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* 3. Password Generator Dialog (Modal 2) */}
      <PasswordGeneratorModal
        isOpen={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        onApply={(password) => setFormPassword(password)}
      />

      {/* 4. Autotype Countdown Dialog (Modal 3) */}
      {autotypeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs">
          <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-6 shadow-xl text-center space-y-4 animate-scale-up text-foreground">
            <div className="mx-auto h-12 w-12 rounded-full bg-purple/10 flex items-center justify-center text-purple">
              <Keyboard size={24} />
            </div>
            
            <div className="space-y-1">
              <h2 className="text-sm font-bold tracking-tight">Switch to your app</h2>
              <p className="text-xs text-muted-foreground">PassVault will type your credentials in:</p>
            </div>

            {/* Countdown animation circular progress */}
            <div className="relative h-20 w-20 mx-auto flex items-center justify-center">
              <svg className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx={40} cy={40} r={34} stroke="var(--color-border)" strokeWidth={4} fill="none" />
                <circle 
                  cx={40} 
                  cy={40} 
                  r={34} 
                  stroke="var(--color-purple)" 
                  strokeWidth={4} 
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - autotypeTimer / 3)}`}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                />
              </svg>
              <span className="text-3xl font-extrabold text-purple font-mono animate-pulse">{autotypeTimer}</span>
            </div>

            <Button 
              type="button" 
              variant="outline" 
              onClick={() => setAutotypeOpen(false)} 
              className="w-full text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* 5. Delete Entry Dialog (Modal 4) */}
      {deleteEntryOpen && entryToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-[380px] rounded-xl border border-border bg-card p-5 shadow-xl space-y-4 text-foreground">
            <div className="flex gap-3 text-danger">
              <div className="h-10 w-10 shrink-0 rounded-full bg-danger/10 flex items-center justify-center text-danger">
                <Trash2 size={18} />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">Delete this entry?</h2>
                <p className="text-xs text-muted-foreground leading-normal">
                  This will permanently remove <span className="font-semibold text-foreground">"{entryToDelete.title}"</span> from your vault. This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-border/40">
              <Button variant="outline" size="sm" onClick={() => { setEntryToDelete(null); setDeleteEntryOpen(false); }} className="text-xs">
                Cancel
              </Button>
              <Button size="sm" onClick={handleDeleteSubmit} className="text-xs bg-danger hover:bg-danger/90 text-white border-0">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --- FLOATING ABSOLUTE POPUPS & CONTEXT MENUS --- */}

      {/* Context Menu (Right-click row) */}
      {contextMenu && (
        <div 
          style={{ top: contextMenu.y, left: contextMenu.x }}
          className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg text-[11px] font-semibold text-foreground select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            onClick={() => handleContextMenuOption("copy-pw")}
            className="w-full px-2.5 py-1.5 text-left hover:bg-purple-soft/30 hover:text-purple rounded-md transition-colors"
          >
            Copy password
          </button>
          <button 
            onClick={() => handleContextMenuOption("copy-un")}
            className="w-full px-2.5 py-1.5 text-left hover:bg-purple-soft/30 hover:text-purple rounded-md transition-colors"
          >
            Copy username
          </button>
          <button 
            onClick={() => handleContextMenuOption("edit")}
            className="w-full px-2.5 py-1.5 text-left hover:bg-purple-soft/30 hover:text-purple rounded-md transition-colors"
          >
            Edit entry
          </button>
          <button 
            onClick={() => handleContextMenuOption("manage-tags")}
            className="w-full px-2.5 py-1.5 text-left hover:bg-purple-soft/30 hover:text-purple rounded-md transition-colors"
          >
            Manage tags
          </button>
          <div className="my-1 border-t border-border" />
          <button 
            onClick={() => handleContextMenuOption("delete")}
            className="w-full px-2.5 py-1.5 text-left text-danger hover:bg-danger/10 rounded-md transition-colors"
          >
            Delete entry
          </button>
        </div>
      )}

      {/* Manage Tags popover checklist */}
      {tagsPopover && (
        <div
          style={{ 
            top: Math.min(tagsPopover.y, window.innerHeight - 240), 
            left: Math.min(tagsPopover.x, window.innerWidth - 220) 
          }}
          className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-3.5 shadow-lg space-y-2.5 animate-scale-up text-foreground select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center pb-1.5 border-b border-border/40">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Tags for {tagsPopover.entry.title}</span>
            <button onClick={() => setTagsPopover(null)} className="text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
            {customTags.map((tag) => {
              const applied = getEntryTags(tagsPopover.entry.id, tagsPopover.entry.title).includes(tag);
              return (
                <label key={tag} className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applied}
                    onChange={() => {
                      const current = getEntryTags(tagsPopover.entry.id, tagsPopover.entry.title);
                      const next = current.includes(tag) ? current.filter(t => t !== tag) : [...current, tag];
                      setEntryTags(tagsPopover.entry.id, next);
                      
                      // Trigger state refresh for groupings
                      fetchVaults();
                    }}
                    className="rounded text-purple h-3.5 w-3.5 border-border cursor-pointer focus:ring-purple"
                  />
                  <span>#{tag}</span>
                </label>
              );
            })}
          </div>

          <div className="border-t border-border/50 pt-2 flex items-center gap-1.5">
            <input
              type="text"
              placeholder="New tag…"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const target = e.currentTarget;
                  const newTag = target.value.trim().toLowerCase();
                  if (newTag) {
                    // Create tag globally
                    if (!customTags.includes(newTag)) {
                      saveCustomTags([...customTags, newTag]);
                    }
                    // Apply to this entry
                    const current = getEntryTags(tagsPopover.entry.id, tagsPopover.entry.title);
                    if (!current.includes(newTag)) {
                      const next = [...current, newTag];
                      setEntryTags(tagsPopover.entry.id, next);
                      fetchVaults();
                    }
                    target.value = "";
                  }
                }
              }}
              className="w-full text-[10px] bg-background border border-border rounded p-1 outline-none focus:border-purple"
            />
          </div>
        </div>
      )}

    </div>
  );
}
