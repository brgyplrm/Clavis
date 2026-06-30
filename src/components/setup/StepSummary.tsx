import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { scorePassword } from "../../lib/passwordStrength";
import { SECURITY_QUESTIONS } from "./StepQuestions";

interface StepSummaryProps {
  pw: string;
  hint: string;
  q1Id: number;
  q2Id: number;
  progress: number;
  isSubmitting: boolean;
  errorMsg: string | null;
  onFinish: () => void;
  onBack: () => void;
}

export default function StepSummary({
  pw,
  hint,
  q1Id,
  q2Id,
  progress,
  isSubmitting,
  errorMsg,
  onFinish,
  onBack
}: StepSummaryProps) {
  const { score } = scorePassword(pw);

  const getLabel = () => {
    switch (score) {
      case 0:
      case 1: return "Weak";
      case 2: return "Fair";
      case 3: return "Strong";
      case 4: return "Very Strong";
      default: return "";
    }
  };

  const getQText = (id: number) => {
    const q = SECURITY_QUESTIONS.find(item => item.id === id);
    return q ? q.text : "Not Configured (Bypassed)";
  };

  return (
    <div className="flex flex-col h-full min-h-0 animate-fade-in justify-between text-left">
      {!isSubmitting ? (
        <>
          <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 py-1">
            <div className="text-center space-y-1">
              <h2 className="text-sm font-bold">4. Review and Confirm Setup</h2>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Confirm your vault configuration choices before database initialization.
              </p>
            </div>

            <div className="space-y-2.5 text-xs">
              {/* Master Password Summary Row */}
              <div className="border border-border/60 rounded-lg p-3 bg-card/10 space-y-1">
                <span className="text-[9px] uppercase font-bold text-muted-foreground">Master Password Strength</span>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-foreground">••••••••••••</span>
                  <span className="rounded bg-teal/15 px-2 py-0.5 text-[9px] font-semibold text-teal border border-teal/20">
                    {getLabel()}
                  </span>
                </div>
              </div>

              {/* Password Hint Summary Row */}
              <div className="border border-border/60 rounded-lg p-3 bg-card/10 space-y-1">
                <span className="text-[9px] uppercase font-bold text-muted-foreground">Password Hint Description</span>
                <div className="font-semibold text-foreground truncate">
                  {hint ? hint : <span className="text-muted-foreground italic font-normal">None configured</span>}
                </div>
              </div>

              {/* Security Questions Summary Row */}
              <div className="border border-border/60 rounded-lg p-3 bg-card/10 space-y-2">
                <span className="text-[9px] uppercase font-bold text-muted-foreground">Emergency Reset Pathway</span>
                {q1Id !== 0 && q2Id !== 0 ? (
                  <div className="space-y-1.5 text-[10px]">
                    <div>
                      <span className="text-muted-foreground font-medium block">Question 1:</span>
                      <span className="text-foreground font-semibold">{getQText(q1Id)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground font-medium block">Question 2:</span>
                      <span className="text-foreground font-semibold">{getQText(q2Id)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-danger/80 font-semibold flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    Bypassed (Vault lockout recovery is permanently disabled)
                  </div>
                )}
              </div>

              {/* Error Message */}
              {errorMsg && (
                <div className="text-[10px] text-danger font-semibold bg-danger/5 border border-danger/25 rounded-md p-2">
                  Initialization Failed: {errorMsg}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-border/40 shrink-0">
            <button
              onClick={onBack}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 cursor-pointer font-medium"
            >
              <ArrowLeft size={12} /> Back
            </button>
            <Button
              onClick={onFinish}
              className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-6 font-semibold cursor-pointer"
            >
              Finish &amp; Initialize
            </Button>
          </div>
        </>
      ) : (
        /* Progress Overlay during SQLite creation */
        <div className="flex flex-col items-center justify-center py-8 space-y-4 animate-fade-in text-center flex-1">
          <div className="relative flex items-center justify-center h-16 w-16">
            {/* Spinning Circle */}
            <div className="absolute inset-0 rounded-full border-4 border-purple/20 border-t-purple animate-spin" />
            <ShieldCheck size={26} className="text-purple animate-pulse" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xs font-bold text-foreground">Initializing Encrypted Database</h3>
            <p className="text-[9.5px] text-muted-foreground leading-normal max-w-[240px]">
              Deriving keys with Argon2id and generating SQLCipher tables...
            </p>
          </div>

          <div className="w-48 bg-border/40 h-1.5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-purple rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[9px] text-muted-foreground font-semibold font-mono">{progress}%</span>
        </div>
      )}
    </div>
  );
}
