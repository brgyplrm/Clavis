import { useState, useEffect } from "react";
import { Eye, EyeOff, ShieldCheck, Fingerprint, Grid3x3, Lock, Check, X } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useVaultStore } from "../hooks/useVaultStore";
import { cn } from "../lib/utils";
import { listVaults, deleteVault, getPasswordHint, getRecoveryQuestions, verifyRecoveryAnswers } from "../lib/tauri";
import ForgotPassword from "./ForgotPassword";
import { SECURITY_QUESTIONS } from "../components/setup/StepQuestions";

function calculateEntropy(password: string): number {
  if (!password) return 0;
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;
  
  if (poolSize === 0) return 0;
  return Math.round(password.length * Math.log2(poolSize));
}

import PasswordStrengthMeter from "../components/PasswordStrengthMeter";

function RecoveryStrengthBar({ password }: { password: string }) {
  return <PasswordStrengthMeter password={password} />;
}

export default function Unlock() {
  const { unlock, recover, loading, error, clearError } = useVaultStore();
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Recovery States
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<"hint" | "questions" | "reset">("hint");
  const [passwordHintText, setPasswordHintText] = useState<string | null>(null);
  const [recoveryQuestions, setRecoveryQuestions] = useState<number[]>([]);
  const [recAnswer1, setRecAnswer1] = useState("");
  const [recAnswer2, setRecAnswer2] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryAttempts, setRecoveryAttempts] = useState(0);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showNewPwConfirm, setShowNewPwConfirm] = useState(false);

  useEffect(() => {
    if (showRecovery) {
      setRecoveryError(null);
      setShowNewPw(false);
      setShowNewPwConfirm(false);
      getPasswordHint().then(h => {
        setPasswordHintText(h);
      }).catch(err => {
        console.error("Failed to load password hint:", err);
      });
    }
  }, [showRecovery]);

  const handleLoadQuestions = async () => {
    setRecoveryError(null);
    try {
      const qIds = await getRecoveryQuestions();
      setRecoveryQuestions(qIds);
      setRecoveryStep("questions");
    } catch (err: any) {
      const errMsg = err.toString() || "";
      if (errMsg.includes("Recovery configuration not found") || errMsg.includes("Recovery config not found") || errMsg.includes("not found")) {
        setRecoveryError("This is a legacy vault lacking recovery questions. Please restore your vault from a backup.");
      } else {
        setRecoveryError(errMsg);
      }
    }
  };

  const handleVerifyQuestions = async () => {
    if (recoveryAttempts >= 3) {
      setRecoveryError("Recovery locked due to too many failed attempts. Please restart the application to try again.");
      return;
    }
    if (!recAnswer1.trim() || !recAnswer2.trim()) {
      setRecoveryError("Please answer both questions.");
      return;
    }
    setRecoveryError(null);
    try {
      const isValid = await verifyRecoveryAnswers(recAnswer1, recAnswer2);
      if (isValid) {
        setRecoveryStep("reset");
      } else {
        const nextAttempts = recoveryAttempts + 1;
        setRecoveryAttempts(nextAttempts);
        if (nextAttempts >= 3) {
          setRecoveryError("Recovery locked due to too many failed attempts. Please restart the application to try again.");
        } else {
          setRecoveryError(`Incorrect security answers (${nextAttempts}/3 attempts).`);
        }
      }
    } catch (err: any) {
      setRecoveryError(err.toString() || "Verification failed.");
    }
  };

  const handlePerformRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recoveryAttempts >= 3) {
      setRecoveryError("Recovery locked due to too many failed attempts. Please restart the application to try again.");
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setRecoveryError("Passwords do not match.");
      return;
    }
    if (newPassword.length < 12) {
      setRecoveryError("Password must be at least 12 characters.");
      return;
    }
    setRecoveryError(null);
    try {
      await recover(recAnswer1, recAnswer2, newPassword);
      localStorage.removeItem("clavis_stored_master_password");
      localStorage.removeItem("clavis_quick_unlock_pin");
      setShowRecovery(false);
    } catch (err: any) {
      const nextAttempts = recoveryAttempts + 1;
      setRecoveryAttempts(nextAttempts);
      if (nextAttempts >= 3) {
        setRecoveryError("Recovery locked due to too many failed attempts. Please restart the application to try again.");
      } else {
        setRecoveryError(`Incorrect security answers (${nextAttempts}/3 attempts).`);
      }
    }
  };

  // Tab State
  const [activeTab, setActiveTab] = useState<"fingerprint" | "pin" | "password">(() => {
    const savedMethod = localStorage.getItem("clavis_quick_unlock_method");
    if (savedMethod === "fingerprint") return "fingerprint";
    if (savedMethod === "pin") return "pin";
    return "password";
  });

  // Fingerprint States
  const [fingerprintState, setFingerprintState] = useState<"idle" | "scanning" | "success" | "failed">("idle");
  const [fingerprintError, setFingerprintError] = useState<string | null>(null);

  // PIN States
  const [enteredPin, setEnteredPin] = useState("");
  const [pinAttempts, setPinAttempts] = useState(0);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinShake, setPinShake] = useState(false);
  const storedPinLength = (() => {
    const storedPin = localStorage.getItem("clavis_quick_unlock_pin") || "";
    return storedPin.length || 6;
  })();

  // Auto trigger fingerprint scan on tab select
  useEffect(() => {
    if (activeTab === "fingerprint") {
      startFingerprintScan();
    } else {
      setFingerprintState("idle");
      setFingerprintError(null);
    }
  }, [activeTab]);

  const startFingerprintScan = () => {
    if (fingerprintState === "scanning" || fingerprintState === "success") return;

    const method = localStorage.getItem("clavis_quick_unlock_method");
    if (method !== "fingerprint") {
      setFingerprintState("failed");
      setFingerprintError("Fingerprint unlock not set up.");
      return;
    }

    setFingerprintState("scanning");
    setFingerprintError(null);

    setTimeout(async () => {
      const storedPw = localStorage.getItem("clavis_stored_master_password");
      if (storedPw) {
        try {
          await unlock(storedPw);
          setFingerprintState("success");
        } catch (err: any) {
          setFingerprintState("failed");
          setFingerprintError(err.message || String(err));
          setTimeout(() => {
            setFingerprintState("idle");
            setFingerprintError(null);
          }, 2000);
        }
      } else {
        setFingerprintState("failed");
        setFingerprintError("Fingerprint not recognized, try again");
        setTimeout(() => {
          setFingerprintState("idle");
          setFingerprintError(null);
        }, 2000);
      }
    }, 1500);
  };

  const handlePinKey = async (num: string) => {
    if (pinAttempts >= 5 || loading) return;

    const storedPin = localStorage.getItem("clavis_quick_unlock_pin") || "";
    if (!storedPin) {
      setPinError("PIN unlock not set up.");
      return;
    }

    const nextPin = enteredPin + num;
    if (nextPin.length <= storedPin.length) {
      setEnteredPin(nextPin);

      // Auto-submit when target length is reached
      if (nextPin.length === storedPin.length) {
        if (nextPin === storedPin) {
          const storedPw = localStorage.getItem("clavis_stored_master_password");
          if (storedPw) {
            try {
              await unlock(storedPw);
            } catch (err: any) {
              setPinError(err.message || String(err));
              setEnteredPin("");
            }
          } else {
            setPinError("Master credentials missing. Use password.");
            setEnteredPin("");
          }
        } else {
          // Failed PIN attempt
          setPinShake(true);
          const nextAttempts = pinAttempts + 1;
          setPinAttempts(nextAttempts);
          
          if (nextAttempts >= 5) {
            setPinError("Too many attempts. Use your master password.");
          } else {
            setPinError("Incorrect PIN");
          }

          setTimeout(() => {
            setPinShake(false);
            setEnteredPin("");
            if (nextAttempts < 5) {
              setPinError(null);
            }
          }, 800);
        }
      }
    }
  };

  const handlePinBackspace = () => {
    if (pinAttempts >= 5 || loading) return;
    setEnteredPin(p => p.slice(0, -1));
  };

  // Keyboard listener for PIN input
  useEffect(() => {
    if (activeTab !== "pin" || pinAttempts >= 5 || loading) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key >= "0" && e.key <= "9") {
        handlePinKey(e.key);
      } else if (e.key === "Backspace") {
        handlePinBackspace();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTab, enteredPin, pinAttempts, loading, handlePinKey, handlePinBackspace]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setLocalError(null);
    clearError();
    try {
      await unlock(pw);
      // Keep master password in session memory for future quick locks if configured
      const method = localStorage.getItem("clavis_quick_unlock_method");
      if (method && method !== "password") {
        localStorage.setItem("clavis_stored_master_password", pw);
      }
    } catch (err: any) {
      setLocalError(err.message || String(err));
    }
  };

  const handleWipeVault = async () => {
    if (window.confirm("WARNING: This will wipe all local metadata and reset your Clavis vault. All stored credentials will be permanently deleted. Are you sure you want to proceed?")) {
      try {
        const vaultsList = await listVaults();
        for (const v of vaultsList) {
          await deleteVault(v.id);
        }
      } catch (err) {
        console.error("Failed to delete vaults during wipe:", err);
      }
      localStorage.clear();
      window.location.reload();
    }
  };

  if (showRecovery) {
    return <ForgotPassword onBackToLogin={() => setShowRecovery(false)} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
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

      <div className="w-full max-w-sm">
        {/* Clavis Logo & Subtitle */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-purple text-white shadow-md shadow-purple/20">
            <ShieldCheck size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Clavis</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your vault is locked</p>
        </div>

        {/* Tabbed Unlock Card */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-lg space-y-5">
          {/* Tabs header */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-muted/40 rounded-lg border border-border/40">
            <button
              onClick={() => setActiveTab("fingerprint")}
              className={cn(
                "py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                activeTab === "fingerprint" ? "bg-background text-foreground shadow-xs border border-border/60" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Fingerprint size={13} />
              <span>Fingerprint</span>
            </button>
            <button
              onClick={() => setActiveTab("pin")}
              className={cn(
                "py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                activeTab === "pin" ? "bg-background text-foreground shadow-xs border border-border/60" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Grid3x3 size={13} />
              <span>PIN</span>
            </button>
            <button
              onClick={() => setActiveTab("password")}
              className={cn(
                "py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer",
                activeTab === "password" ? "bg-background text-foreground shadow-xs border border-border/60" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Lock size={13} />
              <span>Password</span>
            </button>
          </div>

          {/* FINGERPRINT TAB VIEW */}
          {activeTab === "fingerprint" && (
            <div className="flex flex-col items-center justify-center py-6 space-y-4">
              <button
                type="button"
                onClick={startFingerprintScan}
                disabled={fingerprintState === "scanning" || fingerprintState === "success"}
                className={cn(
                  "h-16 w-16 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer border border-border/50",
                  fingerprintState === "scanning" && "bg-purple/10 text-purple pulse-ring",
                  fingerprintState === "success" && "bg-teal/15 text-teal border-teal/40",
                  fingerprintState === "failed" && "bg-danger/10 text-danger border-danger/40 animate-shake",
                  fingerprintState === "idle" && "bg-purple/10 text-purple hover:bg-purple/20"
                )}
              >
                {fingerprintState === "success" ? <Check size={32} /> : <Fingerprint size={32} />}
              </button>
              <div className="text-center">
                <p className={cn(
                  "text-xs font-medium",
                  fingerprintState === "failed" ? "text-danger" : "text-foreground"
                )}>
                  {fingerprintState === "scanning" && "Scanning fingerprint..."}
                  {fingerprintState === "success" && "Authenticated successfully"}
                  {fingerprintState === "failed" && (fingerprintError || "Not recognized, try again")}
                  {fingerprintState === "idle" && "Touch your fingerprint sensor"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("password")}
                className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors pt-2"
              >
                Use password instead
              </button>
            </div>
          )}

          {/* PIN TAB VIEW */}
          {activeTab === "pin" && (
            <div className={cn(
              "flex flex-col items-center justify-center space-y-4 py-2",
              pinShake && "animate-shake"
            )}>
              {/* Dots */}
              <div className="flex flex-col items-center">
                <div className="flex justify-center gap-2.5">
                  {Array.from({ length: storedPinLength }).map((_, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "h-3 w-3 rounded-full border border-border transition-colors duration-200", 
                        idx < enteredPin.length ? "bg-purple border-purple scale-110" : "bg-muted"
                      )} 
                    />
                  ))}
                </div>
                {pinError && (
                  <p className={cn(
                    "text-[10px] font-semibold mt-2 text-center",
                    pinAttempts >= 5 ? "text-danger" : "text-muted-foreground"
                  )}>
                    {pinError}
                  </p>
                )}
              </div>

              {/* Number pad */}
              <div className="grid grid-cols-3 gap-2 w-full max-w-[210px]">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => (
                  <button
                    key={n}
                    type="button"
                    disabled={pinAttempts >= 5}
                    onClick={() => handlePinKey(n)}
                    className="h-10 rounded-lg border border-border bg-card font-semibold text-sm hover:bg-muted transition-colors flex items-center justify-center cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {n}
                  </button>
                ))}
                
                {/* Row 4 */}
                <button
                  type="button"
                  disabled={pinAttempts >= 5}
                  onClick={() => setEnteredPin("")}
                  className="h-10 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
                
                <button
                  type="button"
                  disabled={pinAttempts >= 5}
                  onClick={() => handlePinKey("0")}
                  className="h-10 rounded-lg border border-border bg-card font-semibold text-sm hover:bg-muted transition-colors flex items-center justify-center cursor-pointer font-sans disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  0
                </button>

                <button
                  type="button"
                  disabled={pinAttempts >= 5}
                  onClick={handlePinBackspace}
                  className="h-10 rounded-lg font-semibold text-sm hover:bg-muted transition-colors flex items-center justify-center text-muted-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ⌫
                </button>
              </div>

              <button
                type="button"
                onClick={() => setActiveTab("password")}
                className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors pt-2"
              >
                Use password instead
              </button>
            </div>
          )}

          {/* PASSWORD TAB VIEW */}
          {activeTab === "password" && (
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Master password</label>
                <div className="relative">
                  <Input
                    type={show ? "text" : "password"}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoFocus
                    placeholder="Enter your master password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              
              {(localError || error) && (
                <p className="text-xs text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg">
                  {localError || error}
                </p>
              )}

              <Button type="submit" disabled={loading} className="w-full bg-purple text-white hover:bg-purple/90 py-1.5 font-bold text-xs h-9">
                {loading ? "Unlocking..." : "Unlock vault"}
              </Button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setShowRecovery(true)}
                  className="text-[10px] text-danger hover:underline transition-colors font-medium cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {showRecovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs">
          <div className="w-full max-w-[360px] rounded-xl border border-border bg-card p-5 shadow-2xl space-y-4 animate-scale-up text-foreground select-none">
            <header className="flex justify-between items-center pb-2 border-b border-border/40">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Vault Recovery</span>
              <button 
                onClick={() => {
                  setShowRecovery(false);
                  setRecoveryStep("hint");
                  setRecoveryError(null);
                  setRecAnswer1("");
                  setRecAnswer2("");
                  setNewPassword("");
                  setNewPasswordConfirm("");
                }}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X size={16} />
              </button>
            </header>

            {recoveryStep === "hint" && (
              <div className="space-y-4 animate-fade-in">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Password Hint</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Here is the hint you configured during setup:
                  </p>
                </div>

                <div className="p-3 border border-border/80 bg-background/50 rounded-lg text-center font-medium text-xs text-purple">
                  {passwordHintText ? `"${passwordHintText}"` : "No password hint configured."}
                </div>

                {recoveryError && (
                  <p className="text-[10px] text-danger text-center bg-danger/10 border border-danger/20 p-1.5 rounded-md leading-normal">
                    {recoveryError}
                  </p>
                )}

                <div className="flex flex-col gap-2 pt-2">
                  <Button 
                    onClick={handleLoadQuestions}
                    disabled={recoveryError !== null && recoveryError.includes("legacy vault")}
                    className="w-full bg-purple text-white text-xs font-semibold hover:bg-purple/90 h-9 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Recover using security questions
                  </Button>
                  <button
                    onClick={handleWipeVault}
                    className="text-[10px] text-danger hover:underline transition-colors py-1 cursor-pointer font-medium"
                  >
                    Wipe and reset vault (Deletes all credentials)
                  </button>
                </div>
              </div>
            )}

            {recoveryStep === "questions" && (
              <div className="space-y-4 animate-fade-in">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold">Verify Security Questions</h3>
                  <p className="text-xs text-muted-foreground leading-normal">
                    Provide the answers to the security questions you configured during setup.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block truncate max-w-full">
                      {SECURITY_QUESTIONS.find(q => q.id === recoveryQuestions[0])?.text || "Question 1"}
                    </label>
                    <Input 
                      type="text" 
                      placeholder="Answer 1"
                      value={recAnswer1}
                      onChange={e => setRecAnswer1(e.target.value)}
                      disabled={recoveryAttempts >= 3}
                      className="text-xs h-8 bg-card/20"
                      autoFocus
                    />
                  </div>
                  
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-muted-foreground uppercase block truncate max-w-full">
                      {SECURITY_QUESTIONS.find(q => q.id === recoveryQuestions[1])?.text || "Question 2"}
                    </label>
                    <Input 
                      type="text" 
                      placeholder="Answer 2"
                      value={recAnswer2}
                      onChange={e => setRecAnswer2(e.target.value)}
                      disabled={recoveryAttempts >= 3}
                      className="text-xs h-8 bg-card/20"
                    />
                  </div>
                </div>

                {recoveryError && (
                  <p className="text-[10px] text-danger text-center bg-danger/10 border border-danger/20 p-1.5 rounded-md leading-normal">
                    {recoveryError}
                  </p>
                )}

                <div className="flex justify-between items-center pt-2">
                  <button 
                    onClick={() => {
                      setRecoveryStep("hint");
                      setRecoveryError(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Back
                  </button>
                  <Button 
                    onClick={handleVerifyQuestions}
                    disabled={recoveryAttempts >= 3 || !recAnswer1.trim() || !recAnswer2.trim()}
                    className="bg-purple text-white text-xs font-semibold hover:bg-purple/90 h-8.5 px-4 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}

            {recoveryStep === "reset" && (() => {
              const entropy = calculateEntropy(newPassword);
              const requirements = {
                length: newPassword.length >= 12,
                upper: /[A-Z]/.test(newPassword),
                lower: /[a-z]/.test(newPassword),
                number: /[0-9]/.test(newPassword),
                symbol: /[^a-zA-Z0-9]/.test(newPassword),
              };
              const isPasswordValid = Object.values(requirements).every(Boolean) && entropy >= 60;
              
              return (
                <form onSubmit={handlePerformRecovery} className="space-y-3 animate-fade-in">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-semibold">Reset Master Password</h3>
                    <p className="text-[10px] text-muted-foreground leading-normal">
                      Must be 12+ chars, with uppercase, digit, and symbol.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <div className="relative">
                      <Input 
                        type={showNewPw ? "text" : "password"} 
                        placeholder="New master password"
                        value={newPassword}
                        onChange={e => setNewPassword(e.target.value)}
                        disabled={recoveryAttempts >= 3}
                        className="text-xs h-7.5 bg-card/20 pr-8"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(s => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {showNewPw ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    
                    <RecoveryStrengthBar password={newPassword} />

                    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[7.5px] text-muted-foreground leading-none justify-center pt-0.5">
                      {[
                        ["12+ chars", requirements.length],
                        ["Uppercase", requirements.upper],
                        ["Lowercase", requirements.lower],
                        ["Number", requirements.number],
                        ["Symbol", requirements.symbol],
                      ].map(([label, ok]) => (
                        <span key={label as string} className={cn("flex items-center gap-0.5 transition-colors", ok ? "text-teal font-bold" : "text-muted-foreground")}>
                          <Check size={7} className={cn("transition-opacity", ok ? "opacity-100" : "opacity-35")} />
                          {label}
                        </span>
                      ))}
                    </div>

                    <div className="relative">
                      <Input 
                        type={showNewPwConfirm ? "text" : "password"} 
                        placeholder="Confirm new password"
                        value={newPasswordConfirm}
                        onChange={e => setNewPasswordConfirm(e.target.value)}
                        disabled={recoveryAttempts >= 3}
                        className="text-xs h-7.5 bg-card/20 pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPwConfirm(s => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        {showNewPwConfirm ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                    
                    {newPasswordConfirm && newPasswordConfirm !== newPassword && (
                      <p className="text-[8px] text-danger text-center leading-none">Passwords do not match</p>
                    )}
                  </div>

                  {recoveryError && (
                    <p className="text-[10px] text-danger text-center bg-danger/10 border border-danger/20 p-1.5 rounded-md leading-normal">
                      {recoveryError}
                    </p>
                  )}

                  <div className="flex justify-between items-center pt-1">
                    <button 
                      type="button"
                      onClick={() => {
                        setRecoveryStep("questions");
                        setRecoveryError(null);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Back
                    </button>
                    <Button 
                      type="submit"
                      disabled={loading || recoveryAttempts >= 3 || !isPasswordValid || newPassword !== newPasswordConfirm}
                      className="bg-purple text-white text-xs font-semibold hover:bg-purple/90 h-8 px-4 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loading ? "Recovering..." : "Reset & Unlock"}
                    </Button>
                  </div>
                </form>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
