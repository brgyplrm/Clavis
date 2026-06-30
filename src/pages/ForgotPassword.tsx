import { useState, useEffect } from "react";
import { X, HelpCircle, ArrowLeft } from "lucide-react";
import { Button } from "../components/ui/button";
import { getPasswordHint, closeWindow } from "../lib/tauri";

// Import modular forgot password steps
import StepQuestions from "../components/forgot/StepQuestions";
import StepNewPassword from "../components/forgot/StepNewPassword";
import StepComplete from "../components/forgot/StepComplete";

interface ForgotPasswordProps {
  onBackToLogin: () => void;
}

type ForgotStep = 
  | "hint" 
  | "questions" 
  | "new-password" 
  | "complete";

export default function ForgotPassword({ onBackToLogin }: ForgotPasswordProps) {
  const [step, setStep] = useState<ForgotStep>("hint");
  const [hint, setHint] = useState<string | null>(null);
  const [loadingHint, setLoadingHint] = useState(true);

  // Recovery verification tokens (answers cached in state to perform final re-encryption)
  const [ans1, setAns1] = useState("");
  const [ans2, setAns2] = useState("");

  useEffect(() => {
    getPasswordHint()
      .then(h => {
        setHint(h);
        setLoadingHint(false);
      })
      .catch(err => {
        console.error("Failed to load hint:", err);
        setLoadingHint(false);
      });
  }, []);

  return (
    <div data-tauri-drag-region className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground font-sans select-none border border-border/50 rounded-xl shadow-2xl">
      {/* Dragbar & Close Header */}
      <header 
        data-tauri-drag-region
        className="flex h-10 w-full shrink-0 items-center justify-between px-3 border-b border-border/40 bg-card/40"
      >
        <div className="flex items-center gap-1.5 pointer-events-none">
          <HelpCircle size={14} className="text-purple animate-pulse" />
          <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Clavis Account Recovery</span>
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
        
        {/* Dynamic Screens */}
        <div className="flex-1 flex flex-col justify-center items-center min-h-0 w-full">
          <div className="w-full max-w-sm flex flex-col justify-center min-h-0 h-full">

            {/* Step 1: Hint Reader */}
            {step === "hint" && (
              <div className="space-y-4 animate-fade-in text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple/10 text-purple shadow-lg shadow-purple/10 mx-auto">
                  <HelpCircle size={24} />
                </div>
                <div className="space-y-1">
                  <h1 className="text-sm font-bold">Forgot Master Password?</h1>
                  <p className="text-[10px] text-muted-foreground max-w-[280px] leading-relaxed mx-auto">
                    Try reading your password hint before attempting full security questions recovery.
                  </p>
                </div>

                <div className="border border-border/60 rounded-lg p-4.5 bg-card/10 text-xs">
                  <span className="text-[9px] uppercase font-bold text-muted-foreground block mb-1">Your Password Hint</span>
                  {loadingHint ? (
                    <span className="text-muted-foreground animate-pulse">Loading password hint...</span>
                  ) : hint ? (
                    <span className="font-semibold text-foreground italic">"{hint}"</span>
                  ) : (
                    <span className="text-muted-foreground italic">No hint configured for this vault.</span>
                  )}
                </div>

                <div className="flex flex-col gap-2 pt-2 items-center">
                  <Button
                    onClick={() => setStep("questions")}
                    className="bg-purple text-white hover:bg-purple/90 w-44 h-8.5 text-xs font-semibold rounded-lg shadow-md cursor-pointer"
                  >
                    Use Security Questions
                  </Button>
                  <button
                    onClick={onBackToLogin}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 cursor-pointer font-semibold mt-1"
                  >
                    <ArrowLeft size={12} /> Back to Login
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Answer Security Questions */}
            {step === "questions" && (
              <StepQuestions 
                onVerified={(a1, a2) => {
                  setAns1(a1);
                  setAns2(a2);
                  setStep("new-password");
                }}
                onBack={() => setStep("hint")}
              />
            )}

            {/* Step 3: Re-encrypt Vault & Set New Password */}
            {step === "new-password" && (
              <StepNewPassword 
                ans1={ans1}
                ans2={ans2}
                onCompleted={() => setStep("complete")}
                onBack={() => setStep("questions")}
              />
            )}

            {/* Step 4: Complete State */}
            {step === "complete" && (
              <StepComplete 
                onProceed={onBackToLogin}
              />
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
