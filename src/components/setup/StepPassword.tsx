import { useState } from "react";
import { Check, Eye, EyeOff, ShieldAlert, Dice5 } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import PasswordStrengthMeter from "../PasswordStrengthMeter";
import { scorePassword } from "../../lib/passwordStrength";
import PasswordGeneratorModal from "../PasswordGeneratorModal";

interface StepPasswordProps {
  onNext: (password: string) => void;
}

export default function StepPassword({ onNext }: StepPasswordProps) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const { checks } = scorePassword(pw);
  const allChecksMet = Object.values(checks).every(Boolean) && pw === confirm && pw.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0 animate-fade-in justify-between">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
        <div className="text-center space-y-1">
          <h2 className="text-sm font-bold">1. Create Master Password</h2>
          <p className="text-[10px] text-muted-foreground leading-normal">
            This password decrypts your vault. Choose a strong, memorable combination.
          </p>
        </div>

        <div className="space-y-3">
          {/* Password Inputs */}
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              placeholder="Master password"
              value={pw}
              onChange={e => setPw(e.target.value)}
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
              placeholder="Confirm master password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="pr-10 text-xs h-9 bg-card/20"
            />
          </div>

          {/* Strength Meter */}
          <PasswordStrengthMeter password={pw} minScoreRequired={3} />

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
            <span 
              className={`flex items-center gap-0.5 transition-colors duration-200 ${pw === confirm && pw.length > 0 ? "text-teal font-semibold" : "text-muted-foreground"}`}
            >
              <Check size={9} className={pw === confirm && pw.length > 0 ? "opacity-100" : "opacity-35"} />
              Passwords Match
            </span>
          </div>

          {/* Zero-Knowledge Warning Callout */}
          <div className="border border-danger/35 rounded-lg bg-danger/5 p-3 flex gap-2 text-[10px] text-danger leading-relaxed">
            <ShieldAlert size={16} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Zero-Knowledge Security Warning</span>
              Clavis stores nothing on servers. There is no password recovery or reset link. If you forget your master password, your vault cannot be recovered.
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2 border-t border-border/40 shrink-0">
        <Button
          disabled={!allChecksMet}
          onClick={() => onNext(pw)}
          className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue
        </Button>
      </div>

      {generatorOpen && (
        <PasswordGeneratorModal 
          isOpen={generatorOpen} 
          onClose={() => setGeneratorOpen(false)} 
          onApply={(generated: string) => {
            setPw(generated);
            setConfirm(generated);
            setGeneratorOpen(false);
          }}
        />
      )}
    </div>
  );
}
