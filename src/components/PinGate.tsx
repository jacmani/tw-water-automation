'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';

const STORAGE_KEY = 'tw_admin_unlocked';

// Lightweight shared-passcode gate (ClickUp P2-6). /committee/admin was one
// tap away from the public /committee page with nothing in front of it, and
// a single click there ("Start New Term") archives the entire active
// committee roster. This isn't real authentication — there are no accounts,
// matching the rest of the app's no-login philosophy — it's a speed bump so
// the destructive actions on this page aren't reachable by accident or by a
// resident who just clicked around. The passcode lives in
// NEXT_PUBLIC_ADMIN_PIN and is checked client-side; unlocking persists for
// the browser tab session only (sessionStorage), not permanently.
export default function PinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem(STORAGE_KEY) === 'true') {
      setUnlocked(true);
    }
    setChecked(true);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const expected = process.env.NEXT_PUBLIC_ADMIN_PIN;
    if (!expected) {
      // Fail open rather than lock the committee out of their own admin page
      // forever because nobody set the env var yet — but log it loudly so
      // it's obvious this needs configuring.
      console.warn('[PinGate] NEXT_PUBLIC_ADMIN_PIN is not set in this deployment — admin area is currently unprotected.');
      setUnlocked(true);
      sessionStorage.setItem(STORAGE_KEY, 'true');
      return;
    }
    if (pin === expected) {
      setUnlocked(true);
      sessionStorage.setItem(STORAGE_KEY, 'true');
    } else {
      setError(true);
      setPin('');
    }
  }

  // Avoid a one-frame flash of the gate before sessionStorage has been read.
  if (!checked) return null;
  if (unlocked) return <>{children}</>;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm animate-[fadeInUp_0.3s_cubic-bezier(0.16,1,0.3,1)_both]"
      >
        <div className="w-11 h-11 rounded-full bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center mb-4 mx-auto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-blue-600 dark:text-blue-400">
            <rect x="4" y="10" width="16" height="10" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        </div>
        <h1 className="text-center font-semibold text-slate-900 dark:text-white text-sm mb-1">Committee access</h1>
        <p className="text-center text-slate-500 dark:text-slate-400 text-xs mb-4">
          Enter the shared passcode to continue.
        </p>
        <label htmlFor="admin-pin" className="sr-only">Passcode</label>
        <input
          id="admin-pin"
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => { setPin(e.target.value); setError(false); }}
          placeholder="Passcode"
          className={`w-full text-center tracking-[0.3em] font-mono text-lg px-3 py-2.5 rounded-xl border bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder:tracking-normal placeholder:font-sans placeholder:text-sm transition-colors outline-none focus:ring-2 focus:ring-blue-500/40 ${
            error ? 'border-red-400 dark:border-red-600' : 'border-slate-200 dark:border-slate-700'
          }`}
        />
        {error && (
          <p className="text-red-600 dark:text-red-400 text-xs text-center mt-2" role="alert">
            Incorrect passcode — try again.
          </p>
        )}
        <Button type="submit" size="lg" className="w-full mt-4">
          Unlock
        </Button>
      </form>
    </div>
  );
}
