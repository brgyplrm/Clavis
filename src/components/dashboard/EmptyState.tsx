import { Plus, ShieldAlert, Sparkles, Key } from "lucide-react";
import { Button } from "../ui/button";

interface EmptyStateProps {
  onAdd: () => void;
}

export default function EmptyState({ onAdd }: EmptyStateProps) {
  const handleStartCoaching = () => {
    // Save coaching mode flag in sessionStorage so we can show interactive tooltips in the form
    sessionStorage.setItem("clavis_coaching_active", "true");
    onAdd();
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center py-10 px-6 text-center select-none animate-fade-in max-w-lg mx-auto">
      {/* Visual Branded Frame */}
      <div className="relative mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-purple/10 text-purple shadow-xl shadow-purple/5">
        {/* Abstract glowing ring */}
        <div className="absolute inset-0 rounded-3xl border border-purple/30 animate-pulse" />
        <Key size={36} className="text-purple animate-bounce" />
        <Sparkles size={16} className="absolute -top-1.5 -right-1.5 text-teal animate-pulse" />
      </div>

      <div className="space-y-2 mb-6">
        <h2 className="text-sm font-bold tracking-tight text-foreground bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">Your Vault is Empty</h2>
        <p className="text-[10.5px] text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
          Start by adding a website login, password, or TOTP security key. All credentials will be encrypted locally on your device.
        </p>
      </div>

      <Button
        onClick={handleStartCoaching}
        className="bg-purple text-white hover:bg-purple/90 shrink-0 gap-1.5 px-6 h-9 text-xs font-semibold rounded-xl shadow-lg shadow-purple/15 cursor-pointer animate-pulse"
      >
        <Plus size={14} />
        <span>Add Your First Entry</span>
      </Button>

      {/* Security Tip Box */}
      <div className="mt-8 border border-border/40 rounded-xl bg-card/25 p-3 flex gap-2.5 text-[9.5px] text-muted-foreground leading-normal max-w-sm text-left">
        <ShieldAlert size={16} className="shrink-0 mt-0.5 text-purple" />
        <div>
          <span className="font-semibold text-foreground block">Local-First Encryption</span>
          Clavis does not use any cloud servers. Every entry you add is encrypted on your machine using Argon2id and AES-GCM before writing to your local database.
        </div>
      </div>
    </div>
  );
}
