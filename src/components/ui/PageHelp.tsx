import { useState } from "react";
import { HelpCircle, X } from "lucide-react";

interface PageHelpProps {
  title: string;
  description: string;
  tips?: string[];
}

export default function PageHelp({ title, description, tips }: PageHelpProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Toggle Help Panel"
        className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
      >
        <HelpCircle size={15} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-9 z-50 w-72 rounded-lg border border-border bg-card p-4 shadow-lg text-[11px] leading-relaxed animate-fade-in text-foreground select-none">
          <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-2 font-semibold">
            <span>{title}</span>
            <button
              onClick={() => setIsOpen(false)}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
          <p className="text-muted-foreground">{description}</p>
          {tips && tips.length > 0 && (
            <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-1">
              <span className="font-bold text-purple uppercase tracking-wider text-[9px] block">Quick Tips</span>
              {tips.map((tip, i) => (
                <div key={i} className="flex gap-1 items-start text-muted-foreground">
                  <span className="text-purple shrink-0">•</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
