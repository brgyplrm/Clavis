import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, ShieldCheck, AlertTriangle } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { scorePassword } from "../lib/passwordStrength";
import { useVaultStore } from "../hooks/useVaultStore";
import { cn } from "../lib/utils";

interface SetupProps {
  onComplete: () => void;
}

export function StrengthBar({ password }: { password: string }) {
  const { score } = scorePassword(password);
  const colors = ["bg-border", "bg-danger", "bg-amber", "bg-teal", "bg-teal"];
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", i <= score ? colors[score] : "bg-border/60")} />
      ))}
    </div>
  );
}

export default function Setup({ onComplete }: SetupProps) {
  const { unlock, loading } = useVaultStore();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { checks, score } = scorePassword(pw);
  const allMet = Object.values(checks).every(Boolean) && pw === pw2 && pw.length > 0;

  useEffect(() => {
    if (step === 3) {
      const t = setTimeout(() => {
        onComplete();
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [step, onComplete]);

  const handleCreateVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (confirm !== pw) return;
    setErrorMsg(null);
    try {
      await unlock(pw);
      
      // Auto-create a default vault partition if none exists
      const store = useVaultStore.getState();
      if (store.vaults.length === 0) {
        await store.createVault("Default");
      }
      
      setStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || String(err));
    }
  };

  const steps = ["Create password", "Confirm", "Done"];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md">
        {/* Step Indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {steps.map((s, i) => {
            const n = i + 1;
            const active = step >= n;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors duration-300",
                  active ? "bg-purple text-white" : "bg-muted text-muted-foreground"
                )}>
                  {step > n ? <Check size={12} /> : n}
                </div>
                <span className={cn("text-xs font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                  {s}
                </span>
                {i < 2 && <div className={cn("h-px w-8 transition-colors duration-300", step > n ? "bg-purple" : "bg-border")} />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-purple text-white shadow-md shadow-purple/20">
                <ShieldCheck size={22} />
              </div>
              <h1 className="text-xl font-bold tracking-tight">Create your master password</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This password encrypts your entire local vault.
              </p>
            </div>

            {/* Security warning - Zero Knowledge Constraint */}
            <div className="flex gap-3 rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-amber-600 dark:text-amber-500">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block mb-0.5">Zero-Knowledge Security Warning</span>
                Clavis stores all data locally with strong encryption. We do not store, transit, or have any access to your master password. If lost, it cannot be recovered, and your data will be permanently inaccessible.
              </div>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <Input
                  type={show ? "text" : "password"}
                  placeholder="Master password"
                  value={pw}
                  onChange={e => setPw(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <Input
                type={show ? "text" : "password"}
                placeholder="Confirm password"
                value={pw2}
                onChange={e => setPw2(e.target.value)}
              />
              <StrengthBar password={pw} />
              <ul className="grid grid-cols-2 gap-1.5 pt-1 text-xs">
                {[
                  ["12+ characters", checks.length],
                  ["Uppercase letter", checks.upper],
                  ["Lowercase letter", checks.lower],
                  ["Number", checks.number],
                  ["Symbol", checks.symbol],
                ].map(([label, ok]) => (
                  <li key={label as string} className={cn("flex items-center gap-1.5 transition-colors duration-300", ok ? "text-teal" : "text-muted-foreground")}>
                    <Check size={12} className={cn("transition-opacity duration-300", ok ? "opacity-100" : "opacity-30")} />
                    {label}
                  </li>
                ))}
              </ul>
              {pw && pw2 && pw !== pw2 && <p className="text-xs text-danger">Passwords do not match</p>}
            </div>
            <Button
              disabled={!allMet || score < 3}
              onClick={() => setStep(2)}
              className="w-full bg-purple text-white hover:bg-purple/90"
            >
              Continue
            </Button>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleCreateVault} className="space-y-5">
            <div className="text-center">
              <h1 className="text-xl font-bold tracking-tight">Re-enter your master password to confirm</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                To prevent typos, please type your password once more.
              </p>
            </div>
            <Input
              type="password"
              placeholder="Master password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoFocus
              className="w-full"
            />
            {confirm && confirm !== pw && <p className="text-xs text-danger">Passwords do not match</p>}
            {errorMsg && <p className="text-sm text-danger bg-danger/10 border border-danger/20 p-2.5 rounded-lg">{errorMsg}</p>}
            <Button
              type="submit"
              disabled={confirm !== pw || loading}
              className="w-full bg-purple text-white hover:bg-purple/90"
            >
              {loading ? "Creating Vault..." : "Create vault"}
            </Button>
          </form>
        )}

        {step === 3 && (
          <div className="flex flex-col items-center text-center animate-fade-in">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal/15 text-teal">
              <Check size={32} />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Vault created</h1>
            <p className="mt-1 text-sm text-muted-foreground">Opening your vault…</p>
          </div>
        )}
      </div>
    </div>
  );
}
