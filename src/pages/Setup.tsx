import { useState, useEffect } from "react";
import { Shield, X, Fingerprint, Grid3x3, Check } from "lucide-react";
import { Button } from "../components/ui/button";
import { useVaultStore } from "../hooks/useVaultStore";
import { cn } from "../lib/utils";
import { closeWindow, resizeToMainWindow } from "../lib/tauri";

// Import modular wizard steps
import StepPassword from "../components/setup/StepPassword";
import StepHint from "../components/setup/StepHint";
import StepQuestions from "../components/setup/StepQuestions";
import StepSummary from "../components/setup/StepSummary";

interface SetupProps {
  onComplete: () => void;
}

type OnboardingStep = 
  | "welcome" 
  | "password" 
  | "hint" 
  | "questions" 
  | "summary" 
  | "loading" 
  | "quick-unlock" 
  | "done";

export default function Setup({ onComplete }: SetupProps) {
  const { initializeWithSecurity } = useVaultStore();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  
  // Master Password States
  const [pw, setPw] = useState("");

  // Password Hint State
  const [hint, setHint] = useState("");

  // Security Questions State
  const [q1Id, setQ1Id] = useState(1);
  const [q2Id, setQ2Id] = useState(2);
  const [answer1, setAnswer1] = useState("");
  const [answer2, setAnswer2] = useState("");

  // DB initialization progress
  const [progress, setProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  // Keyboard listener for PIN setup
  useEffect(() => {
    if (step !== "quick-unlock" || selectedMethod !== "pin" || pinStatus === "success") return;

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
  }, [step, selectedMethod, pinStatus, pin, confirmPin, pinPhase]);

  const handleCreateVault = async () => {
    setErrorMsg(null);
    setIsSubmitting(true);
    setStep("loading");
    setProgress(0);

    // Start progress simulation
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 95) {
          clearInterval(interval);
          return 95;
        }
        return p + 5;
      });
    }, 50);

    try {
      const questionsAnswers = [];
      if (q1Id !== 0 && q2Id !== 0 && answer1 && answer2) {
        questionsAnswers.push({ question_id: q1Id, answer: answer1 });
        questionsAnswers.push({ question_id: q2Id, answer: answer2 });
      }
      
      await initializeWithSecurity(
        pw, 
        hint.trim() || null, 
        questionsAnswers
      );
      
      clearInterval(interval);
      setProgress(100);
      setTimeout(() => {
        setIsSubmitting(false);
        setStep("quick-unlock");
      }, 400);

    } catch (err: any) {
      clearInterval(interval);
      setIsSubmitting(false);
      setStep("summary");
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
        
        if (val.length === pin.length) {
          if (val === pin) {
            setPinStatus("success");
            setTimeout(() => {
              handleFinishQuickUnlock();
            }, 600);
          } else {
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
        localStorage.setItem("clavis_stored_master_password", pw);
      }
    }
    
    setStep("done");
  };

  const handleContinueClick = () => {
    if (selectedMethod === "fingerprint" || selectedMethod === "password") {
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

  const handleFinishSetup = async () => {
    try {
      await resizeToMainWindow();
    } catch (err) {
      console.error("Failed to resize window:", err);
    }
    onComplete();
  };

  const getWizardDotIndex = () => {
    switch (step) {
      case "password": return 0;
      case "hint": return 1;
      case "questions": return 2;
      case "summary": return 3;
      default: return -1;
    }
  };

  const wizardDotIndex = getWizardDotIndex();

  return (
    <div data-tauri-drag-region className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground font-sans select-none border border-border/50 rounded-xl shadow-2xl">
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

      {/* Dragbar & Close Header */}
      <header 
        data-tauri-drag-region
        className="flex h-10 w-full shrink-0 items-center justify-between px-3 border-b border-border/40 bg-card/40"
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <Shield size={14} className="text-purple animate-pulse" />
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Clavis Installation</span>
        </div>
        <button 
          onClick={() => closeWindow()}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </header>

      {/* Main Installer Content View */}
      <main data-tauri-drag-region className="flex-1 p-5 overflow-hidden flex flex-col justify-between">
        
        {/* Step Indicator dots */}
        {wizardDotIndex >= 0 && (
          <div className="flex justify-center gap-2 mb-2 shrink-0">
            {[0, 1, 2, 3].map(idx => (
              <div 
                key={idx}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  idx === wizardDotIndex ? "w-4 bg-purple" : "w-1.5 bg-border"
                )}
              />
            ))}
          </div>
        )}

        {/* Dynamic Screens */}
        <div className="flex-1 flex flex-col justify-center items-center min-h-0 w-full">
          <div className="w-full max-w-sm flex flex-col justify-center min-h-0 h-full overflow-hidden">
          
          {/* Welcome Screen */}
          {step === "welcome" && (
            <div className="flex flex-col items-center text-center space-y-4 animate-fade-in">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple/10 text-purple shadow-lg shadow-purple/10">
                <Shield size={28} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text animate-pulse">Welcome to Clavis</h1>
                <p className="text-[10px] text-muted-foreground max-w-[280px] leading-relaxed">
                  A premium, local-first, zero-knowledge password vault designed to keep your credentials safe and secure on your device.
                </p>
              </div>
              <Button
                onClick={() => setStep("password")}
                className="bg-purple text-white hover:bg-purple/90 w-40 h-8.5 text-xs font-semibold rounded-lg shadow-md shadow-purple/10 cursor-pointer"
              >
                Get Started
              </Button>
            </div>
          )}

          {/* Step 1: Password Creation */}
          {step === "password" && (
            <StepPassword 
              onNext={(password) => {
                setPw(password);
                setStep("hint");
              }}
            />
          )}

          {/* Step 2: Password Hint */}
          {step === "hint" && (
            <StepHint 
              onNext={(passwordHint) => {
                setHint(passwordHint);
                setStep("questions");
              }}
              onBack={() => setStep("password")}
            />
          )}

          {/* Step 3: Security Questions */}
          {step === "questions" && (
            <StepQuestions 
              onNext={(q1, a1, q2, a2) => {
                setQ1Id(q1);
                setAnswer1(a1);
                setQ2Id(q2);
                setAnswer2(a2);
                setStep("summary");
              }}
              onBack={() => setStep("hint")}
            />
          )}

          {/* Step 4: Summary & Confirm */}
          {step === "summary" && (
            <StepSummary 
              pw={pw}
              hint={hint}
              q1Id={q1Id}
              q2Id={q2Id}
              progress={progress}
              isSubmitting={isSubmitting}
              errorMsg={errorMsg}
              onFinish={handleCreateVault}
              onBack={() => setStep("questions")}
            />
          )}

          {/* Loading Screen */}
          {step === "loading" && (
            <StepSummary 
              pw={pw}
              hint={hint}
              q1Id={q1Id}
              q2Id={q2Id}
              progress={progress}
              isSubmitting={true}
              errorMsg={null}
              onFinish={() => {}}
              onBack={() => {}}
            />
          )}

          {/* Quick Unlock Screen */}
          {step === "quick-unlock" && (
            <div className="flex flex-col h-full min-h-0 animate-fade-in justify-between w-full">
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1 text-center w-full">
                <div className="space-y-1">
                  <h2 className="text-xs font-bold">Choose Quick Unlock</h2>
                  <p className="text-[9.5px] text-muted-foreground leading-tight">
                    Unlock faster on subsequent launches during this session.
                  </p>
                </div>

                {/* Selection cards */}
                <div className="grid grid-cols-3 gap-2.5 shrink-0 py-0.5">
                  {/* Fingerprint */}
                  <button
                    type="button"
                    onClick={() => setSelectedMethod("fingerprint")}
                    className={cn(
                      "relative flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all duration-200 h-22 bg-card cursor-pointer hover:border-purple/50",
                      selectedMethod === "fingerprint" ? "border-purple ring-1 ring-purple" : "border-border"
                    )}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Fingerprint className="h-5 w-5 text-purple" />
                      <span className="text-[9px] font-bold block text-foreground leading-none">Biometric</span>
                      <span className="text-[7px] text-muted-foreground leading-tight">Touch ID</span>
                    </div>
                  </button>

                  {/* PIN */}
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
                      "flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all duration-200 h-22 bg-card cursor-pointer hover:border-purple/50",
                      selectedMethod === "pin" ? "border-purple ring-1 ring-purple" : "border-border"
                    )}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Grid3x3 className="h-5 w-5 text-purple" />
                      <span className="text-[9px] font-bold block text-foreground leading-none">PIN Code</span>
                      <span className="text-[7px] text-muted-foreground leading-tight">4-6 Digits</span>
                    </div>
                  </button>

                  {/* Password only */}
                  <button
                    type="button"
                    onClick={() => setSelectedMethod("password")}
                    className={cn(
                      "flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all duration-200 h-22 bg-card cursor-pointer hover:border-purple/50",
                      selectedMethod === "password" ? "border-purple ring-1 ring-purple" : "border-border"
                    )}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Shield className="h-5 w-5 text-purple" />
                      <span className="text-[9px] font-bold block text-foreground leading-none">Password</span>
                      <span className="text-[7px] text-muted-foreground leading-tight">Standard login</span>
                    </div>
                  </button>
                </div>

                {/* Dynamic enrollment state view */}
                <div className="h-32 flex flex-col justify-center items-center shrink-0 border border-border/40 rounded-xl bg-card/25 p-3">
                  {selectedMethod === null && (
                    <p className="text-[9.5px] text-muted-foreground text-center">Select an option above to configure quick access methods.</p>
                  )}

                  {selectedMethod === "password" && (
                    <div className="text-center space-y-1">
                      <Check className="h-5 w-5 text-teal mx-auto" />
                      <p className="text-[9.5px] font-bold">Standard Password Setup</p>
                      <p className="text-[8px] text-muted-foreground max-w-[200px]">You will be prompted to type your full master password on every launch.</p>
                    </div>
                  )}

                  {selectedMethod === "fingerprint" && (
                    <div className="text-center space-y-1.5">
                      {enrollingFingerprint ? (
                        <>
                          <div className="h-6 w-6 border-2 border-purple border-t-transparent rounded-full animate-spin mx-auto" />
                          <p className="text-[9.5px] font-semibold">Scanning biometric credential...</p>
                        </>
                      ) : fingerprintEnrolled ? (
                        <>
                          <Check className="h-5 w-5 text-teal mx-auto" />
                          <p className="text-[9.5px] font-bold">Biometrics Configured</p>
                          <p className="text-[8px] text-muted-foreground">Touch ID / Windows Hello is fully linked to your local vault.</p>
                        </>
                      ) : (
                        <p className="text-[9.5px] text-muted-foreground">Biometrics setup initializing...</p>
                      )}
                    </div>
                  )}

                  {selectedMethod === "pin" && (
                    <div className={cn("text-center w-full flex flex-col justify-center items-center", pinShake && "animate-shake")}>
                      <p className="text-[9.5px] font-bold">
                        {pinPhase === "enter" ? "Enter a 4-6 digit PIN" : "Re-enter PIN to confirm"}
                      </p>
                      
                      {/* Dots indicator */}
                      <div className="flex gap-2.5 my-2.5 h-2 items-center">
                        {Array.from({ length: pinPhase === "enter" ? 6 : pin.length }).map((_, i) => {
                          const active = pinPhase === "enter" ? i < pin.length : i < confirmPin.length;
                          return (
                            <div 
                              key={i} 
                              className={cn(
                                "h-2 w-2 rounded-full border transition-all duration-150",
                                active 
                                  ? pinStatus === "error" 
                                    ? "bg-danger border-danger scale-110" 
                                    : pinStatus === "success" 
                                      ? "bg-teal border-teal scale-110" 
                                      : "bg-purple border-purple scale-110"
                                  : "bg-card border-border/80"
                              )}
                            />
                          );
                        })}
                      </div>

                      {/* Numeric Input Keypad */}
                      <div className="grid grid-cols-5 gap-1.5 w-full max-w-[200px]">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => handlePinKey(String(n))}
                            className="h-6 rounded bg-card hover:bg-muted border border-border/40 text-[10px] font-semibold cursor-pointer text-foreground"
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              {selectedMethod !== "pin" && selectedMethod !== null && (
                <div className="flex justify-center shrink-0 pt-2 border-t border-border/40">
                  <Button
                    onClick={handleContinueClick}
                    className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-6 font-semibold cursor-pointer"
                  >
                    Finish Setup
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Done Screen */}
          {step === "done" && (
            <div className="flex flex-col items-center text-center space-y-4 animate-fade-in">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal shadow-lg shadow-teal/10">
                <Check size={28} className="animate-pulse" />
              </div>
              <div className="space-y-1">
                <h1 className="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">Vault Created Successfully!</h1>
                <p className="text-[10px] text-muted-foreground max-w-[260px] leading-relaxed">
                  Your local-only database has been securely configured. You can now start adding passwords and authenticators.
                </p>
              </div>
              <Button
                onClick={handleFinishSetup}
                className="bg-purple text-white hover:bg-purple/90 w-44 h-8.5 text-xs font-semibold rounded-lg shadow-md shadow-purple/10 cursor-pointer animate-pulse"
              >
                Go to Dashboard
              </Button>
            </div>
          )}
          </div>
        </div>
      </main>
    </div>
  );
}
