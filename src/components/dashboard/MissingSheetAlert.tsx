'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Props {
  hasSheet: boolean;
}

export default function MissingSheetAlert({ hasSheet }: Props) {
  const [isPastTen, setIsPastTen] = useState(false);

  useEffect(() => {
    setIsPastTen(new Date().getHours() >= 10);
  }, []);

  if (hasSheet || !isPastTen) return null;

  return (
    <div className="bg-amber-950/50 border border-amber-700/60 rounded-xl p-4 flex items-start gap-3">
      <span className="text-xl flex-shrink-0">⚠</span>
      <div className="flex-1 min-w-0">
        <p className="text-amber-400 font-semibold text-sm">No sheet uploaded today</p>
        <p className="text-amber-300/70 text-xs mt-0.5">
          The daily sheet should have been uploaded by 10 AM. Please ask the technician to upload now.
        </p>
      </div>
      <Link
        href="/upload"
        className="flex-shrink-0 bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
      >
        Upload
      </Link>
    </div>
  );
}
