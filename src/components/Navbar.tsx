'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';

// Emoji nav icons (audit C3) rendered inconsistently across OS/browser, couldn't be
// styled with CSS (colour, stroke width), and had poor screen-reader semantics.
// Replaced with a small outline-style inline SVG set — no new icon-library dependency,
// consistent with the "adopt one icon system" recommendation (audit §5).
function IconDashboard(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}
function IconHistory(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function IconLogbook(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 4h11a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z" />
      <path d="M6 4v16M9 8h6M9 12h6" />
    </svg>
  );
}
function IconCommittee(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="7" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.2 3.2 0 0 1 0 6.4M18.5 20a5.5 5.5 0 0 0-3.8-6.7" />
    </svg>
  );
}
function IconAlerts(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}
// Water-drop monogram — same mark used in the email header (src/lib/email.ts) so the
// brand identity is consistent everywhere (audit C2).
function LogoMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C12 2 5 10 5 15a7 7 0 0 0 14 0C19 10 12 2 12 2z" />
    </svg>
  );
}

const NAV_LINKS = [
  { href: '/',           label: 'Dashboard',  Icon: IconDashboard },
  { href: '/history',    label: 'History',    Icon: IconHistory },
  { href: '/logbook',    label: 'Log Book',   Icon: IconLogbook },
  { href: '/committee',  label: 'Committee',  Icon: IconCommittee },
  { href: '/alerts',     label: 'Alerts',     Icon: IconAlerts },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const isUpload = pathname.startsWith('/upload');

  return (
    <>
      <header
        ref={drawerRef}
        className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-40"
      >
        {/* ── Main bar ── */}
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">

          {/* Logo / wordmark */}
          <Link
            href="/"
            className="flex items-center gap-2 flex-shrink-0 group"
          >
            <span className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
              <LogoMark className="w-4 h-4 text-white" />
            </span>
            <span className="font-bold text-slate-900 dark:text-white text-sm leading-tight hidden xs:inline">
              Trinity World
            </span>
          </Link>

          {/* Desktop nav links — active state uses blue accent + bottom border
              indicator (audit C3), not the previous barely-visible bg change. */}
          <nav className="hidden md:flex items-center gap-1 ml-4 flex-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 border-b-2 text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'border-blue-500 text-blue-700 dark:text-blue-400'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Spacer on mobile */}
          <div className="flex-1 md:hidden" />

          {/* Desktop: theme toggle */}
          <div className="hidden md:flex items-center">
            <ThemeToggle />
          </div>

          {/* Upload CTA — always visible, adapts size */}
          {!isUpload && (
            <Link
              href="/upload"
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold px-3 py-2 md:px-4 rounded-xl transition-colors shadow-sm shadow-blue-600/30 flex-shrink-0"
            >
              <span className="text-base leading-none">↑</span>
              <span className="hidden xs:inline">Upload Sheet</span>
              <span className="xs:hidden">Upload</span>
            </Link>
          )}

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setOpen(v => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="md:hidden flex-shrink-0 w-9 h-9 flex flex-col items-center justify-center gap-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span
              className={`block w-5 h-0.5 bg-current rounded-full transition-all duration-200 origin-center ${open ? 'rotate-45 translate-y-2' : ''}`}
            />
            <span
              className={`block w-5 h-0.5 bg-current rounded-full transition-all duration-200 ${open ? 'opacity-0 scale-x-0' : ''}`}
            />
            <span
              className={`block w-5 h-0.5 bg-current rounded-full transition-all duration-200 origin-center ${open ? '-rotate-45 -translate-y-2' : ''}`}
            />
          </button>
        </div>

        {/* ── Mobile drawer ── */}
        <div
          className={`md:hidden overflow-hidden transition-all duration-200 ease-out ${
            open ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <nav className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
            {NAV_LINKS.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-[18px] h-[18px] flex-shrink-0" />
                {label}
                {isActive(href) && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500 dark:bg-blue-400" />
                )}
              </Link>
            ))}

            {/* Divider + theme toggle */}
            <div className="flex items-center justify-between px-3 pt-3 mt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">Appearance</span>
              <ThemeToggle />
            </div>
          </nav>
        </div>
      </header>

      {/* Backdrop for drawer */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/20 dark:bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}
    </>
  );
}
