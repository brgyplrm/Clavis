import { useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { useVaultStore } from "../hooks/useVaultStore";

export default function Unlock() {
  const { unlock, loading, error, clearError } = useVaultStore();
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setLocalError(null);
    clearError();
    try {
      await unlock(pw);
    } catch (err: any) {
      setLocalError(err.message || String(err));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-purple text-white shadow-md shadow-purple/20">
            <ShieldCheck size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Clavis</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your vault is locked</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Master password</label>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                autoFocus
                placeholder="Enter your master password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          {(localError || error) && (
            <p className="text-xs text-danger bg-danger/10 border border-danger/20 p-2 rounded-lg">
              {localError || error}
            </p>
          )}
          <Button type="submit" disabled={loading} className="w-full bg-purple text-white hover:bg-purple/90">
            {loading ? "Unlocking..." : "Unlock vault"}
          </Button>
        </form>
      </div>
    </div>
  );
}
