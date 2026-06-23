import { useState, useEffect, useCallback } from "react";
import { X, Copy, RefreshCw, AlertTriangle } from "lucide-react";
import { generatePassword, copyToClipboard } from "../lib/tauri";
import { StrengthBar } from "../pages/Dashboard";
import { Button } from "./ui/button";

interface PasswordGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (password: string) => void;
}

export default function PasswordGeneratorModal({
  isOpen,
  onClose,
  onApply,
}: PasswordGeneratorModalProps) {
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    // If no character sets are selected, show error locally to avoid roundtrip error
    if (!uppercase && !lowercase && !digits && !symbols) {
      setGeneratedPassword("");
      setError("Please select at least one character set.");
      return;
    }
    
    setError(null);
    try {
      const pw = await generatePassword({
        length,
        uppercase,
        lowercase,
        digits,
        symbols,
      });
      setGeneratedPassword(pw);
    } catch (err: any) {
      setError(err.message || String(err));
      setGeneratedPassword("");
    }
  }, [length, uppercase, lowercase, digits, symbols]);

  // Generate on load or when parameters change
  useEffect(() => {
    if (isOpen) {
      generate();
    }
  }, [isOpen, generate]);

  const handleCopy = async () => {
    if (!generatedPassword) return;
    try {
      await copyToClipboard(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy password:", err);
    }
  };

  const handleApply = () => {
    if (generatedPassword) {
      onApply(generatedPassword);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-xl space-y-4 animate-fadeIn text-foreground">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-border pb-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Generate secure password
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        {/* Password Output Field */}
        <div className="relative">
          <input
            type="text"
            readOnly
            value={generatedPassword || (error ? "Error: check settings" : "Generating...")}
            className={`w-full rounded-md border border-border bg-background p-2.5 pr-16 text-center font-mono text-sm tracking-wider outline-none ${
              error ? "text-danger" : "text-foreground"
            }`}
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <button
              type="button"
              disabled={!generatedPassword}
              onClick={handleCopy}
              className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 cursor-pointer"
              title="Copy to clipboard"
            >
              {copied ? (
                <span className="text-[10px] text-teal font-semibold px-1">Copied</span>
              ) : (
                <Copy size={13} />
              )}
            </button>
            <button
              type="button"
              onClick={generate}
              className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
              title="Regenerate"
            >
              <RefreshCw size={13} className="animate-spin-once" />
            </button>
          </div>
        </div>

        {/* Strength Bar */}
        {generatedPassword && (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex-1 mr-3">
              <StrengthBar password={generatedPassword} />
            </div>
            <span className="font-semibold text-teal shrink-0">
              {Math.round(generatedPassword.length * 4.4)} bits — Strong
            </span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-2 border border-danger/25 bg-danger/10 text-danger rounded-md text-[10px] flex items-center gap-1.5 leading-relaxed">
            <AlertTriangle size={12} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Length Slider (8 - 64) */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase">
            <span>Length</span>
            <span className="text-foreground">{length}</span>
          </div>
          <input
            type="range"
            min={8}
            max={64}
            value={length}
            onChange={(e) => setLength(parseInt(e.target.value))}
            className="w-full accent-purple cursor-pointer h-1 bg-border rounded-lg appearance-none"
          />
        </div>

        {/* Character Set Toggles */}
        <div className="grid grid-cols-2 gap-2.5 pt-1 text-[11px]">
          <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={uppercase}
              onChange={(e) => setUppercase(e.target.checked)}
              className="rounded text-purple cursor-pointer"
            />
            <span>Uppercase (A–Z)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={lowercase}
              onChange={(e) => setLowercase(e.target.checked)}
              className="rounded text-purple cursor-pointer"
            />
            <span>Lowercase (a–z)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={digits}
              onChange={(e) => setDigits(e.target.checked)}
              className="rounded text-purple cursor-pointer"
            />
            <span>Numbers (0–9)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={symbols}
              onChange={(e) => setSymbols(e.target.checked)}
              className="rounded text-purple cursor-pointer"
            />
            <span>Symbols (!@#$)</span>
          </label>
        </div>

        {/* Modal Actions Footer */}
        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!generatedPassword}
            onClick={handleApply}
            className="text-xs bg-purple text-white hover:bg-purple/90 font-semibold cursor-pointer"
          >
            Use Password
          </Button>
        </div>
      </div>
    </div>
  );
}
