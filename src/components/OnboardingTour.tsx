import { useEffect, useState } from "react";
import { useTour } from "../hooks/useTour";
import { TOUR_STOPS, PageView } from "../lib/tourSteps";
import TourOverlay from "./tour/TourOverlay";
import TourCallout from "./tour/TourCallout";
import { cn } from "../lib/utils";

function CSSConfetti() {
  const particles = Array.from({ length: 60 });
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-50">
      <style>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(-10px) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
      `}</style>
      {particles.map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 3;
        const duration = Math.random() * 3 + 2;
        const size = Math.random() * 8 + 4;
        const color = ["#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#3B82F6"][Math.floor(Math.random() * 5)];
        const shape = Math.random() > 0.5 ? "rounded-full" : "rounded-sm";
        return (
          <div
            key={i}
            className={cn("absolute top-0", shape)}
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size}px`,
              backgroundColor: color,
              animation: `confetti-fall ${duration}s linear ${delay}s infinite`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
          />
        );
      })}
    </div>
  );
}

interface OnboardingTourProps {
  currentView: PageView;
  onChangeView: (view: PageView) => void;
  onClose: () => void;
}

export default function OnboardingTour({ currentView, onChangeView, onClose }: OnboardingTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const { coords, stop } = useTour(currentStep, currentView, onChangeView);

  // Handle WCAG keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        if (currentStep < TOUR_STOPS.length - 1) {
          setCurrentStep(s => s + 1);
        }
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        if (currentStep > 0) {
          setCurrentStep(s => s - 1);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentStep, onClose]);

  const handleNext = () => {
    if (currentStep < TOUR_STOPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!stop) return null;

  return (
    <div className="fixed inset-0 z-40 select-none font-sans overflow-hidden">
      {/* SVG Spotlight Mask */}
      <TourOverlay coords={coords} />

      {/* Confetti on Done Step */}
      {currentStep === TOUR_STOPS.length - 1 && <CSSConfetti />}

      {/* Tooltip Card */}
      <TourCallout
        currentStep={currentStep}
        coords={coords}
        title={stop.title}
        description={stop.description}
        onNext={handleNext}
        onBack={handleBack}
        onClose={onClose}
      />
    </div>
  );
}
