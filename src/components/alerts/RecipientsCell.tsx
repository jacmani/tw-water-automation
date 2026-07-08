'use client';

import { useState } from 'react';

// Recipient list used to be hover-only (title=), unreachable on touch devices
// (P1-5). Tap-to-toggle makes the full list reachable on mobile; the button
// also carries an aria-label so screen readers get the full list up front.
export default function RecipientsCell({ recipients }: { recipients: string[] }) {
  const [open, setOpen] = useState(false);

  if (recipients.length === 1) {
    return <span>{recipients[0]}</span>;
  }

  return (
    <span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${recipients.length} recipients: ${recipients.join(', ')}`}
        className="border-b border-dotted border-slate-400 dark:border-slate-600 cursor-pointer"
      >
        {recipients.length} recipients
      </button>
      {open && (
        <span className="block mt-1 text-slate-600 dark:text-slate-300 whitespace-normal">
          {recipients.join(', ')}
        </span>
      )}
    </span>
  );
}
