import { useState, useEffect } from "react";
import { TOUR_STOPS, PageView } from "../lib/tourSteps";
import { useVaultStore } from "./useVaultStore";

export interface TourCoords {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function useTour(
  currentStep: number,
  currentView: PageView,
  onChangeView: (view: PageView) => void
) {
  const [coords, setCoords] = useState<TourCoords | null>(null);
  const stop = TOUR_STOPS[currentStep];

  // Align active view automatically with current step view
  useEffect(() => {
    if (stop && currentView !== stop.view) {
      onChangeView(stop.view);
    }
  }, [currentStep, stop?.view, currentView, onChangeView]);

  // Handle tour helper actions (auto-selecting entries and settings tabs)
  useEffect(() => {
    if (!stop) return;
    const store = useVaultStore.getState();

    // 1. If it's a dashboard details step, auto-select the first entry
    if (stop.view === "dashboard" && (
      stop.selector === "#tour-detail-pane" || 
      stop.selector === "#tour-reveal-eye" || 
      stop.selector === "#tour-copy-button" || 
      stop.selector === "#tour-edit-button" || 
      stop.selector === "#tour-delete-button"
    )) {
      if (!store.selectedEntryId && store.entries.length > 0) {
        store.setSelectedEntryId(store.entries[0].id);
      }
    }

    // 2. If it's a settings step, auto-select the correct settings tab
    if (stop.view === "settings") {
      if (stop.selector === "#tour-settings-general") {
        store.setActiveSettingsTab("general");
      } else if (stop.selector === "#tour-settings-security" || stop.selector === "#tour-settings-autotype") {
        store.setActiveSettingsTab("security");
      } else if (stop.selector === "#tour-extensions") {
        store.setActiveSettingsTab("extension");
      } else if (stop.selector === "#tour-settings-backup") {
        store.setActiveSettingsTab("backup");
      }
    }
  }, [currentStep, stop]);

  // Compute selector bounds for spotlight positioning
  useEffect(() => {
    setCoords(null);
    if (!stop || !stop.selector) return;

    let attempts = 0;
    const updateCoords = () => {
      const el = document.querySelector(stop.selector!);
      if (el) {
        const rect = el.getBoundingClientRect();
        setCoords({
          x: rect.left - 4,
          y: rect.top - 4,
          w: rect.width + 8,
          h: rect.height + 8
        });
      } else if (attempts < 15) {
        attempts++;
        setTimeout(updateCoords, 100);
      }
    };

    const timer = setTimeout(updateCoords, 150);
    return () => clearTimeout(timer);
  }, [currentStep, currentView, stop?.selector]);

  return { coords, stop };
}
