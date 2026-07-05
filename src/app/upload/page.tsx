'use client';

import { useState, useRef, useEffect, useId, ChangeEvent, FormEvent } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Image from 'next/image';
import imageCompression from 'browser-image-compression';
import { toPng } from 'html-to-image';
import type { ExtractionResult } from '@/types';
import { formatDate, formatMediumDate } from '@/lib/utils';
import TemplateOverall from '@/components/infographics/TemplateOverall';
import type { TemplateOverallProps } from '@/components/infographics/TemplateOverall';
import CountUp from '@/components/ui/CountUp';

// ── Icons (P2-7) ─────────────────────────────────────────────────────────────
// Replaces the last remaining OS-rendered emoji glyphs in the upload flow
// (📷 📅 ⏳ ✅ ⚠️ ❌ 🔍) with the same outline SVG style already used in
// Navbar.tsx — consistent weight/color across OS and browsers, and it can
// inherit `currentColor` so it follows dark/light theming automatically.
function CameraIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 8a2 2 0 0 1 2-2h1.2l1-1.5h7.6l1 1.5H18a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
function CalendarWarnIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M12 14v2.5" />
      <circle cx="12" cy="19" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconInfo(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}
function IconWarnTriangle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10.6 3.9 2.2 18.5A1.5 1.5 0 0 0 3.5 21h17a1.5 1.5 0 0 0 1.3-2.5L13.4 3.9a1.5 1.5 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4.2" /><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconErrorX(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  );
}
function IconSearch(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

function LevelIcon({ level, className }: { level: LogLevel; className?: string }) {
  switch (level) {
    case 'success': return <IconCheck className={className} />;
    case 'warn':    return <IconWarnTriangle className={className} />;
    case 'error':   return <IconErrorX className={className} />;
    case 'engine':  return <IconSearch className={className} />;
    default:        return <IconInfo className={className} />;
  }
}

// ── Live processing log types ────────────────────────────────────────────────
type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'engine';

interface LogEntry {
  id: number;
  level: LogLevel;
  message: string;
  detail?: string;
  elapsed?: number; // ms
}

// ── ProcessingLog component ──────────────────────────────────────────────────
// P2-8: the raw engine log ("Qwen3-VL-8B ✓ (free, 640ms)", "Agreement gate
// FAILED — 1 tower disagreement(s)") is genuinely useful for debugging but
// reads like an API trace, not something a technician glances at each
// morning. friendlyLogMessage() maps recognizable message shapes to a plain-
// language headline; anything it doesn't recognize just falls through
// unchanged, so nothing is ever hidden or lost — the full technical message
// is still shown underneath in the existing muted `detail` line.
const FRIENDLY_RULES: { test: RegExp; to: (m: string) => string }[] = [
  { test: /^Uploading image to storage/, to: () => 'Saving your photo…' },
  { test: /^Image stored/, to: () => 'Photo saved' },
  { test: /^Phase 1 — running \d+ free engines in parallel/, to: () => 'Reading your sheet with several AI checks at once…' },
  { test: /^Qwen3-VL-8B ✓/, to: () => 'First AI check — done' },
  { test: /^Qwen3-VL-8B — no result/, to: () => 'First AI check skipped' },
  { test: /^Mistral OCR 3 ✓/, to: () => 'Handwriting reader — done' },
  { test: /^Mistral OCR 3 — no result/, to: () => 'Handwriting reader skipped' },
  { test: /^Google Vision ✓/, to: () => 'Double-checking the numbers — done' },
  { test: /^Google Vision — no text/, to: () => 'Number double-check skipped' },
  { test: /^OCR\.space Engine 2 ✓/, to: () => 'Extra number check — done' },
  { test: /^OCR\.space — no text/, to: () => 'Extra number check skipped' },
  { test: /^Phase 2 — primary extraction/, to: () => 'Reading every number on the sheet…' },
  { test: /^Agreement gate — cross-checking/, to: () => 'Cross-checking the numbers between AI engines…' },
  { test: /^Agreement gate PASSED/, to: () => 'Numbers agree — looking good' },
  { test: /^Agreement gate FAILED/, to: (m) => `Found something worth double-checking${m.includes('—') ? ':' + m.split('—')[1] : ''}` },
  { test: /^Free tie-breaker/, to: () => 'Getting a second opinion (still free)…' },
  { test: /^OpenRouter ✓/, to: () => 'Second opinion — done' },
  { test: /^OpenRouter tie-breaker unavailable/, to: () => 'Second opinion unavailable' },
  { test: /^Tie-breaker resolved/, to: (m) => m.replace(/^Tie-breaker/, 'Second opinion') },
  { test: /^Resolved entirely by free engines/, to: () => 'All clear — no extra cost needed' },
  { test: /^Escalating to Claude Haiku/, to: () => 'Asking a more careful AI to take a closer look (small cost)…' },
  { test: /^Claude Haiku ✓/, to: () => 'Careful re-check — done' },
  { test: /^Final tower totals/, to: () => 'Tower totals calculated' },
  { test: /^Date read:/, to: (m) => m.replace(/^Date read:/, 'Date found:') },
  { test: /^Date implausible/, to: () => 'That date looks unlikely — please confirm it below' },
  { test: /^Cross-validation ✓/, to: () => 'Numbers double-checked against the sheet — all consistent' },
  { test: /^Low OCR corroboration/, to: () => 'A few numbers could not be fully double-checked' },
  { test: /^Date mismatch between engines/, to: () => 'The AI engines read the date differently — please confirm it below' },
  { test: /^─── Scan cost breakdown ───/, to: () => 'Cost for this scan' },
  { test: /^💰 Total this scan/, to: (m) => m.replace('💰 ', '') },
  { test: /^✓ Done in/, to: (m) => m.replace('✓ Done in', 'All done in') },
  { test: /^Preparing result/, to: () => 'Almost there…' },
];

function friendlyLogMessage(message: string): string {
  for (const rule of FRIENDLY_RULES) {
    if (rule.test.test(message)) return rule.to(message);
  }
  return message;
}

const LEVEL_MSG_COLOR: Record<LogLevel, string> = {
  info:    'text-blue-600 dark:text-blue-300',
  success: 'text-emerald-700 dark:text-emerald-400',
  warn:    'text-amber-700 dark:text-yellow-400',
  error:   'text-red-600 dark:text-red-400',
  engine:  'text-violet-700 dark:text-violet-300',
};
const LEVEL_DETAIL_COLOR: Record<LogLevel, string> = {
  info:    'text-slate-500 dark:text-slate-400',
  success: 'text-slate-500 dark:text-slate-400',
  warn:    'text-amber-700 dark:text-yellow-500',
  error:   'text-red-600 dark:text-red-400',
  engine:  'text-slate-500 dark:text-slate-400',
};

// `live` = still streaming (auto-scrolls, pulsing dot, always open).
// When not live (after extraction finishes) the log PERSISTS as a collapsible
// "Processing details" panel so the cost summary and full engine trace remain
// visible on the confirm/success screens instead of vanishing the instant the
// pipeline completes.
function ProcessingLog({ entries, live = true }: { entries: LogEntry[]; live?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, live]);

  if (entries.length === 0) return null;

  // Pull the cost summary line out so we can always surface it in the header,
  // even when the detail is collapsed.
  const costLine = [...entries].reverse().find(e => e.message.includes('Total this scan'));

  return (
    <div className="mt-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => !live && setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 text-left"
      >
        <span className={`w-2 h-2 rounded-full ${live ? 'bg-blue-400 animate-pulse' : 'bg-slate-400 dark:bg-slate-500'}`} />
        <span className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider">
          {live ? 'Live Processing Log' : 'Processing details'}
        </span>
        {/* Always-visible cost chip once the scan is done */}
        {!live && costLine && (
          <span className="ml-2 text-emerald-600 dark:text-emerald-400 text-xs font-medium normal-case tracking-normal">
            {costLine.message.replace(/^💰\s*Total this scan:\s*/, '💰 ')}
          </span>
        )}
        {!live && <span className="ml-auto text-slate-500 dark:text-slate-500 text-xs">{open ? '▾ hide' : '▸ show'}</span>}
      </button>
      {open && (
        <div className="px-4 py-3 space-y-2 text-xs max-h-96 overflow-y-auto scrollbar-thin">
          {entries.map((e) => {
            const friendly = friendlyLogMessage(e.message);
            const wasTranslated = friendly !== e.message;
            return (
            <div key={e.id} className="flex items-start gap-2 animate-[fadeInUp_0.2s_ease-out_both]">
              <LevelIcon level={e.level} className={`flex-shrink-0 w-3.5 h-3.5 mt-0.5 ${LEVEL_MSG_COLOR[e.level]}`} />
              <span className="flex-1 leading-snug">
                <span className={`font-medium ${LEVEL_MSG_COLOR[e.level]}`}>{friendly}</span>
                {e.detail && (
                  <span className={`ml-2 ${LEVEL_DETAIL_COLOR[e.level]}`}>— {e.detail}</span>
                )}
                {wasTranslated && (
                  <span className="block font-mono text-[10px] text-slate-400 dark:text-slate-600 mt-0.5">{e.message}</span>
                )}
              </span>
              {e.elapsed != null && (
                <span className="flex-shrink-0 text-slate-300 dark:text-slate-700 tabular-nums font-mono">{(e.elapsed / 1000).toFixed(1)}s</span>
              )}
            </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

type Status =
  | 'idle'
  | 'compressing'
  | 'extracting'
  | 'confirming'           // AI read date confidently — show date for user to confirm
  | 'date_picker'          // AI couldn't read date — show manual date entry form
  | 'saving'
  | 'success'
  | 'error_other';

interface ConfirmPayload {
  image_url: string;
  extracted_date: string | null;  // null when AI couldn't read it
  date_confidence: number;
  date_unclear: boolean;
  extraction: ExtractionResult;
  date_was_manual?: boolean;       // true if the technician picked the date by hand
  pipeline_metrics?: object;       // OCR pipeline telemetry — stored in DB for trend analysis
}

interface SaveResult {
  success: boolean;
  sheet_id?: string;
  date?: string;
  confidence?: number;
  flagged_fields?: string[];
  error?: string;
  community_total?: number;
  tower_spikes?: { tower: string; overagePct: number }[];
}

// ── Progress bar ────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'compressing', label: 'Compressing image' },
  { id: 'extracting',  label: 'AI reading sheet' },
  { id: 'saving',      label: 'Saving data' },
] as const;

function getStepIndex(status: Status): number {
  if (status === 'compressing') return 0;
  if (status === 'extracting')  return 1;
  if (status === 'saving')      return 2;
  return -1;
}

function useExtractingProgress(active: boolean) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!active) { setPct(0); return; }
    setPct(5);
    const t1 = setTimeout(() => setPct(15), 400);
    let cur = 15;
    const t2 = setInterval(() => {
      cur = Math.min(82, cur + 1);
      setPct(cur);
      if (cur >= 82) clearInterval(t2);
    }, 600);
    return () => { clearTimeout(t1); clearInterval(t2); };
  }, [active]);
  return pct;
}

function ProgressDisplay({ status, preview }: { status: Status; preview: string | null }) {
  const stepIdx = getStepIndex(status);
  const extractingProgress = useExtractingProgress(status === 'extracting');
  let overallPct = 0;
  if (stepIdx === 0) overallPct = 8;
  if (stepIdx === 1) overallPct = 33 + (extractingProgress / 100) * 34;
  if (stepIdx === 2) overallPct = 90;

  return (
    <div className="space-y-6">
      {preview && (
        <div className="rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 relative">
          <Image src={preview} alt="Sheet being processed" width={400} height={240}
            className="w-full object-contain max-h-52 opacity-60" unoptimized />
          {status === 'extracting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              {/* Always-dark scrim regardless of site theme — it sits on top of an
                  arbitrary photo, not page chrome, and needs guaranteed contrast
                  against whatever colors are in that photo. */}
              <div className="bg-slate-900/85 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3 max-w-xs">
                <span className="w-5 h-5 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
                <span className="text-blue-300 text-sm font-medium leading-snug">
                  OCR + AI engines reading sheet…
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="flex justify-between text-xs mb-1 px-0.5">
        {STEPS.map((s, i) => (
          <span key={s.id} className={
            i < stepIdx ? 'text-emerald-600 dark:text-emerald-400 font-medium'
            : i === stepIdx ? 'text-blue-600 dark:text-blue-300 font-semibold'
            : 'text-slate-500 dark:text-slate-400'
          }>{i < stepIdx ? '✓ ' : ''}{s.label}</span>
        ))}
      </div>
      <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${overallPct}%` }} />
      </div>
      <p className="text-center text-slate-500 dark:text-slate-400 text-sm">
        {status === 'compressing' && 'Preparing your photo…'}
        {status === 'extracting' && 'This takes 15–30 seconds. Please wait.'}
        {status === 'saving' && 'Writing to database…'}
      </p>
      <div className="flex justify-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className={`w-2 h-2 rounded-full transition-all duration-300 ${
            i < stepIdx ? 'bg-emerald-400' : i === stepIdx ? 'bg-blue-400 scale-125' : 'bg-slate-300 dark:bg-slate-700'
          }`} />
        ))}
      </div>
    </div>
  );
}

// ── Flag parsing ─────────────────────────────────────────────────────────────
// Section bands as % of image height. Calibrated to the Trinity World sheet.
// The sheet has these sections top-to-bottom:
//   Title + date header:    0  – 6%
//   Tower meter readings:   6  – 30%
//   Input source readings:  30 – 52%
//   Car Wash / Pool:        52 – 64%
//   Water level readings:   64 – 78%
//   Party hall / utility:   78 – 88%
//   Total Inflow summary:   88 – 100%

// Severity drives the UX: 'review' = needs the technician's eyes (expanded, red/amber);
// 'fixed' = the pipeline already auto-corrected it (collapsed, informational, green).
type FlagSeverity = 'review' | 'fixed';

interface FlagInfo {
  sectionY: number;   // % from top — start of highlight band
  sectionH: number;   // % height of band
  sectionName: string;
  rowHint: string;    // which row/cell within the section
  problem: string;    // plain-English problem
  color: string;      // hex
  severity: FlagSeverity;
  rowKey: string;     // for de-duplication (section + row)
}

const COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#3B82F6','#A855F7','#EC4899'];

// Classify a raw flag as already-handled vs needs-review.
function classifySeverity(raw: string): FlagSeverity {
  const r = raw.toLowerCase();
  // Auto-handled by the pipeline → informational only.
  if (r.includes('auto-corrected') || r.includes('auto_corrected') ||
      r.includes('final_clamp') && !r.includes('nulled') ||
      r.includes('tie-broken') || r.includes('tie_broken')) {
    return 'fixed';
  }
  // Everything else (nulled values, low confidence, "double-check", missing data) → review.
  return 'review';
}

// Adds severity + a dedup key on top of the section classification.
function parseFlag(raw: string, idx: number): FlagInfo {
  const base = parseFlagCore(raw, idx);
  return {
    ...base,
    severity: classifySeverity(raw),
    rowKey: `${base.sectionName}|${base.rowHint}`,
  };
}

function parseFlagCore(raw: string, idx: number): Omit<FlagInfo, 'severity' | 'rowKey'> {
  const lower = raw.toLowerCase();
  const color = COLORS[idx % COLORS.length];

  // ── Water sources / wells & tankers (2nd METER READING table) ─────
  // MUST come before the tower check: water-source flag strings contain tower names
  // in their location (e.g. "water_source_Mercury + Venus Tanker_total") and would
  // otherwise be misclassified as Tower Meter Readings by the broader regex below.
  if (lower.match(/water_source|well|tanker|kingsley/)) {
    // Row labels exactly as printed on the sheet's 2nd METER READING table.
    const srcLabels: Record<string, string> = {
      'v well 4': 'VENUS SIDE WELL 4 row',
      'b1+b2': 'VENUS SIDE WELL 4 row',
      'v well 1': 'VENUS SIDE WELL 1 2 3 row',
      'n well 5': 'NEPTUNE SIDE WELL 5 row',
      'n well 6': 'NEPTUNE SIDE WELL 6 row',
      'open well': 'OPEN WELL row',
      'on outside': 'OPEN WELL row',
      'mtr': 'MERCURY + VENUS TANKER row',
      'jtr': 'JUPITER + NEPTUNE TANKER row',
    };
    let rowHint = 'Wells & Tankers table (2nd METER READING table)';
    for (const [k, v] of Object.entries(srcLabels)) {
      if (lower.includes(k)) { rowHint = v; break; }
    }
    return { sectionY: 30, sectionH: 22, sectionName: 'Wells & Tankers (METER READING)', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Summary / Total Inflow (bottom of sheet) ─────────────────────
  // MUST come before the tower check: "summary_tower_usage" contains "tower" and
  // would be misclassified as a Tower Meter Reading without this ordering.
  if (lower.match(/summary|input_total|tower_usage|v_side|n_side|jtr_tanker|mtr_tanker|inflow|balance/)) {
    const fieldNames: Record<string, string> = {
      v_side: '"WELL" column',
      n_side: '"WELL" column',
      jtr_tanker: '"TANKER" column',
      mtr_tanker: '"TANKER" column',
      input_total: '"TOTAL COLLECTION" column',
      tower_usage: '"TOTAL USAGE" column',
      diff: '"BALANCE" column',
    };
    let rowHint = 'TOTAL INFLOW table (bottom of sheet)';
    for (const [k, v] of Object.entries(fieldNames)) {
      if (lower.includes(k)) { rowHint = v; break; }
    }
    return { sectionY: 88, sectionH: 12, sectionName: 'TOTAL INFLOW (bottom of sheet)', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Tower readings (section 1) ────────────────────────────────────
  // Matches both spaced ("Venus DO") and underscore ("Venus_DO", "tower_Venus_DO_total_ltrs") forms.
  if (lower.match(/tower|venus[ _]d[or]|mercury[ _]d[or]|neptune[ _]d[or]|jupiter[ _]d[or]|venus|mercury|neptune|jupiter/)) {
    const typeGloss: Record<string, string> = { do: 'Domestic / Overhead', dr: 'Drinking water' };
    const tm = lower.match(/(venus|mercury|neptune|jupiter)/);
    const dm = lower.match(/[ _](do|dr)[ _]/) ?? lower.match(/\b(do|dr)\b/);
    const rowHint = tm && dm
      ? `${tm[1].toUpperCase()} ${dm[1].toUpperCase()} row (${typeGloss[dm[1]]})`
      : tm ? `${tm[1].toUpperCase()} tower rows` : 'Tower Meter Reading table (top of sheet)';
    return { sectionY: 6, sectionH: 24, sectionName: 'Tower Meter Readings', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Car Wash / Swimming Pool ──────────────────────────────────────
  if (lower.match(/amenit|car wash|swimming pool|pool|party hall/)) {
    const isPool = lower.includes('swimming pool') || lower.includes('pool');
    const isParty = lower.includes('party hall');
    const locM = lower.match(/(jupiter|mercury|venus|neptune|meter[ -]?[1-7])/);
    const loc = locM ? locM[1].toUpperCase().replace('METER', 'METER-').replace('--', '-') : '';
    const rowHint = locM
      ? `${isPool ? 'SWIMMING POOL' : isParty ? 'P HALL' : 'CAR WASH'} — ${loc} column`
      : isPool ? 'SWIMMING POOL section' : isParty ? 'P HALL section' : 'CAR WASH section';
    return { sectionY: 52, sectionH: 12, sectionName: 'Car Wash / Swimming Pool', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Water level in percentage ─────────────────────────────────────
  if (lower.match(/water_level|tank level|jdo|jdr|mdo|mdr|collection tank|fire tank/)) {
    const slotM = lower.match(/(6am|12pm|6pm|12am|06:00|12:00|18:00|00:00)/);
    const slotNames: Record<string, string> = {
      '6am': '06.00 AM', '06:00': '06.00 AM', '12pm': '12.00 PM', '12:00': '12.00 PM',
      '6pm': '06.00 PM', '18:00': '06.00 PM', '12am': '12.00 AM', '00:00': '12.00 AM',
    };
    const rowHint = slotM ? `${slotNames[slotM[1]] ?? slotM[1]} row` : 'WATER LEVEL IN PERCENTAGE table';
    return { sectionY: 64, sectionH: 14, sectionName: 'Water Level in Percentage', rowHint, problem: cleanProblem(raw), color };
  }

  // Fallback
  return { sectionY: 0, sectionH: 100, sectionName: 'Unknown section', rowHint: 'See raw note below', problem: cleanProblem(raw), color };
}

function cleanProblem(raw: string): string {
  // Extract the part after the last colon
  const parts = raw.split(':');
  const detail = parts.slice(1).join(':').trim();
  if (!detail) return 'Please verify this value against the original sheet.';

  let msg = detail
    // ── v3.0 auto-correction / clamp markers → plain English ──
    .replace(/final_clamp\s*(?:nulled|→\s*null)/gi, 'The reading was impossible and could not be auto-fixed — please enter it manually')
    .replace(/final_clamp\s*→?\s*([\d,]+)\s*\(via [^)]*\)/gi, 'The original reading was impossible; we corrected it to $1 — please verify against the sheet')
    .replace(/nulled[^.]*needs manual entry[^)]*\)?/gi, 'Could not read this value — please enter it manually')
    .replace(/auto-corrected to ([\d,]+)\s*\(via [^)]*\)/gi, 'Auto-corrected to $1 — please verify against the sheet')
    .replace(/auto-corrected from \w+[^)]*\)/gi, 'Auto-corrected from a cross-check column — please verify')
    .replace(/auto_corrected_from_vol_today/gi, 'Auto-corrected using the volume-today column — please verify')
    .replace(/qwen_disagreement\([^)]*\)/gi, 'Two AI engines read this differently — please double-check')
    .replace(/sanity_violation/gi, 'Value was outside the expected range')
    .replace(/low_confidence/gi, 'The AI was not confident about this reading')
    .replace(/\bvia meter_delta[^)]*\)?/gi, '')
    .replace(/\bvia vol_today\)?/gi, '')
    .replace(/\bvia divided_by_10[^)]*\)?/gi, '')
    // ── legacy v2.0 markers ──
    .replace(/out_of_range[^)]*\)/gi, 'Number looks unusual — please double-check')
    .replace(/out_of_range/gi, 'Number looks unusual — please double-check')
    .replace(/blank\/unreadable/gi, 'Value is blank or could not be read from the photo')
    .replace(/only yesterday reading visible/gi, "Only yesterday's reading is visible; today's cell appears empty")
    .replace(/not present on sheet/gi, 'This row does not appear on this version of the sheet')
    .replace(/reading uncertain/gi, 'Handwriting is unclear — please check the original')
    .replace(/consumption noted as (\S+)\s*reading uncertain/gi, 'Consumption of $1 is hard to read — please verify')
    .replace(/\(value:?\s*[\d,]+\)/gi, '')
    .replace(/[_|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // If after cleaning we're left with a bare field token, give a generic message.
  if (!msg || /^[a-z_]+$/i.test(msg)) msg = 'Please verify this value against the original sheet.';
  return msg;
}

// ── Annotated canvas — draws section highlight bands ───────────────────────
function AnnotatedCanvas({ imageUrl, flags }: { imageUrl: string; flags: FlagInfo[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const W = canvas.width;
      const H = canvas.height;
      const badgeR = Math.max(20, W * 0.028);
      const fontSize = Math.max(16, W * 0.022);

      // Group flags by section so badges in the same band don't overlap
      // Build a map: sectionKey → list of indices in that section
      const sectionGroups: Map<string, number[]> = new Map();
      flags.forEach(({ sectionY, sectionH }, i) => {
        const key = `${sectionY}-${sectionH}`;
        if (!sectionGroups.has(key)) sectionGroups.set(key, []);
        sectionGroups.get(key)!.push(i);
      });

      // Badge params — keep well inside the canvas
      // Place badges on RIGHT side to avoid left-edge clipping
      const accentW = W * 0.01;  // thin left accent bar
      const badgeDiameter = badgeR * 2;

      flags.forEach(({ sectionY, sectionH, color }, i) => {
        const y = (sectionY / 100) * H;
        const h = (sectionH / 100) * H;

        ctx.save();

        // Filled band (clip to canvas bounds)
        ctx.fillStyle = color + '22';
        ctx.fillRect(0, y, W, h);

        // Thin left accent bar
        ctx.fillStyle = color;
        ctx.fillRect(0, y, accentW, h);

        // Top + bottom border lines
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, H * 0.002);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.moveTo(0, y + h); ctx.lineTo(W, y + h);
        ctx.stroke();

        // Badge position: right side, staggered vertically within band
        // to avoid overlap when multiple flags share the same section
        const key = `${sectionY}-${sectionH}`;
        const siblings = sectionGroups.get(key)!;
        const posInGroup = siblings.indexOf(i);
        const totalInGroup = siblings.length;

        // Distribute badges vertically within the band
        const margin = badgeR + 4;
        const usableH = h - margin * 2;
        const step = totalInGroup > 1 ? usableH / (totalInGroup - 1) : 0;
        const by = totalInGroup === 1
          ? y + h / 2
          : y + margin + posInGroup * step;

        // X: right side, safely inside canvas
        const bx = W - badgeR - accentW - 4;

        // Badge circle
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fill();

        // White border
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2, W * 0.003);
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.stroke();

        // Number
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), bx, by);

        ctx.restore();

        // Suppress unused variable warning
        void badgeDiameter;
      });

      setReady(true);
    };
    img.src = imageUrl;
  }, [imageUrl, flags]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
      <canvas ref={canvasRef} className="w-full" style={{ display: ready ? 'block' : 'none' }} />
      {!ready && (
        <div className="h-48 flex items-center justify-center text-slate-500 dark:text-slate-500 text-sm animate-pulse">
          Loading sheet image…
        </div>
      )}
    </div>
  );
}

// ── Flagged panel ───────────────────────────────────────────────────────────
// Internal pipeline diagnostics — never shown to the committee. These are engine
// provenance / escalation markers, useful in logs and the DB but not user-facing.
const INTERNAL_FLAG_PREFIXES = [
  'primary_engine:',
  'escalation_engine:',
  'escalation_reason:',
  'opus_reason:',          // legacy
  'resolved_by:',
  'warning:',
  'date_implausible:',     // already surfaced via the date-confirmation banner, not a sheet-section flag
];
function isInternalFlag(raw: string): boolean {
  const r = raw.trim().toLowerCase();
  if (INTERNAL_FLAG_PREFIXES.some(p => r.startsWith(p))) return true;
  // Bare engine-name markers like "haiku" / "gemini" that carry no user meaning.
  if (/^(haiku|gemini|opus|qwen)\b/.test(r) && !r.includes('total') && !r.includes('reading')) return true;
  return false;
}

// De-duplicate flags by row, keeping the most severe ('review' beats 'fixed') and
// merging their problem text. One card per affected row, not one per raw flag.
function dedupeFlags(flags: FlagInfo[]): FlagInfo[] {
  const byRow = new Map<string, FlagInfo>();
  for (const f of flags) {
    const existing = byRow.get(f.rowKey);
    if (!existing) { byRow.set(f.rowKey, f); continue; }
    // Prefer the review-severity version; merge distinct problem text.
    const keep = existing.severity === 'review' ? existing : f;
    const other = existing.severity === 'review' ? f : existing;
    const merged = other.problem && !keep.problem.includes(other.problem)
      ? `${keep.problem} ${other.problem}` : keep.problem;
    byRow.set(f.rowKey, { ...keep, problem: merged, severity: 'review' === existing.severity || 'review' === f.severity ? 'review' : 'fixed' });
  }
  return [...byRow.values()];
}

function FlagCard({ flag, index }: { flag: FlagInfo; index: number }) {
  const { sectionName, rowHint, problem, color, severity } = flag;
  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: color + '60' }}>
      <div className="flex items-center gap-3 px-4 py-2.5" style={{ backgroundColor: color + '22' }}>
        <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ backgroundColor: color }}>{index}</span>
        <span className="text-slate-900 dark:text-white font-semibold text-sm">{sectionName}</span>
        {severity === 'fixed' && (
          <span className="ml-auto text-emerald-700 dark:text-emerald-400 text-xs font-medium">✓ auto-fixed</span>
        )}
      </div>
      <div className="bg-white dark:bg-slate-900 px-4 py-3 space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-slate-500 dark:text-slate-500 text-xs mt-0.5 flex-shrink-0">📍 Row</span>
          <span className="text-slate-700 dark:text-slate-200 text-sm font-medium">{rowHint}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-slate-500 dark:text-slate-500 text-xs mt-0.5 flex-shrink-0">{severity === 'fixed' ? 'ℹ️ Note' : '⚠️ Check'}</span>
          <span className="text-slate-600 dark:text-slate-300 text-sm leading-snug">{problem}</span>
        </div>
      </div>
    </div>
  );
}

function FlaggedPanel({ flaggedFields, imageUrl }: { flaggedFields: string[]; imageUrl: string | null }) {
  const [showFixed, setShowFixed] = useState(false);
  if (!flaggedFields.length) return null;

  // Drop internal diagnostics, classify, then de-duplicate to one card per row.
  const userFlags = Array.from(new Set(flaggedFields.filter(f => !isInternalFlag(f))));
  if (!userFlags.length) return null;

  const allFlags = dedupeFlags(userFlags.map((f, i) => parseFlag(f, i)));
  const reviewFlags = allFlags.filter(f => f.severity === 'review');
  const fixedFlags = allFlags.filter(f => f.severity === 'fixed');

  // Reassuring summary tone (per UX audit: technician needs reassurance, not a wall of warnings).
  const nReview = reviewFlags.length;
  const nFixed = fixedFlags.length;

  return (
    <div className="space-y-4">
      {/* Calm, reassuring summary header */}
      <div className={`rounded-xl p-4 border ${nReview > 0 ? 'bg-amber-50 dark:bg-amber-900/15 border-amber-300 dark:border-amber-700/40' : 'bg-emerald-50 dark:bg-emerald-900/15 border-emerald-300 dark:border-emerald-700/40'}`}>
        <p className={`font-semibold text-sm mb-1 ${nReview > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {nReview > 0
            ? `Saved — ${nReview} reading${nReview > 1 ? 's' : ''} to double-check`
            : '✓ Saved — everything looks good'}
        </p>
        <p className="text-slate-500 dark:text-slate-400 text-xs">
          {nFixed > 0 && `We auto-corrected ${nFixed} unclear value${nFixed > 1 ? 's' : ''}. `}
          {nReview > 0
            ? 'Please glance at the highlighted rows below against your sheet — the data is saved either way.'
            : 'The sheet is processed and saved.'}
        </p>
      </div>

      {/* Annotated image — only the rows that actually need review */}
      {imageUrl && (reviewFlags.length > 0 || fixedFlags.length > 0) &&
        <AnnotatedCanvas imageUrl={imageUrl} flags={[...reviewFlags, ...fixedFlags]} />}

      {/* Needs-review cards — expanded */}
      {reviewFlags.length > 0 && (
        <div className="space-y-3">
          {reviewFlags.map((flag, i) => <FlagCard key={flag.rowKey} flag={flag} index={i + 1} />)}
        </div>
      )}

      {/* Auto-fixed cards — collapsed by default */}
      {fixedFlags.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowFixed(v => !v)}
            className="w-full text-left text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 flex items-center gap-2 px-1"
          >
            <span>{showFixed ? '▾' : '▸'}</span>
            <span>{nFixed} reading{nFixed > 1 ? 's' : ''} we auto-corrected (tap to {showFixed ? 'hide' : 'review'})</span>
          </button>
          {showFixed && fixedFlags.map((flag, i) =>
            <FlagCard key={flag.rowKey} flag={flag} index={reviewFlags.length + i + 1} />)}
        </div>
      )}
    </div>
  );
}

// ── Date picker screen ───────────────────────────────────────────────────────
// Shown when AI can't read the date from the sheet with high confidence.
interface DatePickerScreenProps {
  imageUrl: string | null;
  aiGuess: string | null;          // ISO date e.g. "2026-06-24", or null
  onConfirm: (date: string) => void;
  onRetake: () => void;
}

function DatePickerScreen({ imageUrl, aiGuess, onConfirm, onRetake }: DatePickerScreenProps) {
  const dateInputId = useId();
  // Default to today in IST (UTC+5:30) or the AI guess if available
  const todayIST = () => {
    const now = new Date();
    // Offset to IST
    const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    return ist.toISOString().slice(0, 10);
  };

  const [selectedDate, setSelectedDate] = useState<string>(todayIST());
  const [error, setError] = useState<string>('');

  function handleConfirm() {
    if (!selectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      setError('Please choose a valid date.');
      return;
    }
    onConfirm(selectedDate);
  }

  return (
    <div className="space-y-5">
      {/* Warning banner */}
      <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-600/60 rounded-xl p-4">
        <div className="flex gap-3 items-start">
          <CalendarWarnIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <div>
            <p className="text-amber-700 dark:text-amber-300 font-semibold text-sm">Couldn&apos;t read the date automatically</p>
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-1 leading-relaxed">
              The AI couldn&apos;t read the date from this sheet with enough confidence. Please enter the correct date
              — this is the only field you need to provide.{aiGuess ? ' The AI\'s best guess is pre-filled below.' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Sheet thumbnail */}
      {imageUrl && (
        <div className="rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
          <Image src={imageUrl} alt="Sheet preview" width={400} height={200}
            className="w-full object-contain max-h-48" unoptimized />
        </div>
      )}

      {/* Date input */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
        <div>
          <label htmlFor={dateInputId} className="block text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Sheet Date
          </label>
          <input
            id={dateInputId}
            type="date"
            value={selectedDate}
            max={todayIST()}
            onChange={(e) => { setSelectedDate(e.target.value); setError(''); }}
            className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-slate-900 dark:text-white text-lg font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {error && <p className="text-red-600 dark:text-red-400 text-xs mt-1.5">{error}</p>}
        </div>
        {aiGuess && (
          <p className="text-slate-500 dark:text-slate-500 text-xs">
            AI guessed: {formatDate(aiGuess)}{aiGuess !== selectedDate ? ' — change above if different.' : ''}
          </p>
        )}
        <div className="bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/50 rounded-lg px-3 py-2 flex gap-2 items-start">
          <span className="text-blue-600 dark:text-blue-400 text-xs flex-shrink-0 mt-0.5">ℹ️</span>
          <p className="text-blue-700 dark:text-blue-300 text-xs leading-relaxed">
            This entry will be flagged as <strong>manually dated</strong> in the history view so the committee is aware.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onRetake}
          className="flex-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white py-3 rounded-xl font-medium transition-colors"
        >
          Retake Photo
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selectedDate}
          className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white disabled:text-slate-400 py-3 rounded-xl font-semibold transition-all"
        >
          Save with This Date
        </button>
      </div>
    </div>
  );
}

// Tower DO/DR totals the AI could not read (null after the pipeline clamp) — these
// are critical accountability numbers, so we require the technician to enter them
// before saving. Returns a list like [{ tower:'Venus', type:'DO', key:'Venus_DO' }].
const TOWERS_FOR_ENTRY = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
function findMissingTowerTotals(extraction: ExtractionResult | undefined) {
  const missing: Array<{ tower: string; type: 'DO' | 'DR'; key: string }> = [];
  if (!extraction?.tower_section) return missing;
  for (const tower of TOWERS_FOR_ENTRY) {
    for (const type of ['DO', 'DR'] as const) {
      const v = extraction.tower_section[tower]?.[type]?.total_ltrs;
      if (v == null) missing.push({ tower, type, key: `${tower}_${type}` });
    }
  }
  return missing;
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [manualTotals, setManualTotals] = useState<Record<string, string>>({});
  const logIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Overall poster share state
  const [posterData, setPosterData] = useState<TemplateOverallProps | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const posterRef = useRef<HTMLDivElement>(null);
  // Pre-generated File stored here so navigator.share() can be called
  // immediately from the tap handler with no async work in the gesture window.
  const posterFileRef = useRef<File | null>(null);

  function addLog(level: LogLevel, message: string, detail?: string, elapsed?: number) {
    const id = ++logIdRef.current;
    setLogEntries(prev => [...prev, { id, level, message, detail, elapsed }]);
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setStatus('idle');
    setConfirmPayload(null);
    setSaveResult(null);
    setPreview(URL.createObjectURL(f));
  }

  function resetToIdle() {
    setFile(null);
    setPreview(null);
    setStatus('idle');
    setConfirmPayload(null);
    setSaveResult(null);
    setLogEntries([]);
    setManualTotals({});
    setPosterData(null);
    setShareState('idle');
    posterFileRef.current = null;
    logIdRef.current = 0;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function fetchPosterData(date: string) {
    setShareState('generating');
    try {
      const res = await fetch(`/api/poster-data?date=${date}`);
      if (!res.ok) throw new Error('poster-data fetch failed');
      const json = await res.json();
      setPosterData({
        date: json.date,
        towers: json.towers,
        communityTotal: json.communityTotal,
        communityYesterday: json.communityYesterday,
      });
      // State update is async; share happens after TemplateOverall renders
      // (triggered by useEffect watching posterData)
    } catch {
      setShareState('error');
    }
  }

  // Pre-generate the PNG file as soon as posterData + DOM are ready.
  // This runs outside any user gesture so it can be fully async.
  // The resulting File is cached in posterFileRef so the tap handler can
  // call navigator.share() immediately with zero async work in the gesture window.
  useEffect(() => {
    if (!posterData || shareState !== 'generating') return;
    posterFileRef.current = null;

    // Two rAF cycles let React paint the off-screen TemplateOverall first.
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled || !posterRef.current) { setShareState('error'); return; }
      try {
        const dataUrl = await toPng(posterRef.current, { pixelRatio: 2, cacheBust: true });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        if (cancelled) return;
        posterFileRef.current = new File(
          [blob],
          `tw-water-${posterData.date}.png`,
          { type: 'image/png' }
        );
        setShareState('ready');
      } catch {
        if (!cancelled) setShareState('error');
      }
    };
    run();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posterData]);

  // Called directly from the button tap — must do near-zero async work so the
  // browser's transient-activation window is not exceeded before navigator.share().
  function sharePoster() {
    const shareFile = posterFileRef.current;
    if (!shareFile || !posterData) return;

    if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
      // Direct call — no await before this point, gesture context still valid.
      navigator.share({
        files: [shareFile],
        title: `Trinity World Water — ${posterData.date}`,
      }).catch((err: unknown) => {
        // AbortError = user dismissed the sheet — not an error.
        if (!(err instanceof Error && err.name === 'AbortError')) {
          setShareState('error');
        }
      });
    } else {
      // Desktop or browser without file-share support → download the PNG.
      const url = URL.createObjectURL(shareFile);
      const link = document.createElement('a');
      link.href = url;
      link.download = shareFile.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLogEntries([]);
    logIdRef.current = 0;
    setStatus('compressing');
    let imageToUpload = file;
    try {
      imageToUpload = await imageCompression(file, { maxSizeMB: 2, maxWidthOrHeight: 1920, useWebWorker: true });
    } catch { /* use original */ }

    setStatus('extracting');
    const formData = new FormData();
    formData.append('image', imageToUpload);

    try {
      const res = await fetch('/api/upload/stream', { method: 'POST', body: formData });
      if (!res.ok || !res.body) {
        // Fallback: stream not available, use legacy endpoint
        const legacyRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const json = await legacyRes.json();
        if (!legacyRes.ok) { setStatus('error_other'); setSaveResult({ success: false, error: json.error ?? 'Upload failed — please try again on WiFi.' }); return; }
        setConfirmPayload({ image_url: json.image_url, extracted_date: json.extracted_date ?? null, date_confidence: json.date_confidence, date_unclear: !!json.date_unclear, extraction: json.extraction });
        setStatus(json.date_unclear ? 'date_picker' : 'confirming');
        return;
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === 'log') {
              addLog(event.level, event.message, event.detail, event.elapsed);
            } else if (event.type === 'done') {
              const json = event.payload;
              setConfirmPayload({
                image_url: json.image_url,
                extracted_date: json.extracted_date ?? null,
                date_confidence: json.date_confidence,
                date_unclear: !!json.date_unclear,
                extraction: json.extraction,
                pipeline_metrics: json.pipeline_metrics,
              });
              setStatus(json.date_unclear ? 'date_picker' : 'confirming');
            } else if (event.type === 'error') {
              setStatus('error_other');
              setSaveResult({ success: false, error: event.message ?? 'Upload failed — please try again on WiFi.' });
            }
          } catch { /* malformed SSE line — skip */ }
        }
      }
    } catch {
      setStatus('error_other');
      setSaveResult({ success: false, error: 'Network error. Please try again.' });
    }
  }

  async function handleConfirm(overrideDate?: string) {
    if (!confirmPayload) return;

    // Merge any manually-entered tower totals into the extraction before saving.
    const extraction: ExtractionResult = JSON.parse(JSON.stringify(confirmPayload.extraction));
    for (const [key, valStr] of Object.entries(manualTotals)) {
      const num = Number(valStr.replace(/[, ]/g, ''));
      if (!Number.isFinite(num) || num <= 0) continue;
      const [tower, type] = key.split('_') as [keyof typeof extraction.tower_section, 'DO' | 'DR'];
      const row = extraction.tower_section?.[tower]?.[type];
      if (row) {
        row.total_ltrs = num;
        row.confidence = 1; // human-entered = authoritative
      }
      extraction.flagged_fields = (extraction.flagged_fields ?? []).filter(
        f => !f.toLowerCase().startsWith(key.toLowerCase())
      );
      extraction.flagged_fields.push(`${key}_total_ltrs: manually entered by technician`);
    }

    setStatus('saving');
    const finalDate = overrideDate ?? confirmPayload.extracted_date;
    // 'manual' if explicitly overridden OR if the date was picked by hand earlier.
    const dateSource = (overrideDate || confirmPayload.date_was_manual) ? 'manual' : 'ai';
    try {
      const res = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: confirmPayload.image_url,
          date: finalDate,
          extraction,
          date_source: dateSource,
          pipeline_metrics: confirmPayload.pipeline_metrics,
        }),
      });
      const json: SaveResult = await res.json();
      setSaveResult(json);
      setStatus(json.success ? 'success' : 'error_other');
      if (json.success && finalDate) {
        fetchPosterData(finalDate);
      }
    } catch {
      setStatus('error_other');
      setSaveResult({ success: false, error: 'Network error. Please try again.' });
    }
  }

  const confidenceColor = saveResult?.confidence != null
    ? saveResult.confidence >= 0.9 ? 'text-emerald-600 dark:text-emerald-400'
      : saveResult.confidence >= 0.75 ? 'text-amber-700 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'
    : '';

  // Success screen derived values — safe to compute unconditionally (all guard against null)
  const communityTotalForDisplay: number = saveResult?.community_total ?? (() => {
    if (!confirmPayload?.extraction?.tower_section) return 0;
    return (['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const).reduce((sum, tw) => {
      const t = confirmPayload.extraction.tower_section[tw];
      return sum + (t?.DO?.total_ltrs ?? 0) + (t?.DR?.total_ltrs ?? 0);
    }, 0);
  })();
  const towerSpikesForDisplay = saveResult?.tower_spikes ?? [];

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white flex flex-col">
      <Navbar />
      <div className="max-w-lg mx-auto w-full px-4 pt-4 pb-1">
        <h1 className="text-base font-semibold text-slate-700 dark:text-slate-300">Upload Sheet</h1>
        <p className="text-slate-500 dark:text-slate-400 text-xs">Trinity World Water Consumption</p>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6">

        {(status === 'compressing' || status === 'extracting' || status === 'saving') && (
          <>
            <ProgressDisplay status={status} preview={preview} />
            {status === 'extracting' && <ProcessingLog entries={logEntries} />}
          </>
        )}

        {status === 'success' && saveResult && (
          <div className="space-y-4">
            {/* Status header — animated checkmark draws in (circle, then tick),
                confidence % and community total count up rather than just
                appearing. "Confident & snappy": ~0.6s total, no bounce. */}
            <div className="bg-emerald-50 dark:bg-emerald-900/25 border border-emerald-300 dark:border-emerald-700/50 rounded-xl p-5 text-center animate-[popIn_0.4s_cubic-bezier(0.16,1,0.3,1)_both]">
              <svg width="56" height="56" viewBox="0 0 56 56" className="mx-auto mb-1 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
                <circle
                  cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25"
                />
                <circle
                  cx="28" cy="28" r="25" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"
                  style={{ '--tick-length': 157, strokeDasharray: 157, animation: 'drawTick 0.55s cubic-bezier(0.16,1,0.3,1) 0.05s both' } as React.CSSProperties}
                />
                <path
                  d="M17 29l7 7 15-15" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ '--tick-length': 32, strokeDasharray: 32, animation: 'drawTick 0.3s cubic-bezier(0.16,1,0.3,1) 0.5s both' } as React.CSSProperties}
                />
              </svg>
              <p className="text-emerald-700 dark:text-emerald-400 font-semibold text-lg">Sheet processed &amp; saved</p>
              {saveResult.date && <p className="text-slate-600 dark:text-slate-300 text-sm mt-1">{formatDate(saveResult.date)}</p>}
              {saveResult.confidence != null && (
                <p className={`text-sm mt-1.5 font-medium tabular-nums ${confidenceColor}`}>
                  Extraction confidence: <CountUp value={Math.round(saveResult.confidence * 100)} format={(n) => `${Math.round(n)}%`} durationMs={600} />
                </p>
              )}
            </div>

            {/* Mini summary card */}
            {communityTotalForDisplay > 0 && (
              <div
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 animate-[fadeInUp_0.35s_cubic-bezier(0.16,1,0.3,1)_both]"
                style={{ animationDelay: '120ms' }}
              >
                {/* Labelled by the sheet's own reading date, not the calendar day it was
                    uploaded — the technician uploads each morning a sheet covering the
                    PREVIOUS day's readings, so "today" here would be wrong. */}
                <p className="text-slate-500 dark:text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">
                  Community Total{saveResult.date ? ` — ${formatMediumDate(saveResult.date)}` : ''}
                </p>
                <p className="text-slate-900 dark:text-white text-2xl font-bold tabular-nums">
                  <CountUp value={communityTotalForDisplay / 1000} format={(n) => `${n.toFixed(1)} kL`} />
                </p>
                {towerSpikesForDisplay.length > 0 && (
                  <div className="space-y-1 pt-2 mt-2 border-t border-slate-200 dark:border-slate-800">
                    {towerSpikesForDisplay.map(s => (
                      <p key={s.tower} className="text-amber-600 dark:text-amber-400 text-sm font-medium">
                        ⚠ {s.tower} Tower: +{s.overagePct}% above avg
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Share overall poster — shown as soon as poster data is ready */}
            <button
              onClick={sharePoster}
              disabled={shareState === 'generating' || !posterData}
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1db954] active:scale-[0.98] disabled:bg-slate-700 disabled:cursor-not-allowed disabled:active:scale-100 text-[#0B3D1F] disabled:text-white font-bold py-4 rounded-xl text-base transition-all animate-[fadeInUp_0.35s_cubic-bezier(0.16,1,0.3,1)_both]"
              style={{ animationDelay: '200ms' }}
            >
              {shareState === 'generating' || (!posterData && shareState !== 'error') ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Preparing poster…
                </>
              ) : shareState === 'error' ? (
                '⚠ Retry Share'
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" fill="currentColor" />
                  </svg>
                  Share Overall Poster
                </>
              )}
            </button>

            <div className="animate-[fadeIn_0.3s_ease-out_both]" style={{ animationDelay: '260ms' }}>
              <FlaggedPanel
                flaggedFields={saveResult.flagged_fields ?? []}
                imageUrl={confirmPayload?.image_url ?? null}
              />
            </div>

            {/* Persistent processing trace + cost — collapsed, survives the screen switch */}
            <div className="animate-[fadeIn_0.3s_ease-out_both]" style={{ animationDelay: '300ms' }}>
              <ProcessingLog entries={logEntries} live={false} />
            </div>

            <div className="flex gap-3 animate-[fadeInUp_0.35s_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: '340ms' }}>
              <button onClick={resetToIdle} className="flex-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 active:scale-[0.98] text-slate-900 dark:text-white py-3 rounded-xl font-medium transition-all">
                Upload Another
              </button>
              <Link href="/" className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white py-3 rounded-xl font-medium text-center transition-all">
                View Dashboard
              </Link>
            </div>

            {/* Off-screen TemplateOverall — kept in DOM for html-to-image capture */}
            {posterData && (
              <div className="infographic-offscreen" aria-hidden="true">
                <div ref={posterRef}>
                  <TemplateOverall
                    date={posterData.date}
                    towers={posterData.towers}
                    communityTotal={posterData.communityTotal}
                    communityYesterday={posterData.communityYesterday}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {status === 'date_picker' && confirmPayload && (
          <DatePickerScreen
            imageUrl={preview}
            aiGuess={confirmPayload.extracted_date}
            onConfirm={(date) => {
              // If any tower total is unreadable, the date is now known but we still
              // need the technician to fill those in — route to the confirm screen
              // (which carries the manual-entry gate) instead of saving directly.
              if (findMissingTowerTotals(confirmPayload.extraction).length > 0) {
                setConfirmPayload({ ...confirmPayload, extracted_date: date, date_unclear: false, date_was_manual: true });
                setStatus('confirming');
              } else {
                handleConfirm(date);
              }
            }}
            onRetake={resetToIdle}
          />
        )}

        {status === 'error_other' && (
          <div className="space-y-5">
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl p-4">
              <p className="text-red-600 dark:text-red-400 text-sm">{saveResult?.error ?? 'Upload failed — please try again on WiFi.'}</p>
            </div>
            <button onClick={resetToIdle} className="w-full bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white py-3 rounded-xl font-medium transition-colors">Try Again</button>
          </div>
        )}

        {status === 'confirming' && confirmPayload && confirmPayload.extracted_date && (
          <div className="space-y-4">
            {preview && (
              <div className="rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700">
                <Image src={preview} alt="Sheet preview" width={400} height={200} className="w-full object-contain max-h-48" unoptimized />
              </div>
            )}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5">
              <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Date found on sheet</p>
              <p className="text-slate-900 dark:text-white text-xl font-bold mt-1">{formatDate(confirmPayload.extracted_date)}</p>
              <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1.5">AI confidence: {Math.round(confirmPayload.date_confidence * 100)}%</p>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm text-center">Does this date look correct?</p>

            {/* Required manual entry for tower totals the AI could not read */}
            {(() => {
              const missing = findMissingTowerTotals(confirmPayload.extraction);
              if (missing.length === 0) return null;
              const allFilled = missing.every(m => {
                const v = manualTotals[m.key]?.replace(/[, ]/g, '');
                return v && Number(v) > 0;
              });
              return (
                <div className="bg-amber-50 dark:bg-amber-900/15 border border-amber-300 dark:border-amber-700/40 rounded-xl p-4 space-y-3">
                  <p className="text-amber-700 dark:text-amber-300 font-semibold text-sm">
                    {missing.length} reading{missing.length > 1 ? 's' : ''} couldn&apos;t be read — please copy {missing.length > 1 ? 'them' : 'it'} from your sheet
                  </p>
                  <p className="text-slate-500 dark:text-slate-400 text-xs">
                    On the paper sheet in front of you, find the row below in the top <span className="text-slate-700 dark:text-slate-300 font-medium">METER READING</span> table and type the value from the <span className="text-slate-700 dark:text-slate-300 font-medium">&ldquo;TOTAL IN LTRS&rdquo;</span> column.
                  </p>
                  {missing.map(m => (
                    <div key={m.key} className="bg-white dark:bg-slate-900/60 rounded-lg p-3 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          {/* Row name EXACTLY as printed on the sheet, e.g. "VENUS DO" */}
                          <p className="text-slate-900 dark:text-white text-sm font-bold tracking-wide">
                            {m.tower.toUpperCase()} {m.type}
                          </p>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                            Row &ldquo;{m.tower.toUpperCase()} {m.type}&rdquo; · {m.type === 'DO' ? 'Domestic / Overhead' : 'Drinking water'} · <span className="text-amber-700 dark:text-amber-300/90">TOTAL IN LTRS</span> column
                          </p>
                        </div>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="e.g. 141600"
                          value={manualTotals[m.key] ?? ''}
                          onChange={e => setManualTotals(prev => ({ ...prev, [m.key]: e.target.value }))}
                          aria-label={`${m.tower.toUpperCase()} ${m.type} — TOTAL IN LTRS`}
                          className="w-32 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm text-right focus:border-blue-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  ))}
                  <p className="text-slate-500 dark:text-slate-500 text-[11px]">
                    💡 Use the photo above to match the row. Enter the number exactly as written (e.g. 1,41,600 → type 141600).
                  </p>
                  {!allFilled && <p className="text-amber-600 dark:text-amber-400/70 text-xs">Enter all values to enable Save.</p>}
                </div>
              );
            })()}

            <div className="flex gap-3">
              <button onClick={resetToIdle} className="flex-1 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-900 dark:text-white py-3 rounded-xl font-medium transition-colors">Retake Photo</button>
              <button
                onClick={() => handleConfirm()}
                disabled={!findMissingTowerTotals(confirmPayload.extraction).every(m => {
                  const v = manualTotals[m.key]?.replace(/[, ]/g, '');
                  return v && Number(v) > 0;
                })}
                className="flex-1 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white disabled:text-slate-400 py-3 rounded-xl font-semibold transition-all"
              >
                Confirm &amp; Save
              </button>
            </div>

            {/* Persistent processing trace + cost — visible before saving too */}
            <ProcessingLog entries={logEntries} live={false} />
          </div>
        )}

        {status === 'idle' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 text-sm font-medium mb-2">Daily Water Sheet</label>
              {preview ? (
                <div className="relative rounded-xl overflow-hidden bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <Image src={preview} alt="Sheet preview" width={400} height={300} className="w-full object-contain max-h-72" unoptimized />
                  <button type="button" onClick={resetToIdle} className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-800 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">✕</button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-48 bg-white dark:bg-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-slate-800/80 transition-colors">
                  <div className="text-center px-4">
                    <CameraIcon className="w-9 h-9 mb-2 mx-auto text-slate-400 dark:text-slate-500" />
                    <p className="text-slate-700 dark:text-slate-300 font-medium text-sm">Tap to photograph today&apos;s water sheet</p>
                    <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">JPG, PNG or HEIC accepted</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" required />
                </label>
              )}
            </div>
            <button type="submit" disabled={!file} className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:cursor-not-allowed text-white disabled:text-slate-400 font-semibold py-4 rounded-xl text-base transition-all">
              Upload Sheet
            </button>
            <p className="text-slate-500 dark:text-slate-400 text-xs text-center">No login needed. AI reads the date automatically.</p>
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 text-center">
              <p className="text-slate-500 dark:text-slate-500 text-xs mb-2">Prefer to enter data manually?</p>
              <Link href="/upload/logbook" className="inline-block text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 border border-blue-300 dark:border-blue-800 hover:border-blue-400 dark:hover:border-blue-600 rounded-lg px-4 py-2 transition-colors">
                Open Log Book Entry Form →
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
