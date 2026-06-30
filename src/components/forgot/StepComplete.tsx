import { Check } from "lucide-react";
import { Button } from "../ui/button";

interface StepCompleteProps {
  onProceed: () => void;
}

export default function StepComplete({ onProceed }: StepCompleteProps) {
  return (
    <div className="flex flex-col items-center text-center space-y-4 animate-fade-in py-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal/10 text-teal shadow-lg shadow-teal/10">
        <Check size={28} className="animate-pulse" />
      </div>
      <div className="space-y-1">
        <h1 className="text-base font-bold tracking-tight text-foreground">Password Reset Complete!</h1>
        <p className="text-[10px] text-muted-foreground max-w-[260px] leading-relaxed">
          Your SQLCipher database has been successfully re-encrypted with your new master password. The emergency recovery configuration has also been updated.
        </p>
      </div>
      <Button
        onClick={onProceed}
        className="bg-purple text-white hover:bg-purple/90 w-44 h-8.5 text-xs font-semibold rounded-lg shadow-md shadow-purple/10 cursor-pointer animate-pulse"
      >
        Proceed to Unlock Vault
      </Button>
    </div>
  );
}
