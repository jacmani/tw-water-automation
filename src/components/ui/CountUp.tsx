'use client';

import { useEffect, useRef, useState } from 'react';

// Animated number for the "confident & snappy" micro-interaction pass —
// dashboard tower totals and the upload success screen both want numbers to
// visibly arrive rather than just appear, without feeling gimmicky. Counts
// up once on mount using requestAnimationFrame (not an interval, so it stays
// smooth) with an ease-out curve; respects prefers-reduced-motion by jumping
// straight to the final value.
export default function CountUp({
  value,
  format,
  durationMs = 700,
  className,
}: {
  value: number | null | undefined;
  format: (n: number) => string;
  durationMs?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (value == null) { setDisplay(null); return; }
    const target: number = value;

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) { setDisplay(target); return; }

    const start = performance.now();
    const from = 0;
    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out-cubic — snappy, no overshoot
      setDisplay(from + (target - from) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (value == null) return null;
  return <span className={className}>{format(display ?? 0)}</span>;
}
