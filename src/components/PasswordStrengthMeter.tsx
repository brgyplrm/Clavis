import { useEffect, useState } from "react";
import { estimatePasswordStrength, StrengthEstimate } from "../lib/tauri";
import { cn } from "../lib/utils";

interface PasswordStrengthMeterProps {
  password?: string;
  onStrengthChange?: (score: number, isValid: boolean) => void;
  minScoreRequired?: number; // e.g. 3 for Master Password
}

export default function PasswordStrengthMeter({ 
  password = "", 
  onStrengthChange,
  minScoreRequired = 0 
}: PasswordStrengthMeterProps) {
  const [estimate, setEstimate] = useState<StrengthEstimate>({
    score: 0,
    entropy: 0,
    feedback: []
  });

  useEffect(() => {
    if (!password) {
      const defaultEstimate = { score: 0, entropy: 0, feedback: [] };
      setEstimate(defaultEstimate);
      if (onStrengthChange) onStrengthChange(0, false);
      return;
    }

    let active = true;
    estimatePasswordStrength(password)
      .then(est => {
        if (active) {
          setEstimate(est);
          if (onStrengthChange) {
            const isValid = est.score >= minScoreRequired;
            onStrengthChange(est.score, isValid);
          }
        }
      })
      .catch(err => {
        console.error("Failed to estimate password strength:", err);
      });

    return () => {
      active = false;
    };
  }, [password, minScoreRequired, onStrengthChange]);

  const { score, entropy, feedback } = estimate;

  const getLabelAndColor = () => {
    if (!password) return { label: "", colorClass: "text-muted-foreground", bgClass: "bg-border/60" };
    switch (score) {
      case 0: return { label: "Very Weak", colorClass: "text-danger", bgClass: "bg-danger" };
      case 1: return { label: "Weak", colorClass: "text-orange-500", bgClass: "bg-orange-500" };
      case 2: return { label: "Fair", colorClass: "text-amber", bgClass: "bg-amber" };
      case 3: return { label: "Strong", colorClass: "text-blue-500", bgClass: "bg-blue-500" };
      case 4: return { label: "Very Strong", colorClass: "text-teal", bgClass: "bg-teal" };
      default: return { label: "", colorClass: "text-muted-foreground", bgClass: "bg-border/60" };
    }
  };

  const { label, colorClass, bgClass } = getLabelAndColor();

  return (
    <div className="space-y-1.5 w-full select-none text-left">
      {password && (
        <div className="flex items-center justify-between text-[9px] font-semibold">
          <span className="text-muted-foreground">Complexity: <span className={cn(colorClass, "font-bold")}>{label}</span></span>
          <span className="text-muted-foreground font-mono">{Math.round(entropy)} bits entropy</span>
        </div>
      )}

      {/* Segmented Progress Layout (4 segments) */}
      <div className="flex gap-1.5 h-1.5 w-full">
        {[1, 2, 3, 4].map(idx => {
          const filled = password ? idx <= (score === 0 ? 1 : score) : false;
          return (
            <div 
              key={idx}
              className={cn(
                "h-full flex-1 rounded-full transition-all duration-300",
                filled ? bgClass : "bg-border/60"
              )}
            />
          );
        })}
      </div>

      {/* Suggestions Feedback */}
      {password && feedback.length > 0 && (
        <ul className="space-y-0.5 pt-0.5 text-[8.5px] text-muted-foreground list-disc list-inside leading-normal">
          {feedback.slice(0, 3).map((item, idx) => (
            <li key={idx} className="truncate">{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
