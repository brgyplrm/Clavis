import { useState, useMemo, useRef } from "react";
import { 
  Clock, Search, Plus, X, QrCode, Keyboard, 
  Eye, EyeOff, Monitor, Upload, Check, ArrowLeft, RefreshCw, AlertTriangle, Trash2
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";
import { avatarColor, initials } from "./Dashboard";
import { useVaultStore } from "../hooks/useVaultStore";
import TotpDisplay from "../components/TotpDisplay";
import { listCaptureSources, captureSource, CaptureSource } from "../lib/tauri";

interface ParsedOtp {
  issuer: string;
  account: string;
  secret: string;
}

function parseOtpAuthUri(uri: string): ParsedOtp | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== "otpauth:") {
      return { issuer: "", account: "", secret: uri.trim() };
    }
    
    const issuer = url.searchParams.get("issuer") || "";
    const secret = url.searchParams.get("secret") || "";
    
    let path = decodeURIComponent(url.pathname);
    path = path.replace(/^\/?totp\//, "").replace(/^\//, "");
    
    const parts = path.split(":");
    const account = parts.length > 1 ? parts[1] : parts[0];
    const inferredIssuer = parts.length > 1 ? parts[0] : issuer;
    
    return {
      issuer: inferredIssuer || issuer,
      account,
      secret,
    };
  } catch {
    return { issuer: "", account: "", secret: uri.trim() };
  }
}

interface TotpItem {
  id: string;
  name: string;
  username: string;
}

