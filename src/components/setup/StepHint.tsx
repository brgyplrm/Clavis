import { useState } from "react";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

interface StepHintProps {
  onNext: (hint: string) => void;
  onBack: () => void;
}

export default function StepHint({ onNext, onBack }: StepHintProps) {
  const [hint, setHint] = useState("");

  const characterLimit = 120;
  const isOverLimit = hint.length > characterLimit;

  return (
    <div className="flex flex-col h-full min-h-0 animate-fade-in justify-between">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-1">
        <div className="text-center space-y-1">
          <h2 className="text-sm font-bold">2. Set a Password Hint (Optional)</h2>
          <p className="text-[10px] text-muted-foreground leading-normal">
            A hint can help jog your memory if you forget your master password.
          </p>
        </div>

        <div className="space-y-3">
          {/* Hint Input */}
          <div className="space-y-1.5 text-left">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Hint Description</label>
            <Input
              type="text"
              placeholder="e.g., My childhood pet + year I graduated"
              value={hint}
              onChange={e => setHint(e.target.value.slice(0, characterLimit))}
              className="text-xs h-9 bg-card/20"
              autoFocus
            />
            <div className="flex justify-end text-[9px] text-muted-foreground font-mono">
              {hint.length} / {characterLimit} chars
            </div>
          </div>

          {/* Warning Callout */}
          <div className="border border-amber/35 rounded-lg bg-amber/5 p-3 flex gap-2 text-[10px] text-amber leading-relaxed">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Plaintext Security Notice</span>
              Hints are stored in plaintext so they can be read before unlocking. Do not write down your actual password or anything that directly reveals it to others.
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-2 border-t border-border/40 shrink-0">
        <button
          onClick={onBack}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5 cursor-pointer font-medium"
        >
          <ArrowLeft size={12} /> Back
        </button>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => onNext("")}
            className="text-[10px] text-muted-foreground hover:bg-muted text-xs h-8 px-4 font-semibold cursor-pointer"
          >
            Skip
          </Button>
          <Button
            disabled={isOverLimit}
            onClick={() => onNext(hint)}
            className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer"
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
