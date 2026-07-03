import Link from 'next/link';
import { formatLitresFull } from '@/lib/utils';
import { formatMediumDate } from '@/lib/utils';

interface Props {
  inputTotal: number | null;
  towerUsage: number | null;
  diff: number | null;
  sheetDate: string;
}

// ±10 kL — same TOLERANCE used by the history page's summary_misread flag
// (src/components/history/flagging.ts). Kept in sync deliberately.
const TOLERANCE = 10_000;

export default function SummaryRow({ inputTotal, towerUsage, diff, sheetDate }: Props) {
  // audit P0-2: never trust the extracted `diff` verbatim — it's an OCR field
  // like any other and can misread. Cross-check it against the two numbers
  // displayed right next to it and recompute if they disagree.
  const computedDiff = inputTotal != null && towerUsage != null ? inputTotal - towerUsage : null;
  const mismatch =
    diff != null && computedDiff != null && Math.abs(diff - computedDiff) > TOLERANCE;

  const displayedDiff = mismatch ? computedDiff : diff;
  // Never render a green positive balance when Out > In, regardless of which
  // value (extracted or computed) is being shown.
  const isDeficit = displayedDiff != null && displayedDiff < 0;
  const diffIsLarge = displayedDiff != null && Math.abs(displayedDiff) > 2000;
  const diffIsBad = isDeficit || diffIsLarge;

  // Hero band (audit M3) — these are the master governance numbers for the whole
  // complex, previously rendered at the same text-sm weight as secondary details.
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <p className="section-label mb-3">
        Community water balance — {formatMediumDate(sheetDate)}
      </p>
      <div className="grid grid-cols-3 gap-1.5 xs:gap-3 text-center">
        <div className="min-w-0">
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">Input</p>
          {/* text-2xl was fixed-size and overflowed narrow mobile columns (3-up grid
              leaves ~100px per column) — now scales down on small screens and back
              up from the xs breakpoint. */}
          <p className="text-slate-900 dark:text-white font-bold text-base xs:text-xl sm:text-2xl leading-tight tracking-tight break-words">{formatLitresFull(inputTotal)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">Tower Usage</p>
          <p className="text-slate-900 dark:text-white font-bold text-base xs:text-xl sm:text-2xl leading-tight tracking-tight break-words">{formatLitresFull(towerUsage)}</p>
        </div>
        <div className="min-w-0">
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">Diff</p>
          <p className={`font-bold text-base xs:text-xl sm:text-2xl leading-tight tracking-tight break-words ${diffIsBad ? 'text-red-500 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {displayedDiff == null ? '—' : `${displayedDiff > 0 ? '+' : ''}${formatLitresFull(displayedDiff)}`}
          </p>
          {diffIsLarge && !mismatch && (
            <p className="text-red-500 dark:text-red-400 text-[11px] font-semibold mt-0.5">⚠ above tolerance</p>
          )}
          {mismatch && (
            <Link
              href="/history"
              className="block text-red-500 dark:text-red-400 text-[11px] font-semibold mt-0.5 underline decoration-dotted"
            >
              ⚠ doesn&apos;t match sheet — sheet says {diff! > 0 ? '+' : ''}{formatLitresFull(diff)}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
