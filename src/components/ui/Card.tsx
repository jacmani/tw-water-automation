// Shared Card primitive (design-system consolidation). The
// `bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800
// rounded-xl` combination was copy-pasted across TowerCard, TrendChart,
// AmenitiesPanel, InflowSummaryPanel, WaterLevelsPanel, HeatmapView, the
// history table shell, the alerts table shell, and the committee member
// cards — one source of truth now, plus an optional "interactive" mode for
// the confident-and-snappy hover/press feedback used on clickable cards.
export default function Card({
  children,
  className = '',
  interactive = false,
  accentColor,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  accentColor?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl ${
        interactive
          ? 'transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer'
          : ''
      } ${className}`}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 3, ...style } : style}
    >
      {children}
    </div>
  );
}
