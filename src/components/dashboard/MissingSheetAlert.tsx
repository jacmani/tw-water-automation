'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Props { hasSheet: boolean }

export default function MissingSheetAlert({ hasSheet }: Props) {
  const [isPastTen, setIsPastTen] = useState(false);
  useEffect(() => {
    // Use IST hour specifically, not the viewer's local browser time — a committee
    // member checking the dashboard from outside India would otherwise get a wrong
    // answer here (this alert is about the technician's on-site 10 AM IST deadline).
    const istHour = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
    setIsPastTen(istHour >= 10);
  }, []);
  if (hasSheet || !isPastTen) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-700/60 rounded-xl p-4 flex items-start gap-3">
      <span className="text-xl flex-shrink-0">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-amber-700 dark:text-amber-400 font-semibold text-sm">No sheet uploaded today</p>
        <p className="text-amber-600/80 dark:text-amber-300/70 text-xs mt-0.5">
          The technician uploads a photo of yesterday&apos;s completed sheet each morning —
          that should have happened by 10 AM IST. Please ask the technician to upload it now.
        </p>
      </div>
      <Link href="/upload" className="flex-shrink-0 bg-amber-600 hover:bg-amber-500 dark:bg-amber-700 dark:hover:bg-amber-600 active:scale-[0.97] text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-all">
        Upload
      </Link>
    </div>
  );
}
