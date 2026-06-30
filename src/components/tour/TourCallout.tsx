import { useEffect, useRef, useState } from "react";
import { X, ArrowRight, ArrowLeft, Check } from "lucide-react";
import { Button } from "../ui/button";
import { TourCoords } from "../../hooks/useTour";
import { TOUR_STOPS } from "../../lib/tourSteps";

interface TourCalloutProps {
  currentStep: number;
  coords: TourCoords | null;
  title: string;
  description: string;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}

export default function TourCallout({
  currentStep,
  coords,
  title,
  description,
  onNext,
  onBack,
  onClose
}: TourCalloutProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(200);

  useEffect(() => {
    if (cardRef.current) {
      // Use offsetHeight or getBoundingClientRect
      setCardHeight(cardRef.current.offsetHeight || 200);
    }
  }, [title, description]);

  const getCardStyle = (): React.CSSProperties => {
    if (!coords) {
      return {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 50,
      };
    }

    const spaceBelow = window.innerHeight - (coords.y + coords.h);
    const spaceAbove = coords.y;
    
    let top = coords.y + coords.h + 12;
    let left = coords.x + coords.w / 2 - 160;

    // If space below is not enough and there is space above, place it above
    if (spaceBelow < cardHeight + 20 && spaceAbove > cardHeight + 20) {
      top = coords.y - cardHeight - 12;
    } else if (spaceBelow < cardHeight + 20 && spaceAbove < cardHeight + 20) {
      // If not enough space either below or above, center it on screen
      return {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
        width: "320px",
        zIndex: 50,
      };
    }

    left = Math.max(16, Math.min(window.innerWidth - 336, left));
    top = Math.max(16, Math.min(window.innerHeight - cardHeight - 20, top));

    return {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: "320px",
      zIndex: 50,
    };
  };

  return (
    <div 
      ref={cardRef}
      style={getCardStyle()} 
      className="rounded-xl border border-border/80 bg-card p-4.5 shadow-2xl space-y-4 animate-scale-up text-foreground select-none max-h-[calc(100vh-32px)] overflow-y-auto"
    >
      <header className="flex justify-between items-start">
        <div className="space-y-0.5">
          <h3 className="text-sm font-bold text-foreground leading-tight">{title}</h3>
          <span className="text-[9px] font-bold text-purple tracking-wider uppercase">
            Step {currentStep + 1} of {TOUR_STOPS.length}
          </span>
        </div>
        <button 
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground cursor-pointer -mt-1 -mr-1 p-1 hover:bg-muted/50 rounded-md transition-colors"
        >
          <X size={14} />
        </button>
      </header>

      <p className="text-[11px] text-muted-foreground leading-relaxed">
        {description}
      </p>

      {/* Action Controls */}
      <footer className="flex items-center justify-between pt-1 border-t border-border/40 shrink-0">
        <button 
          onClick={onClose}
          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline transition-all cursor-pointer font-medium"
        >
          Skip Tour
        </button>

        <div className="flex gap-2">
          {currentStep > 0 && (
            <Button 
              onClick={onBack}
              variant="outline"
              className="h-7 text-[10px] px-2.5 font-semibold text-muted-foreground border-border hover:bg-muted cursor-pointer"
            >
              <ArrowLeft size={11} className="mr-1" /> Back
            </Button>
          )}
          <Button 
            onClick={onNext}
            className="h-7 text-[10px] px-3 font-semibold bg-purple hover:bg-purple/90 text-white shadow-md shadow-purple/10 cursor-pointer"
          >
            {currentStep === TOUR_STOPS.length - 1 ? (
              <>Finish <Check size={11} className="ml-1" /></>
            ) : (
              <>Next <ArrowRight size={11} className="ml-1" /></>
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
}
