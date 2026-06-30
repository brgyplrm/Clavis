import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { KeyRound, ShieldAlert } from "lucide-react";
import { cn } from "../lib/utils";

interface AutotypeMatch {
  id: string;
  title: string;
  username: string;
}

export default function AutotypePicker() {
  const [matches, setMatches] = useState<AutotypeMatch[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<AutotypeMatch[]>("get_autotype_matches")
      .then(res => {
        setMatches(res);
      })
      .catch(err => {
        console.error("Failed to load autotype matches:", err);
      });
  }, []);

  useEffect(() => {
    if (matches.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % matches.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + matches.length) % matches.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (matches[selectedIndex]) {
          handleSelect(matches[selectedIndex].id);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        getCurrentWindow().close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [matches, selectedIndex]);

  const handleSelect = (id: string) => {
    invoke("submit_autotype_selection", { id }).catch(err => {
      console.error("Failed to submit autotype selection:", err);
    });
  };

  return (
    <div 
      ref={containerRef}
      className="flex flex-col h-screen w-screen bg-zinc-950 border border-purple/35 rounded-xl shadow-2xl overflow-hidden font-sans text-foreground select-none p-3 space-y-2.5"
    >
      <header className="flex items-center gap-1.5 shrink-0 border-b border-border/40 pb-1.5">
        <KeyRound size={14} className="text-purple animate-pulse" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Select Autotype Account</span>
      </header>

      {matches.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-3 text-muted-foreground">
          <ShieldAlert size={20} className="text-danger mb-1.5 animate-bounce" />
          <p className="text-[10px]">Loading matches...</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5 scrollbar-thin">
          {matches.map((item, idx) => {
            const selected = idx === selectedIndex;
            return (
              <button
                key={item.id}
                onClick={() => handleSelect(item.id)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={cn(
                  "w-full text-left p-2 rounded-lg flex flex-col transition-all duration-200 cursor-pointer border border-transparent",
                  selected 
                    ? "bg-purple text-white shadow-md shadow-purple/10 border-purple/40" 
                    : "hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                )}
              >
                <span className="text-[11px] font-bold truncate">{item.title}</span>
                <span className={cn("text-[9px] truncate mt-0.5", selected ? "text-white/80" : "text-muted-foreground/75")}>
                  {item.username || "No username"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <footer className="shrink-0 border-t border-border/40 pt-1.5 text-[8.5px] text-muted-foreground text-center">
        Press <kbd className="bg-zinc-800 px-1 rounded text-[7.5px]">↑/↓</kbd> to navigate, <kbd className="bg-zinc-800 px-1 rounded text-[7.5px]">Enter</kbd> to autotype, <kbd className="bg-zinc-800 px-1 rounded text-[7.5px]">Esc</kbd> to cancel
      </footer>
    </div>
  );
}
