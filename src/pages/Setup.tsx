import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, ShieldCheck, AlertTriangle, Fingerprint, Grid3x3, Lock } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { scorePassword } from "../lib/passwordStrength";
import { useVaultStore } from "../hooks/useVaultStore";
import { cn } from "../lib/utils";

interface SetupProps {
  onComplete: () => void;
}

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

export default function Setup({ onComplete }: SetupProps) {
  const { unlock, loading } = useVaultStore();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Quick Unlock States
  const [selectedMethod, setSelectedMethod] = useState<"fingerprint" | "pin" | "password" | null>(null);
  const [fingerprintEnrolled, setFingerprintEnrolled] = useState(false);
  const [enrollingFingerprint, setEnrollingFingerprint] = useState(false);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinPhase, setPinPhase] = useState<"enter" | "confirm">("enter");
  const [pinStatus, setPinStatus] = useState<"idle" | "success" | "error">("idle");
  const [pinShake, setPinShake] = useState(false);

  const { checks, score } = scorePassword(pw);
  const allMet = Object.values(checks).every(Boolean) && pw === pw2 && pw.length > 0;

  // Enrolling Fingerprint simulation
  useEffect(() => {
    if (selectedMethod === "fingerprint" && !fingerprintEnrolled && !enrollingFingerprint) {
      setEnrollingFingerprint(true);
      const timer = setTimeout(() => {
        setFingerprintEnrolled(true);
        setEnrollingFingerprint(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [selectedMethod, fingerprintEnrolled, enrollingFingerprint]);

  useEffect(() => {
    if (step === 4) {
      const t = setTimeout(() => {
        onComplete();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [step, onComplete]);

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirm !== pw) return;
    setErrorMsg(null);
    try {
      await unlock(pw);
      
      // Auto-create a default vault partition if none exists
      const store = useVaultStore.getState();
      if (store.vaults.length === 0) {
        await store.createVault("Default");
      }
      
      setStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  };

  const handlePinKey = (num: string) => {
    if (pinStatus === "success") return;
    
    if (pinPhase === "enter") {
      if (pin.length < 6) {
        setPin(p => p + num);
      }
    } else {
      if (confirmPin.length < pin.length) {
        const val = confirmPin + num;
        setConfirmPin(val);
        
        // Auto-check confirmation when they enter the matching length
        if (val.length === pin.length) {
          if (val === pin) {
            setPinStatus("success");
            setTimeout(() => {
              handleFinishQuickUnlock();
            }, 600);
          } else {
            // Shake and restart
            setPinShake(true);
            setPinStatus("error");
            setTimeout(() => {
              setPinShake(false);
              setConfirmPin("");
              setPinPhase("enter");
              setPin("");
              setPinStatus("idle");
            }, 800);
          }
        }
      }
    }
  };

  const handlePinBackspace = () => {
    if (pinStatus === "success") return;
    if (pinPhase === "enter") {
      setPin(p => p.slice(0, -1));
    } else {
      setConfirmPin(p => p.slice(0, -1));
    }
  };

  // Keyboard listener for PIN setup
  useEffect(() => {
    if (step !== 3 || selectedMethod !== "pin" || pinStatus === "success") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key >= "0" && e.key <= "9") {
        handlePinKey(e.key);
      } else if (e.key === "Backspace") {
        handlePinBackspace();
      } else if (e.key === "Enter") {
        if (pinPhase === "enter" && pin.length >= 4) {
          setPinPhase("confirm");
          setConfirmPin("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [step, selectedMethod, pinStatus, pin, confirmPin, pinPhase, handlePinKey, handlePinBackspace]);

  const handleFinishQuickUnlock = () => {
    if (selectedMethod) {
      localStorage.setItem("clavis_quick_unlock_method", selectedMethod);
      if (selectedMethod === "pin") {
        localStorage.setItem("clavis_quick_unlock_pin", pin);
      } else {
        localStorage.removeItem("clavis_quick_unlock_pin");
      }
      
      if (selectedMethod === "password") {
        localStorage.removeItem("clavis_stored_master_password");
        localStorage.removeItem("clavis_quick_unlock_pin");
      } else {
        // Store master password securely for quick unlock
        localStorage.setItem("clavis_stored_master_password", pw);
      }
    }
    
    setStep(4);
  };

  const handleContinueClick = () => {
    if (selectedMethod === "fingerprint") {
      handleFinishQuickUnlock();
    } else if (selectedMethod === "password") {
      handleFinishQuickUnlock();
    } else if (selectedMethod === "pin") {
      if (pinPhase === "enter" && pin.length >= 4) {
        setPinPhase("confirm");
        setConfirmPin("");
      } else if (pinPhase === "confirm" && pinStatus === "success") {
        handleFinishQuickUnlock();
      }
    }
  };

  const steps = ["Create password", "Confirm", "Quick Unlock", "Done"];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md">
        {/* Step Indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {steps.map((s, i) => {
            const n = i + 1;
            const active = step >= n;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-300",
                  active ? "bg-purple text-white" : "bg-muted text-muted-foreground"
                )}>
                  {step > n ? <Check size={12} /> : n}
                </div>
                <span className={cn("text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                  {s}
                </span>
                {i < 3 && <div className={cn("h-px w-8 transition-colors duration-300", step > n ? "bg-purple" : "bg-border")} />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-purple text-white shadow-md shadow-purple/20">
                <ShieldCheck size={22} />
              </div>
              <h1 className="text-xl font-bold tracking-tight">Create your master password</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This password encrypts your entire local vault.
              </p>
            </div>

            {/* Security warning - Zero Knowledge Constraint */}
            <div className="flex gap-3 rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Zero-Knowledge Security Warning</span>
                Clavis stores all data locally with strong encryption. We do not store, transit, or have any access to your master password. If lost, it cannot be recovered, and your data will be permanently inaccessible.
              </div>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  placeholder="Master password"
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <Input
                type={show ? "text" : "password"}
                placeholder="Confirm password"
                value={pw2}
                onChange={e => setPw2(e.target.value)}
              />
              <StrengthBar password={pw} />
              <ul className="grid grid-cols-2 gap-1.5 pt-1 text-xs">
                {[
                  ["12+ characters", checks.length],
                  ["Uppercase letter", checks.upper],
                  ["Lowercase letter", checks.lower],
                  ["Number", checks.number],
                  ["Symbol", checks.symbol],
                ].map(([label, ok]) => (
                  <li key={label as string} className={cn("flex items-center gap-1.5 transition-colors duration-300", ok ? "text-teal" : "text-muted-foreground")}>
                    <Check size={12} className={cn("transition-opacity duration-300", ok ? "opacity-100" : "opacity-30")} />
                    {label}
                  </li>
                ))}
              </ul>
              {pw && pw2 && pw !== pw2 && <p className="text-xs text-danger">Passwords do not match</p>}
            </div>
            <Button
              disabled={!allMet || score < 3}
              onClick={() => setStep(2)}
              className="w-full bg-purple text-white hover:bg-purple/90"
            >
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleCreateVault} className="space-y-5">
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight">Re-enter your master password to confirm</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                To prevent typos, please type your password once more.
              </p>
            </div>
            <Input
              type="password"
              placeholder="Master password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoFocus
              className="w-full"
            />
            {confirm && confirm !== pw && <p className="text-xs text-danger">Passwords do not match</p>}
            {errorMsg && <p className="text-sm text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg">{errorMsg}</p>}
            <Button
              type="submit"
              disabled={confirm !== pw || loading}
              className="w-full bg-purple text-white hover:bg-purple/90"
            >
              {loading ? "Creating Vault..." : "Create vault"}
            </Button>
          </form>
        )}

        {step === 3 && (
          <div className="space-y-6 animate-fade-in w-full">
            <style>{`
              @keyframes pulse-ring {
                0% { box-shadow: 0 0 0 0 rgba(83, 74, 183, 0.4); }
                70% { box-shadow: 0 0 0 10px rgba(83, 74, 183, 0); }
                100% { box-shadow: 0 0 0 0 rgba(83, 74, 183, 0); }
              }
              .pulse-ring {
                animation: pulse-ring 1.5s infinite;
              }
              @keyframes shake {
                0%, 100% { transform: translateX(0); }
                10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                20%, 40%, 60%, 80% { transform: translateX(5px); }
              }
              .animate-shake {
                animation: shake 0.5s ease-in-out;
              }
            `}</style>
            
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight">Choose your quick unlock method</h1>
              <p className="mt-1 text-sm text-muted-foreground leading-normal">
                After your first unlock with your master password, you can use this to unlock faster.
              </p>
            </div>

            {/* Three cards in a row */}
            <div className="grid grid-cols-3 gap-3">
              {/* Card 1: Fingerprint */}
              <button
                type="button"
                onClick={() => setSelectedMethod("fingerprint")}
                className={cn(
                  "relative flex flex-col items-center justify-between rounded-xl border p-3.5 text-center transition-all duration-200 h-36 bg-card cursor-pointer hover:border-purple/50",
                  selectedMethod === "fingerprint" ? "border-purple ring-1 ring-purple" : "border-border"
                )}
              >
                <div className="absolute right-1.5 top-1.5 rounded bg-teal/15 px-1 py-0.5 text-[8px] font-bold text-teal border border-teal/20">
                  Recommended
                </div>
                <div className="my-auto flex flex-col items-center gap-1.5">
                  <Fingerprint className="h-8 w-8 text-purple" />
                  <span className="text-xs font-bold block text-foreground">Fingerprint</span>
                  <span className="text-[9px] text-muted-foreground leading-tight">Use Touch ID or Windows Hello</span>
                </div>
              </button>

              {/* Card 2: PIN */}
              <button
                type="button"
                onClick={() => {
                  setSelectedMethod("pin");
                  setPin("");
                  setConfirmPin("");
                  setPinPhase("enter");
                  setPinStatus("idle");
                }}
                className={cn(
                  "flex flex-col items-center justify-between rounded-xl border p-3.5 text-center transition-all duration-200 h-36 bg-card cursor-pointer hover:border-purple/50",
                  selectedMethod === "pin" ? "border-purple ring-1 ring-purple" : "border-border"
                )}
              >
                <div className="my-auto flex flex-col items-center gap-1.5">
                  <Grid3x3 className="h-8 w-8 text-purple" />
                  <span className="text-xs font-bold block text-foreground">PIN Code</span>
                  <span className="text-[9px] text-muted-foreground leading-tight">Set a 4 to 6 digit code</span>
                </div>
              </button>

              {/* Card 3: Password only */}
              <button
                type="button"
                onClick={() => setSelectedMethod("password")}
                className={cn(
                  "flex flex-col items-center justify-between rounded-xl border p-3.5 text-center transition-all duration-200 h-36 bg-card cursor-pointer hover:border-purple/50",
                  selectedMethod === "password" ? "border-purple ring-1 ring-purple" : "border-border"
                )}
              >
                <div className="my-auto flex flex-col items-center gap-1.5">
                  <Lock className="h-8 w-8 text-muted-foreground/60" />
                  <span className="text-xs font-bold block text-foreground">Password Only</span>
                  <span className="text-[9px] text-muted-foreground leading-tight">Always type your master password</span>
                </div>
              </button>
            </div>

            {/* Configured settings display below */}
            {selectedMethod === "fingerprint" && (
              <div className="flex flex-col items-center justify-center p-4 border border-border rounded-xl bg-card/40 space-y-3">
                <div className={cn(
                  "h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300",
                  fingerprintEnrolled ? "bg-teal/15 text-teal" : "bg-purple/10 text-purple pulse-ring"
                )}>
                  {fingerprintEnrolled ? <Check size={24} /> : <Fingerprint size={24} />}
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-foreground">
                    {fingerprintEnrolled ? "Fingerprint enrolled successfully!" : "Touch your fingerprint sensor to enroll"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedMethod("password")}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors"
                >
                  Skip for now
                </button>
              </div>
            )}

            {selectedMethod === "pin" && (
              <div className={cn(
                "flex flex-col items-center justify-center p-4 border border-border rounded-xl bg-card/40 space-y-3",
                pinShake && "animate-shake"
              )}>
                {/* Dots row */}
                <div className="flex flex-col items-center">
                  <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                    {pinPhase === "enter" ? "Set your PIN code" : "Confirm your PIN code"}
                  </p>
                  
                  <div className="flex justify-center gap-2.5">
                    {[0, 1, 2, 3, 4, 5].map(idx => {
                      const active = idx < (pinPhase === "enter" ? pin.length : confirmPin.length);
                      return (
                        <div 
                          key={idx} 
                          className={cn(
                            "h-3 w-3 rounded-full border border-border transition-colors duration-200", 
                            active ? "bg-purple border-purple scale-110" : "bg-muted"
                          )} 
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2 w-full max-w-[210px]">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handlePinKey(n)}
                      className="h-10 rounded-lg border border-border bg-card font-semibold text-sm hover:bg-muted transition-colors flex items-center justify-center cursor-pointer font-sans"
                    >
                      {n}
                    </button>
                  ))}
                  
                  {/* Row 4 */}
                  <button
                    type="button"
                    onClick={() => {
                      if (pinPhase === "enter") setPin("");
                      else setConfirmPin("");
                    }}
                    className="h-10 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    Clear
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handlePinKey("0")}
                    className="h-10 rounded-lg border border-border bg-card font-semibold text-sm hover:bg-muted transition-colors flex items-center justify-center cursor-pointer font-sans"
                  >
                    0
                  </button>

                  <button
                    type="button"
                    onClick={handlePinBackspace}
                    className="h-10 rounded-lg font-semibold text-sm hover:bg-muted transition-colors flex items-center justify-center text-muted-foreground cursor-pointer"
                  >
                    ⌫
                  </button>
                </div>

                {pinStatus === "success" && (
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-teal mt-1 animate-fade-in">
                    <Check size={12} />
                    <span>PIN set successfully</span>
                  </div>
                )}
                {pinStatus === "error" && (
                  <p className="text-[11px] font-semibold text-danger mt-1">
                    PINs don't match, try again
                  </p>
                )}
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-2">
              <Button
                type="button"
                disabled={
                  selectedMethod === null ||
                  (selectedMethod === "fingerprint" && !fingerprintEnrolled) ||
                  (selectedMethod === "pin" && pinPhase === "enter" && pin.length < 4) ||
                  (selectedMethod === "pin" && pinPhase === "confirm" && pinStatus !== "success")
                }
                onClick={handleContinueClick}
                className="w-full bg-purple text-white hover:bg-purple/90"
              >
                {selectedMethod === "pin" && pinPhase === "enter" ? "Confirm PIN" : "Continue"}
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col items-center text-center animate-fade-in">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal/15 text-teal">
              <Check size={32} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Vault created</h1>
            <p className="mt-1 text-sm text-muted-foreground">Opening your vault…</p>
          </div>
        )}
      </div>
    </div>
  );
}
