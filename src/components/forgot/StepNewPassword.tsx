import { useState } from "react";
import { Check, Eye, EyeOff, ShieldAlert, Dice5 } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import PasswordStrengthMeter from "../PasswordStrengthMeter";
import { scorePassword } from "../../lib/passwordStrength";
import PasswordGeneratorModal from "../PasswordGeneratorModal";
import { recoverVault } from "../../lib/tauri";

interface StepNewPasswordProps {
  ans1: string;
  ans2: string;
  onCompleted: () => void;
  onBack: () => void;
}

export default function StepNewPassword({ ans1, ans2, onCompleted, onBack }: StepNewPasswordProps) {
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const { checks } = scorePassword(newPw);
  const allChecksMet = Object.values(checks).every(Boolean) && newPw === confirm && newPw.length > 0;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allChecksMet) return;

    setErrorMsg(null);
    setResetting(true);

    try {
      await recoverVault(ans1, ans2, newPw);
      onCompleted();
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in text-left">
      <div className="text-center space-y-1">
        <h2 className="text-sm font-bold">Set a New Master Password</h2>
        <p className="text-[10px] text-muted-foreground leading-normal">
          Provide a fresh master password. Clavis will decrypt the database key and rekey your SQLCipher database.
        </p>
      </div>

      <form onSubmit={handleReset} className="space-y-3">
        {/* Password Inputs */}
        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            placeholder="New master password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            className="pr-16 text-xs h-9 bg-card/20"
            autoFocus
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={() => setGeneratorOpen(true)}
              title="Generate Random Password"
              className="p-1 hover:text-foreground transition-colors cursor-pointer"
            >
              <Dice5 size={14} />
            </button>
            <button
              type="button"
              onClick={() => setShow(s => !s)}
              className="p-1 hover:text-foreground transition-colors cursor-pointer"
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="relative">
          <Input
            type={show ? "text" : "password"}
            placeholder="Confirm new master password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="pr-10 text-xs h-9 bg-card/20"
          />
        </div>

        {/* Strength Meter */}
        <PasswordStrengthMeter password={newPw} minScoreRequired={3} />

        {/* Rules Checklist */}
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[8.5px] text-muted-foreground leading-none justify-center pt-1 border-t border-border/40">
          {[
            ["12+ Characters", checks.length],
            ["Uppercase", checks.upper],
            ["Lowercase", checks.lower],
            ["Number", checks.number],
            ["Symbol", checks.symbol],
          ].map(([label, ok]) => (
            <span 
              key={label as string} 
              className={`flex items-center gap-0.5 transition-colors duration-200 ${ok ? "text-teal font-semibold" : "text-muted-foreground"}`}
            >
              <Check size={9} className={ok ? "opacity-100" : "opacity-35"} />
              {label}
            </span>
          ))}
        </div>

        {errorMsg && (
          <div className="border border-danger/35 rounded-lg bg-danger/5 p-2 text-[9px] text-danger font-semibold flex items-center gap-1.5 leading-normal">
            <ShieldAlert size={13} className="shrink-0" />
            <span>Reset Failed: {errorMsg}</span>
          </div>
        )}

        <div className="flex justify-between items-center pt-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 cursor-pointer font-medium"
          >
            Back
          </button>
          <Button
            type="submit"
            disabled={resetting || !allChecksMet}
            className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer disabled:opacity-40"
          >
            {resetting ? "Re-encrypting..." : "Rekey & Reset Password"}
          </Button>
        </div>
      </form>

      {generatorOpen && (
        <PasswordGeneratorModal 
          isOpen={generatorOpen} 
          onClose={() => setGeneratorOpen(false)} 
          onApply={(generated: string) => {
            setNewPw(generated);
            setConfirm(generated);
            setGeneratorOpen(false);
          }}
        />
      )}
    </div>
  );
}
