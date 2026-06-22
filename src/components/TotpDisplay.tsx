import { useEffect, useState } from "react";
import { getTotpCode } from "../lib/tauri";
import { Copy, Check, AlertCircle } from "lucide-react";

interface TotpDisplayProps {
  entryId: string;
}

export default function TotpDisplay({ entryId }: TotpDisplayProps) {
  const [code, setCode] = useState<string>("");
  const [secondsRemaining, setSecondsRemaining] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchCode = async () => {
    try {
      setError(null);
      const res = await getTotpCode(entryId);
      setCode(res.code);
      setSecondsRemaining(res.seconds_remaining);
    } catch (err: any) {
      setError(err.toString());
    }
  };

  useEffect(() => {
    fetchCode();
  }, [entryId]);

  useEffect(() => {
    if (error || !code) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          fetchCode();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [code, error]);

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy TOTP code", err);
    }
  };

  if (error) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-danger">
        <AlertCircle size={14} />
        <span>{error}</span>
      </div>
    );
  }

  if (!code) {
    return (
      <div className="h-6 w-20 animate-pulse rounded bg-muted/40" />
    );
  }

  // Format code to show a space in the middle: e.g., "123 456"
  const formattedCode = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

  // Circular progress calculations for the countdown ring
  const stroke = 3;
  const size = 28;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = ((30 - secondsRemaining) / 30) * c;

  return (
    <div className="flex items-center gap-3">
      {/* 6-Digit Code */}
      <span className="font-mono text-sm font-semibold tracking-wider text-purple select-all">
        {formattedCode}
      </span>

      {/* Countdown Ring */}
      <div className="relative flex items-center justify-center" title={`${secondsRemaining}s remaining`}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle
            r={r}
            cx={size / 2}
            cy={size / 2}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-muted-foreground/15"
          />
          <circle
            r={r}
            cx={size / 2}
            cy={size / 2}
            fill="transparent"
            stroke="var(--color-purple)"
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={pct}
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <span className="absolute text-[8px] font-bold text-muted-foreground">
          {secondsRemaining}
        </span>
      </div>

      {/* Copy Button */}
      <button
        onClick={handleCopy}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Copy TOTP Code"
      >
        {copied ? <Check size={14} className="text-teal" /> : <Copy size={14} />}
      </button>
    </div>
  );
}
