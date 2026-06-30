import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { openUrl, closeWindow } from "../../lib/tauri";

export default function Eula({ onAccept }: { onAccept: () => void }) {
  const [eulaText, setEulaText] = useState("Loading License Agreement...");
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

  useEffect(() => {
    fetch("/eula.txt")
      .then(res => res.text())
      .then(text => setEulaText(text))
      .catch(err => {
        console.error("Failed to load EULA:", err);
        setEulaText("Failed to load End User License Agreement. Please check installation.");
      });
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const diff = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (diff <= 50) {
      setHasScrolledToBottom(true);
    }
  };

  return (
    <div className="flex h-screen w-full flex-col justify-between bg-background p-6 text-foreground animate-fade-in select-none">
      <div className="space-y-1 text-center shrink-0">
        <h1 className="text-sm font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">End User License Agreement</h1>
        <p className="text-[10px] text-muted-foreground">Please read and scroll to accept the terms to continue</p>
      </div>

      <div 
        onScroll={handleScroll}
        className="flex-1 min-h-0 border border-border/60 rounded-lg p-4 bg-card/30 overflow-y-auto text-xs text-muted-foreground leading-relaxed whitespace-pre-line select-text scrollbar-thin my-4"
      >
        {eulaText}
      </div>

      <div className="flex justify-between items-center shrink-0">
        <button
          type="button"
          onClick={() => openUrl("https://github.com/brgyplrm/Clavis/blob/main/LICENSE")}
          className="text-[10px] text-purple hover:underline font-semibold cursor-pointer"
        >
          View Full License
        </button>

        <div className="flex gap-2.5">
          <Button
            onClick={() => closeWindow()}
            className="bg-transparent border border-border hover:bg-muted text-muted-foreground text-xs h-8 px-4 font-semibold cursor-pointer"
          >
            Decline & Quit
          </Button>
          <Button
            disabled={!hasScrolledToBottom}
            onClick={onAccept}
            className="bg-purple text-white hover:bg-purple/90 text-xs h-8 px-5 font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            I Agree
          </Button>
        </div>
      </div>
    </div>
  );
}