export default function Authenticator() {
  const { entries, createEntry, deleteEntry } = useVaultStore();

  const items = useMemo<TotpItem[]>(() => {
    return entries
      .filter(e => e.has_totp)
      .map(e => ({
        id: e.id,
        name: e.title,
        username: e.username || "No username",
      }));
  }, [entries]);
  const [query, setQuery] = useState("");
  const [addOtpOpen, setAddOtpOpen] = useState(false);

  // Modal choice states
  const [selectedCard, setSelectedCard] = useState<"qr" | "manual" | null>(null);
  const [formAccount, setFormAccount] = useState("");
  const [formIssuer, setFormIssuer] = useState("");
  const [formSecret, setFormSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  // Real screen/window capture wizard states
  const [qrStep, setQrStep] = useState<"choice" | "list" | "scanning" | "result">("choice");
  const [sourceType, setSourceType] = useState<"screen" | "window" | null>(null);
  const [sourcesList, setSourcesList] = useState<CaptureSource[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [capturedImgUrl, setCapturedImgUrl] = useState<string | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadSources = async (type: "screen" | "window") => {
    setLoadingSources(true);
    setCaptureError(null);
    try {
      const list = await listCaptureSources();
      setSourcesList(list);
      setSourceType(type);
      setQrStep("list");
    } catch (err: any) {
      setCaptureError("Failed to fetch windows/screens list: " + err);
    } finally {
      setLoadingSources(false);
    }
  };

  const decodeQrFromDataUrl = (dataUrl: string): Promise<ParsedOtp | null> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Could not construct 2D context"));
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const jsQR = (await import("jsqr")).default;
          const code = jsQR(imgData.data, imgData.width, imgData.height);
          if (code) {
            resolve(parseOtpAuthUri(code.data));
          } else {
            resolve(null);
          }
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Failed to load screenshot"));
      img.src = dataUrl;
    });
  };

  const handleCapture = async (sourceId: string) => {
    setScanState("scanning");
    setQrStep("scanning");
    setCaptureError(null);
    setCapturedImgUrl(null);
    try {
      const dataUrl = await captureSource(sourceId);
      setCapturedImgUrl(dataUrl);

      const parsed = await decodeQrFromDataUrl(dataUrl);
      if (parsed && parsed.secret) {
        setScanState("success");
        setFormAccount(parsed.account);
        setFormIssuer(parsed.issuer);
        setFormSecret(parsed.secret);
        setQrStep("result");
      } else {
        setScanState("error");
        setCaptureError("No valid 2FA QR Code detected on this screen/window.");
        setQrStep("result");
      }
    } catch (err: any) {
      setScanState("error");
      setCaptureError("Capture failed: " + err);
      setQrStep("result");
    }
  };

  const closeAddOtpModal = () => {
    setAddOtpOpen(false);
    setScanState("idle");
    setCaptureError(null);
    setSelectedCard(null);
    setQrStep("choice");
    setCapturedImgUrl(null);
    setSourceSearch("");
  };

  // QR Scan Viewfinder States
  const [scanState, setScanState] = useState<"idle" | "scanning" | "success" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredItems = useMemo(() => {
    return items.filter(e => {
      if (query) {
        const q = query.toLowerCase();
        return e.name.toLowerCase().includes(q) || e.username.toLowerCase().includes(q);
      }
      return true;
    });
  }, [items, query]);

  const filteredSources = useMemo(() => {
    return sourcesList.filter(s => {
      if (s.source_type !== sourceType) return false;
      if (!sourceSearch) return true;
      const q = sourceSearch.toLowerCase();
      return (
        s.name.toLowerCase().includes(q) ||
        s.app_name?.toLowerCase().includes(q) ||
        s.title?.toLowerCase().includes(q)
      );
    });
  }, [sourcesList, sourceType, sourceSearch]);

  const handleSelectCard = (card: "qr" | "manual") => {
    setSelectedCard(card);
    setScanState("idle");
    setCaptureError(null);
    setQrStep("choice");
    setCapturedImgUrl(null);
  };

  // File Upload real parsing (No mocks!)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setScanState("scanning");
      setCaptureError(null);
      setCapturedImgUrl(null);
      setQrStep("scanning");

      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        setCapturedImgUrl(dataUrl);
        try {
          const parsed = await decodeQrFromDataUrl(dataUrl);
          if (parsed && parsed.secret) {
            setScanState("success");
            setFormAccount(parsed.account);
            setFormIssuer(parsed.issuer);
            setFormSecret(parsed.secret);
            setQrStep("result");
          } else {
            setScanState("error");
            setCaptureError("No valid 2FA QR Code detected in this image file.");
            setQrStep("result");
          }
        } catch (err: any) {
          setScanState("error");
          setCaptureError("Failed to parse image file: " + err);
          setQrStep("result");
        }
      };
      reader.readAsDataURL(file);
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
            return (
              <div 
                key={e.id}
                className="relative rounded-lg border border-border bg-card p-4 flex flex-col justify-between h-32 hover:border-purple/40 transition-colors shadow-sm"
              >
                {/* Header */}
                <div className="flex items-start gap-2.5 justify-between">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <div
                      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white text-[11px]"
                      style={{ background: avatarColor(e.name), width: 32, height: 32 }}
                    >
                      {initials(e.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold truncate text-foreground">{e.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate mt-0.5">{e.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(evt) => {
                      evt.stopPropagation();
                      setDeleteConfirmId(e.id);
                    }}
                    className="text-muted-foreground hover:text-danger p-1 rounded hover:bg-muted transition-colors shrink-0"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {/* OTP Code Area */}
                <div className="flex items-center justify-between mt-2.5 bg-background border border-border rounded-lg p-2.5">
                  <TotpDisplay entryId={e.id} />
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


      {/* ADD OTP DIALOG */}
      {addOtpOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-5 animate-fade-in text-foreground">
            
            {/* Header */}
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-semibold">Add OTP</h2>
              <button 
                type="button" 
                onClick={closeAddOtpModal} 
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
                <div className="relative border border-border rounded-lg bg-black/40 overflow-hidden flex flex-col h-60">
                  
                  {/* STEP 1: CHOICE SCREEN */}
                  {qrStep === "choice" && (
                    <div className="flex-1 flex flex-col justify-center items-center p-6 space-y-4">
                      <QrCode size={36} className="text-purple opacity-70 animate-pulse" />
                      <p className="text-[11px] text-muted-foreground text-center max-w-[280px]">
                        Choose a target containing your 2FA QR code to scan it securely and locally.
                      </p>
                      <div className="flex flex-col gap-2 w-full max-w-[280px]">
                        <Button 
                          onClick={() => loadSources("screen")} 
                          disabled={loadingSources}
                          variant="outline" 
                          className="text-xs h-8 justify-start gap-2 border-border/80"
                        >
                          <Monitor size={12} className="text-purple" />
                          Capture Entire Screen
                        </Button>
                        <Button 
                          onClick={() => loadSources("window")} 
                          disabled={loadingSources}
                          variant="outline" 
                          className="text-xs h-8 justify-start gap-2 border-border/80"
                        >
                          <QrCode size={12} className="text-purple" />
                          Capture Application Window
                        </Button>
                        <Button 
                          onClick={() => fileInputRef.current?.click()} 
                          variant="outline" 
                          className="text-xs h-8 justify-start gap-2 border-border/80"
                        >
                          <Upload size={12} className="text-purple" />
                          Upload Screenshot Image
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* STEP 2: SOURCES LIST GRID */}
                  {qrStep === "list" && (
                    <div className="flex-1 flex flex-col h-full min-h-0 bg-card">
                      <div className="flex items-center gap-2 p-3 border-b border-border/60">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => setQrStep("choice")}
                        >
                          <ArrowLeft size={13} />
                        </Button>
                        <Input 
                          placeholder={sourceType === "screen" ? "Filter screens..." : "Search open apps/windows..."}
                          value={sourceSearch}
                          onChange={e => setSourceSearch(e.target.value)}
                          className="h-7 text-xs flex-1 bg-muted/40"
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 space-y-1.5 max-h-[190px]">
                        {filteredSources.map(src => (
                          <button
                            key={src.id}
                            type="button"
                            onClick={() => handleCapture(src.id)}
                            className="w-full text-left p-2 border border-border/50 rounded-md hover:border-purple/40 hover:bg-purple/5 transition-all flex justify-between items-center text-xs group"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="font-semibold text-foreground truncate flex items-center gap-1.5">
                                {src.source_type === "screen" ? <Monitor size={11} className="text-purple/80" /> : <span className="bg-purple/10 text-purple text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase">{src.app_name}</span>}
                                <span className="truncate">{src.source_type === "screen" ? src.name : src.title}</span>
                              </div>
                            </div>
                            <span className="text-[9px] text-muted-foreground group-hover:text-purple/80 shrink-0 font-mono">
                              {src.width}x{src.height}
                            </span>
                          </button>
                        ))}
                        {filteredSources.length === 0 && (
                          <p className="text-[10px] text-muted-foreground text-center py-6">No matching targets found.</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* STEP 3: SCANNING / VIEWING STATUS */}
                  {qrStep === "scanning" && (
                    <div className="flex-1 flex flex-col justify-center items-center p-6 space-y-3">
                      <RefreshCw size={24} className="text-purple animate-spin" />
                      <p className="text-xs font-semibold text-foreground">Capturing select target...</p>
                      <p className="text-[10px] text-muted-foreground">Running local QR decoding engine</p>
                    </div>
                  )}

                  {/* STEP 4: SCREENSHOT RESULTS PREVIEW */}
                  {qrStep === "result" && capturedImgUrl && (
                    <div className="flex-1 relative flex flex-col justify-center items-center overflow-hidden bg-zinc-950">
                      <img 
                        src={capturedImgUrl} 
                        alt="Captured screen/window" 
                        className="w-full h-full object-contain opacity-70"
                      />
                      
                      {/* Scanner feedback overlay */}
                      <div className={cn(
                        "absolute inset-0 flex flex-col justify-center items-center p-4 text-center backdrop-blur-xs",
                        scanState === "success" ? "bg-teal/10" : "bg-danger/10"
                      )}>
                        {scanState === "success" ? (
                          <div className="bg-teal/90 text-white rounded-full p-2.5 shadow-lg border border-teal flex items-center justify-center animate-bounce mb-2">
                            <Check size={20} />
                          </div>
                        ) : (
                          <div className="bg-danger/90 text-white rounded-full p-2.5 shadow-lg border border-danger flex items-center justify-center mb-2">
                            <AlertTriangle size={20} />
                          </div>
                        )}
                        <span className={cn("text-xs font-bold px-2 py-0.5 rounded shadow-xs text-white", scanState === "success" ? "bg-teal" : "bg-danger")}>
                          {scanState === "success" ? "QR code detected" : "Scanning failed"}
                        </span>
                        <p className="text-[10px] text-white/90 drop-shadow-md mt-1.5 max-w-[300px] font-medium leading-relaxed">
                          {scanState === "success" ? "Account secrets successfully read and populated below." : (captureError || "Could not find a valid 2FA QR code.")}
                        </p>
                        <div className="mt-3.5 flex gap-2">
                          <Button
                            onClick={() => {
                              setQrStep("choice");
                              setCapturedImgUrl(null);
                            }}
                            variant="secondary"
                            className="h-7 text-[10px] bg-white/20 text-white hover:bg-white/30 border-0"
                          >
                            Scan Another
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
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
                    onClick={closeAddOtpModal} 
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


      {/* DELETE CONFIRMATION DIALOG */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl space-y-4 animate-fade-in text-foreground">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-danger/10 text-danger rounded-full shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-semibold text-foreground">Delete OTP Account?</h3>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Are you sure you want to delete this authenticator entry? This action is permanent and cannot be undone.
                </p>
              </div>
            </div>
            
            <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setDeleteConfirmId(null)} 
                className="text-[10px] h-7"
              >
                Cancel
              </Button>
              <Button 
                type="button" 
                onClick={async () => {
                  try {
                    await deleteEntry(deleteConfirmId);
                    setDeleteConfirmId(null);
                  } catch (err) {
                    alert("Failed to delete entry: " + err);
                  }
                }}
                className="text-[10px] h-7 bg-danger text-white hover:bg-danger/90"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
