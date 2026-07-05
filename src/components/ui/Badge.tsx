// Shared Badge primitive (design-system consolidation). Before this, every
// page hand-rolled its own badge className string — StatusBadge in
// /alerts, FlagBadge in DailyTable, the "✋ Manual" chip, the "Sandbox mode"
// pill — each slightly different padding/radius/font-weight. One component,
// one set of tokens, still themed for light + dark.
type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ai' | 'manual';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  info:    'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-800',
  success: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60',
  warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/60',
  danger:  'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 border-red-300 dark:border-red-800',
  // Data-provenance pair (P2-2) — AI vs manually-entered data, used on the
  // dashboard next to the tower section header and already established by
  // the "✋ Manual" badge pattern in the history table.
  ai:      'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/60',
  manual:  'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700/60',
};

export default function Badge({
  children,
  variant = 'neutral',
  className = '',
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
