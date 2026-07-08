'use client';

// Shared Button primitive (design-system consolidation). Every primary CTA
// in the app ("Upload Sheet" in Navbar, "Upload Sheet" submit, "Unlock" on
// the PIN gate, "+ Add" / "Start New Term" in committee admin) previously
// had its own copy of `bg-blue-600 hover:bg-blue-500 ... transition-colors`
// with no shared press feedback. This adds a consistent active:scale press
// (the "confident & snappy" micro-interaction) once, everywhere.
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:   'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-600/20 disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none',
  secondary: 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50',
  ghost:     'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-50',
  danger:    'bg-red-600 hover:bg-red-500 text-white disabled:opacity-50',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1.5 rounded-lg',
  md: 'text-sm px-4 py-2.5 rounded-xl',
  lg: 'text-base px-5 py-4 rounded-xl',
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
