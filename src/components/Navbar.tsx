'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';

const NAV_LINKS = [
  { href: '/',           label: 'Dashboard',  icon: '⊞' },
  { href: '/history',    label: 'History',    icon: '📊' },
  { href: '/logbook',    label: 'Log Book',   icon: '📒' },
  { href: '/committee',  label: 'Committee',  icon: '👥' },
  { href: '/alerts',     label: 'Alerts',     icon: '🔔' },
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
            <span className="text-blue-600 dark:text-blue-400 text-xl leading-none">💧</span>
            <span className="font-bold text-slate-900 dark:text-white text-sm leading-tight hidden xs:inline">
              TW Water
            </span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-1 ml-4 flex-1">
            {NAV_LINKS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800/60'
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
            {NAV_LINKS.map(({ href, label, icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="text-base w-6 text-center">{icon}</span>
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
