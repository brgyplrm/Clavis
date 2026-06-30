import { TourCoords } from "../../hooks/useTour";

interface TourOverlayProps {
  coords: TourCoords | null;
}

export default function TourOverlay({ coords }: TourOverlayProps) {
  return (
    <svg className="fixed inset-0 w-full h-full pointer-events-none z-30">
      <defs>
        <mask id="spotlight-mask">
          {/* White covers the entire screen, allowing the backdrop to be drawn */}
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {/* Black cuts out the spotlight hole, leaving the target element bright */}
          {coords && (
            <rect 
              x={coords.x} 
              y={coords.y} 
              width={coords.w} 
              height={coords.h} 
              rx={8} 
              ry={8} 
              fill="black" 
            />
          )}
        </mask>
      </defs>
      <rect 
        x="0" 
        y="0" 
        width="100%" 
        height="100%" 
        fill="rgba(15, 23, 42, 0.75)" 
        mask="url(#spotlight-mask)" 
        className="pointer-events-auto transition-all duration-300"
      />
    </svg>
  );
}
