'use client';

import { useEffect, useState } from 'react';

function getISTDisplay(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timePart = now.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${datePart} — ${timePart} IST`;
}

export default function ISTClock() {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    setDisplay(getISTDisplay());
    const id = setInterval(() => setDisplay(getISTDisplay()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!display) return null;

  return (
    <span className="hidden sm:block font-mono text-xs text-slate-500 tabular-nums select-none">
      {display}
    </span>
  );
}
