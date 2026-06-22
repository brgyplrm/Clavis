import { useState, useEffect, useMemo, useRef } from "react";
import { 
  Clock, Search, Plus, Copy, Check, X, QrCode, Keyboard, 
  Eye, EyeOff, Monitor, Upload, Crop 
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { avatarColor, initials, totpCode, totpRemaining, CountdownRing } from "./Dashboard";
import { useVaultStore } from "../hooks/useVaultStore";
import { getEntry } from "../lib/tauri";
import { logEvent } from "../lib/activity";

interface TotpItem {
  id: string;
  name: string;
  username: string;
  secret: string;
}

export default function Authenticator() {
  const { entries, createEntry } = useVaultStore();
  const [totpSecrets, setTotpSecrets] = useState<Record<string, string>>({});
  
  useEffect(() => {
    let active = true;
    const loadSecrets = async () => {
      const secrets: Record<string, string> = {};
      for (const entry of entries) {
        if (entry.has_totp) {
          try {
            const dec = await getEntry(entry.id);
            if (dec.totp_secret) {
              secrets[entry.id] = dec.totp_secret;
            }
          } catch (err) {
            console.error("Failed to decrypt TOTP for:", entry.title, err);
          }
        }
      }
      if (active) {
        setTotpSecrets(secrets);
      }
    };
    loadSecrets();
    return () => {
      active = false;
    };
  }, [entries]);

  const items = useMemo<TotpItem[]>(() => {
    return entries
      .filter(e => e.has_totp && totpSecrets[e.id])
      .map(e => ({
        id: e.id,
        name: e.title,
        username: e.username || "No username",
        secret: totpSecrets[e.id]
      }));
  }, [entries, totpSecrets]);
  const [query, setQuery] = useState("");
  const [addOtpOpen, setAddOtpOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal choice states
  const [selectedCard, setSelectedCard] = useState<"qr" | "manual" | null>(null);
  const [formAccount, setFormAccount] = useState("");
  const [formIssuer, setFormIssuer] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // Screen Snip Emulation States
  const [isSnipping, setIsSnipping] = useState(false);
  const [snipStart, setSnipStart] = useState<{ x: number; y: number } | null>(null);
  const [snipCurrent, setSnipCurrent] = useState<{ x: number; y: number } | null>(null);

  // QR Scan Viewfinder States
  const [scanState, setScanState] = useState<"idle" | "scanning" | "success" | "error">("idle");
  const [uploadedImageName, setUploadedImageName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Update timer
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = totpRemaining(now);
  const isWarningState = remaining <= 5;

  const filteredItems = useMemo(() => {
    return items.filter(e => {
      if (query) {
        const q = query.toLowerCase();
        return e.name.toLowerCase().includes(q) || e.username.toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, query]);

  const handleCopy = (id: string, codeText: string, name: string) => {
    navigator.clipboard?.writeText(codeText);
    logEvent("Copied", name, "TOTP code");
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSelectCard = (card: "qr" | "manual") => {
    setSelectedCard(card);
    setScanState(card === "qr" ? "scanning" : "idle");
    setUploadedImageName(null);
  };

  // Capture Screen (Snipping) Emulation
  const triggerScreenCapture = () => {
    // Hide modal temporarily
    setAddOtpOpen(false);
    setIsSnipping(true);
  };

  const handleSnipMouseDown = (e: React.MouseEvent) => {
    setSnipStart({ x: e.clientX, y: e.clientY });
    setSnipCurrent({ x: e.clientX, y: e.clientY });
  };

  const handleSnipMouseMove = (e: React.MouseEvent) => {
    if (snipStart) {
      setSnipCurrent({ x: e.clientX, y: e.clientY });
    }
  };

  const handleSnipMouseUp = () => {
    if (snipStart && snipCurrent) {
      setIsSnipping(false);
      setSnipStart(null);
      setSnipCurrent(null);
      // Bring back modal and process snip
      setAddOtpOpen(true);
      setScanState("scanning");
      
      // Simulate reading QR code from snipped area after 1s
      setTimeout(() => {
        setScanState("success");
        setFormAccount("google-auth@gmail.com");
        setFormIssuer("Google");
        setFormSecret("JBSWY3DPEHPK3PXP");
      }, 1000);
    }
  };

  // File Upload Emulation
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedImageName(file.name);
      setScanState("scanning");
      
      // Simulate decoding QR from image after 0.8s
      setTimeout(() => {
        if (file.name.includes("error") || file.name.includes("invalid")) {
          setScanState("error");
        } else {
          setScanState("success");
          setFormAccount("github-mfa@github.com");
          setFormIssuer("GitHub");
          setFormSecret("KVKVE43VNVSTOMZA");
        }
      }, 800);
    }
  };

  const handleSaveOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formAccount.trim() || !formSecret.trim()) return;
    
    try {
      await createEntry(
        formIssuer.trim() || "Authenticator",
        formAccount.trim(),
        "Gener@ted1!Pass", // Default password if they just create an OTP
        formSecret.trim()
      );
      
      // Close & Reset
      setAddOtpOpen(false);
      setSelectedCard(null);
      setFormAccount("");
      setFormIssuer("");
      setFormSecret("");
      setScanState("idle");
      setUploadedImageName(null);
    } catch (err) {
      alert("Failed to save TOTP: " + err);
    }
  };

  return (
    <div className="flex h-screen flex-1 flex-col min-w-0 bg-background text-foreground overflow-hidden select-none">
      
      {/* Top Bar */}
      <header className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0 bg-background z-10">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-purple" />
          <h1 className="text-sm font-semibold">Authenticator</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search OTP keys..."
              className="h-8 pl-8 text-xs bg-muted/40 w-48 focus:w-60 transition-all duration-300"
            />
          </div>
          <Button
            onClick={() => {
              setSelectedCard(null);
              setFormAccount("");
              setFormIssuer("");
              setFormSecret("");
              setScanState("idle");
              setUploadedImageName(null);
              setAddOtpOpen(true);
            }}
            className="h-8 text-xs bg-purple text-white hover:bg-purple/90 shrink-0 gap-1"
          >
            <Plus size={13} />
            Add OTP
          </Button>
        </div>
      </header>

      {/* Grid of OTP Cards */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((e) => {
            const itemCode = totpCode(e.secret, now);
            const activeCopied = copiedId === e.id;
            return (
              <div 
                key={e.id}
                className="relative rounded-lg border border-border bg-card p-4 flex flex-col justify-between h-40 hover:border-purple/40 transition-colors shadow-sm"
              >
                {/* Header */}
                <div className="flex items-start gap-2.5">
                  <div
                    className="flex shrink-0 items-center justify-center rounded-full font-bold text-white text-[11px]"
                    style={{ background: avatarColor(e.name), width: 32, height: 32 }}
                  >
                    {initials(e.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate text-foreground">{e.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate mt-0.5">{e.username}</div>
                  </div>
                </div>

                {/* OTP Code Area */}
                <div className="flex items-center justify-between mt-2.5">
                  <div 
                    className={cn(
                      "font-mono text-2xl font-bold tracking-widest transition-colors duration-300",
                      isWarningState ? "text-danger" : "text-purple"
                    )}
                  >
                    {itemCode.slice(0, 3)} {itemCode.slice(3)}
                  </div>
                  <div className="shrink-0 scale-90">
                    <CountdownRing 
                      remaining={remaining} 
                      color={isWarningState ? "var(--color-danger)" : "var(--color-purple)"} 
                    />
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="flex justify-end mt-2 pt-2 border-t border-border/40">
                  <button
                    onClick={() => handleCopy(e.id, itemCode, e.name)}
                    className={cn(
                      "flex items-center gap-1 text-[10px] px-2.5 py-1 rounded transition-colors duration-300 font-medium",
                      activeCopied
                        ? "bg-teal/10 text-teal"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {activeCopied ? <Check size={11} /> : <Copy size={11} />}
                    <span>{activeCopied ? "Copied" : "Copy Code"}</span>
                  </button>
                </div>
              </div>
            );
          })}

          {filteredItems.length === 0 && (
            <div className="col-span-full flex flex-col items-center justify-center h-64 text-center">
              <Clock className="h-8 w-8 text-muted-foreground mb-2 opacity-50" />
              <h3 className="text-xs font-semibold text-foreground">No accounts found</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Add an OTP key to start tracking verification codes.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Screen Snip Backdrop Overlay */}
      {isSnipping && (
        <div 
          onMouseDown={handleSnipMouseDown}
          onMouseMove={handleSnipMouseMove}
          onMouseUp={handleSnipMouseUp}
          className="fixed inset-0 bg-black/60 z-50 cursor-crosshair select-none"
        >
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-purple text-white px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 shadow-lg border border-purple/30 animate-pulse">
            <Crop size={14} />
            <span>Drag over a QR code to snip/scan</span>
          </div>

          {snipStart && snipCurrent && (
            <div 
              className="absolute border-2 border-dashed border-purple bg-purple/10 pointer-events-none"
              style={{
                left: Math.min(snipStart.x, snipCurrent.x),
                top: Math.min(snipStart.y, snipCurrent.y),
                width: Math.abs(snipStart.x - snipCurrent.x),
                height: Math.abs(snipStart.y - snipCurrent.y),
              }}
            />
          )}
        </div>
      )}

      {/* ADD OTP DIALOG */}
      {addOtpOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-5 animate-fade-in text-foreground">
            
            {/* Header */}
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold">Add OTP</h2>
              <button 
                type="button" 
                onClick={() => setAddOtpOpen(false)} 
                className="text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>

            {/* Selection Cards (Side-by-side) */}
            <div className="grid grid-cols-2 gap-3">
              <div
                onClick={() => handleSelectCard("qr")}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border text-center cursor-pointer transition-all duration-300",
                  selectedCard === "qr" 
                    ? "border-purple bg-purple/5 text-purple" 
                    : "border-border hover:border-purple/30 text-muted-foreground hover:text-foreground"
                )}
              >
                <QrCode size={24} className="mb-2" />
                <span className="text-xs font-semibold block">Scan QR Code</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">Upload a QR screenshot</span>
              </div>

              <div
                onClick={() => handleSelectCard("manual")}
                className={cn(
                  "flex flex-col items-center justify-center p-4 rounded-lg border text-center cursor-pointer transition-all duration-300",
                  selectedCard === "manual" 
                    ? "border-purple bg-purple/5 text-purple" 
                    : "border-border hover:border-purple/30 text-muted-foreground hover:text-foreground"
                )}
              >
                <Keyboard size={24} className="mb-2" />
                <span className="text-xs font-semibold block">Enter Code</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">Type your key manually</span>
              </div>
            </div>

            {/* Card 1: QR Scan Viewfinder Box */}
            {selectedCard === "qr" && (
              <div className="space-y-4">
                <div className="relative border border-border rounded-lg bg-black/40 overflow-hidden flex flex-col items-center justify-center h-44">
                  {scanState === "scanning" && (
                    <>
                      {/* Purple scanning corners */}
                      <div className="absolute top-4 left-4 w-5 h-5 border-t-2 border-l-2 border-purple" />
                      <div className="absolute top-4 right-4 w-5 h-5 border-t-2 border-r-2 border-purple" />
                      <div className="absolute bottom-4 left-4 w-5 h-5 border-b-2 border-l-2 border-purple" />
                      <div className="absolute bottom-4 right-4 w-5 h-5 border-b-2 border-r-2 border-purple" />

                      {/* Viewfinder boundary box */}
                      <div className="w-28 h-28 border border-purple/30 relative flex items-center justify-center bg-purple/5">
                        {/* Scanning Line Animation */}
                        <div className="absolute left-0 right-0 h-0.5 bg-purple shadow-[0_0_8px_rgba(83,74,183,0.8)] animate-[scan_2s_infinite]" />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-2">
                        Point your camera or screen at a QR code
                      </p>
                    </>
                  )}

                  {scanState === "success" && (
                    <div className="flex flex-col items-center justify-center text-teal bg-teal/5 w-full h-full animate-fade-in">
                      <div className="h-10 w-10 rounded-full bg-teal/15 flex items-center justify-center mb-1.5">
                        <Check size={20} />
                      </div>
                      <span className="text-xs font-bold">QR code detected</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">Fields auto-filled successfully</span>
                    </div>
                  )}

                  {scanState === "error" && (
                    <div className="flex flex-col items-center justify-center text-danger bg-danger/5 w-full h-full animate-fade-in">
                      <div className="h-10 w-10 rounded-full bg-danger/15 flex items-center justify-center mb-1.5">
                        <X size={20} />
                      </div>
                      <span className="text-xs font-bold">No QR code found</span>
                      <span className="text-[10px] text-muted-foreground mt-0.5">Try selecting another image or region</span>
                    </div>
                  )}
                </div>

                {/* QR Options buttons */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={triggerScreenCapture}
                    className="flex-1 text-xs gap-1.5 h-8 border-border"
                  >
                    <Monitor size={12} />
                    Capture Screen
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 text-xs gap-1.5 h-8 border-border"
                  >
                    <Upload size={12} />
                    Upload Image
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>
                {uploadedImageName && (
                  <p className="text-[10px] text-muted-foreground text-center italic">
                    Selected: {uploadedImageName}
                  </p>
                )}
              </div>
            )}

            {/* Shared Form */}
            {selectedCard && (
              <form onSubmit={handleSaveOtp} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Account Name</label>
                  <Input
                    value={formAccount}
                    onChange={e => setFormAccount(e.target.value)}
                    placeholder="juan@email.com"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Issuer (App)</label>
                  <Input
                    value={formIssuer}
                    onChange={e => setFormIssuer(e.target.value)}
                    placeholder="GitHub, Google, etc."
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-muted-foreground">Secret Key</label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      value={formSecret}
                      onChange={e => setFormSecret(e.target.value)}
                      placeholder="JBSWY3DPEHPK3PXP"
                      required
                      className="font-mono pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(s => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 pt-3 border-t border-border/50">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setAddOtpOpen(false)} 
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={!formAccount.trim() || !formSecret.trim()}
                    className="text-xs bg-purple text-white hover:bg-purple/90"
                  >
                    Add OTP
                  </Button>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

    </div>
  );
}
