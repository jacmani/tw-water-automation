'use client';

import { useState, useRef, useEffect, ChangeEvent, FormEvent } from 'react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Image from 'next/image';
import imageCompression from 'browser-image-compression';
import type { ExtractionResult } from '@/types';
import { formatDate } from '@/lib/utils';

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
const LEVEL_ICON: Record<LogLevel, string> = {
  info:    '⏳',
  success: '✅',
  warn:    '⚠️',
  error:   '❌',
  engine:  '🔍',
};
const LEVEL_MSG_COLOR: Record<LogLevel, string> = {
  info:    'text-blue-300',
  success: 'text-emerald-400',
  warn:    'text-yellow-400',
  error:   'text-red-400',
  engine:  'text-violet-300',
};
const LEVEL_DETAIL_COLOR: Record<LogLevel, string> = {
  info:    'text-slate-500',
  success: 'text-slate-500',
  warn:    'text-yellow-600',
  error:   'text-red-600',
  engine:  'text-slate-500',
};

function ProcessingLog({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className="mt-4 bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Live Processing Log</span>
      </div>
      <div className="px-4 py-3 space-y-1.5 font-mono text-xs max-h-52 overflow-y-auto scrollbar-thin">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-2">
            <span className="flex-shrink-0 w-4 text-center">{LEVEL_ICON[e.level]}</span>
            <span className={`flex-1 leading-snug ${LEVEL_MSG_COLOR[e.level]}`}>
              {e.message}
              {e.detail && (
                <span className={`ml-2 ${LEVEL_DETAIL_COLOR[e.level]}`}>— {e.detail}</span>
              )}
            </span>
            {e.elapsed != null && (
              <span className="flex-shrink-0 text-slate-700 tabular-nums">{(e.elapsed / 1000).toFixed(1)}s</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
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
}

interface SaveResult {
  success: boolean;
  sheet_id?: string;
  date?: string;
  confidence?: number;
  flagged_fields?: string[];
  error?: string;
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
        <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700 relative">
          <Image src={preview} alt="Sheet being processed" width={400} height={240}
            className="w-full object-contain max-h-52 opacity-60" unoptimized />
          {status === 'extracting' && (
            <div className="absolute inset-0 flex items-center justify-center">
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
            i < stepIdx ? 'text-emerald-400 font-medium'
            : i === stepIdx ? 'text-blue-300 font-semibold'
            : 'text-slate-600'
          }>{i < stepIdx ? '✓ ' : ''}{s.label}</span>
        ))}
      </div>
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${overallPct}%` }} />
      </div>
      <p className="text-center text-slate-400 text-sm">
        {status === 'compressing' && 'Preparing your photo…'}
        {status === 'extracting' && 'This takes 15–30 seconds. Please wait.'}
        {status === 'saving' && 'Writing to database…'}
      </p>
      <div className="flex justify-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s.id} className={`w-2 h-2 rounded-full transition-all duration-300 ${
            i < stepIdx ? 'bg-emerald-400' : i === stepIdx ? 'bg-blue-400 scale-125' : 'bg-slate-700'
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

  // ── Tower readings (section 2) ────────────────────────────────────
  // Matches both spaced ("Venus DO") and underscore ("Venus_DO", "tower_Venus_DO_total_ltrs") forms.
  if (lower.match(/tower|venus[ _]d[or]|mercury[ _]d[or]|neptune[ _]d[or]|jupiter[ _]d[or]|venus|mercury|neptune|jupiter/)) {
    const towerMap: Record<string, string> = {
      venus: 'Venus Tower', mercury: 'Mercury Tower',
      neptune: 'Neptune Tower', jupiter: 'Jupiter Tower',
    };
    const typeMap: Record<string, string> = { do: 'Domestic (overhead)', dr: 'Drinking water' };
    const tm = lower.match(/(venus|mercury|neptune|jupiter)/);
    // Accept DO/DR bounded by space OR underscore (e.g. "venus_do_total_ltrs").
    const dm = lower.match(/[ _](do|dr)[ _]/) ?? lower.match(/\b(do|dr)\b/);
    const rowHint = tm ? `${towerMap[tm[1]] ?? tm[1]} — ${dm ? typeMap[dm[1]] ?? dm[1] : ''} row`.replace(/ —  row$/, ' row') : 'Tower readings table';
    return { sectionY: 6, sectionH: 24, sectionName: 'Tower Meter Readings', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Water sources (section 3) ─────────────────────────────────────
  if (lower.match(/water_source|source|well|tanker|kingsley/)) {
    const srcLabels: Record<string, string> = {
      'v well 4': 'Venus Side Well 4+B1+B2 row',
      'b1+b2': 'Venus Side Well 4+B1+B2 row',
      'v well 1': 'Venus Side Well 1+2+3 row',
      'n well 5': 'Neptune Side Well 5 row',
      'n well 6': 'Neptune Side Well 6 row',
      'open well': 'Open Well row',
      'on outside': 'ON Outside Well row',
      'kingsley': 'Kingsley row',
      'mtr': 'Mercury+Venus Tanker row',
      'jtr': 'Jupiter+Neptune Tanker row',
    };
    let rowHint = 'Input source readings table';
    for (const [k, v] of Object.entries(srcLabels)) {
      if (lower.includes(k)) { rowHint = v; break; }
    }
    return { sectionY: 30, sectionH: 22, sectionName: 'Input Source / Well Readings', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Amenities (section 4) ─────────────────────────────────────────
  if (lower.match(/amenit|car wash|swimming pool|pool|party hall/)) {
    const isPool = lower.includes('swimming pool') || lower.includes('pool');
    const isParty = lower.includes('party hall');
    const locM = lower.match(/(jupiter|mercury|venus|neptune|meter [1-7])/);
    const rowHint = locM
      ? `${isPool ? 'Swimming Pool' : isParty ? 'Party Hall' : 'Car Wash'} — ${locM[1].replace(/\b\w/g, c => c.toUpperCase())} row`
      : isPool ? 'Swimming Pool section' : isParty ? 'Party Hall section' : 'Car Wash section';
    return { sectionY: 52, sectionH: 12, sectionName: 'Amenities (Car Wash / Pool)', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Water levels (section 5) ──────────────────────────────────────
  if (lower.match(/water_level|tank level|jdo|jdr|mdo|mdr|collection tank|fire tank/)) {
    const slotM = lower.match(/(6am|12pm|6pm|12am|06:00|12:00|18:00|00:00)/);
    const slotNames: Record<string, string> = {
      '6am': '6 AM', '06:00': '6 AM', '12pm': '12 PM', '12:00': '12 PM',
      '6pm': '6 PM', '18:00': '6 PM', '12am': '12 AM', '00:00': '12 AM',
    };
    const rowHint = slotM ? `${slotNames[slotM[1]] ?? slotM[1]} reading row` : 'Water tank levels table';
    return { sectionY: 64, sectionH: 14, sectionName: 'Water Tank Level Readings', rowHint, problem: cleanProblem(raw), color };
  }

  // ── Summary / Total Inflow (section 7) ───────────────────────────
  if (lower.match(/summary|input_total|tower_usage|v_side|n_side|jtr_tanker|mtr_tanker|inflow|balance/)) {
    const fieldNames: Record<string, string> = {
      v_side: '"Venus Side Well" total cell',
      n_side: '"Neptune Side Well" total cell',
      jtr_tanker: '"JTR Tanker" total cell',
      mtr_tanker: '"MTR Tanker" total cell',
      input_total: '"Total Input" cell',
      tower_usage: '"Tower Usage" cell',
      diff: '"Difference" cell',
    };
    let rowHint = 'Total Inflow summary row (bottom of sheet)';
    for (const [k, v] of Object.entries(fieldNames)) {
      if (lower.includes(k)) { rowHint = v; break; }
    }
    return { sectionY: 88, sectionH: 12, sectionName: 'Total Inflow Summary (bottom row)', rowHint, problem: cleanProblem(raw), color };
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
    <div className="relative rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
      <canvas ref={canvasRef} className="w-full" style={{ display: ready ? 'block' : 'none' }} />
      {!ready && (
        <div className="h-48 flex items-center justify-center text-slate-500 text-sm animate-pulse">
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
        <span className="text-white font-semibold text-sm">{sectionName}</span>
        {severity === 'fixed' && (
          <span className="ml-auto text-emerald-400 text-xs font-medium">✓ auto-fixed</span>
        )}
      </div>
      <div className="bg-slate-900 px-4 py-3 space-y-2">
        <div className="flex items-start gap-2">
          <span className="text-slate-500 text-xs mt-0.5 flex-shrink-0">📍 Row</span>
          <span className="text-slate-200 text-sm font-medium">{rowHint}</span>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-slate-500 text-xs mt-0.5 flex-shrink-0">{severity === 'fixed' ? 'ℹ️ Note' : '⚠️ Check'}</span>
          <span className="text-slate-300 text-sm leading-snug">{problem}</span>
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
      <div className={`rounded-xl p-4 border ${nReview > 0 ? 'bg-amber-900/15 border-amber-700/40' : 'bg-emerald-900/15 border-emerald-700/40'}`}>
        <p className={`font-semibold text-sm mb-1 ${nReview > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
          {nReview > 0
            ? `Saved — ${nReview} reading${nReview > 1 ? 's' : ''} to double-check`
            : '✓ Saved — everything looks good'}
        </p>
        <p className="text-slate-400 text-xs">
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
            className="w-full text-left text-xs text-slate-400 hover:text-slate-200 flex items-center gap-2 px-1"
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
      <div className="bg-amber-900/30 border border-amber-600/60 rounded-xl p-4">
        <div className="flex gap-3 items-start">
          <span className="text-amber-400 text-xl flex-shrink-0">📅</span>
          <div>
            <p className="text-amber-300 font-semibold text-sm">Couldn&apos;t read the date automatically</p>
            <p className="text-slate-400 text-xs mt-1 leading-relaxed">
              The AI couldn&apos;t read the date from this sheet with enough confidence. Please enter the correct date
              — this is the only field you need to provide.{aiGuess ? ' The AI\'s best guess is pre-filled below.' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Sheet thumbnail */}
      {imageUrl && (
        <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
          <Image src={imageUrl} alt="Sheet preview" width={400} height={200}
            className="w-full object-contain max-h-48" unoptimized />
        </div>
      )}

      {/* Date input */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-3">
        <div>
          <label className="block text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            Sheet Date
          </label>
          <input
            type="date"
            value={selectedDate}
            max={todayIST()}
            onChange={(e) => { setSelectedDate(e.target.value); setError(''); }}
            className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {error && <p className="text-red-400 text-xs mt-1.5">{error}</p>}
        </div>
        {aiGuess && (
          <p className="text-slate-500 text-xs">
            AI guessed: {formatDate(aiGuess)}{aiGuess !== selectedDate ? ' — change above if different.' : ''}
          </p>
        )}
        <div className="bg-blue-950/50 border border-blue-800/50 rounded-lg px-3 py-2 flex gap-2 items-start">
          <span className="text-blue-400 text-xs flex-shrink-0 mt-0.5">ℹ️</span>
          <p className="text-blue-300 text-xs leading-relaxed">
            This entry will be flagged as <strong>manually dated</strong> in the history view so the committee is aware.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onRetake}
          className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors"
        >
          Retake Photo
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selectedDate}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white py-3 rounded-xl font-semibold transition-colors"
        >
          Save with This Date
        </button>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [confirmPayload, setConfirmPayload] = useState<ConfirmPayload | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    logIdRef.current = 0;
    if (fileInputRef.current) fileInputRef.current.value = '';
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
        if (!legacyRes.ok) { setStatus('error_other'); setSaveResult({ success: false, error: json.error ?? 'Something went wrong.' }); return; }
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
              });
              setStatus(json.date_unclear ? 'date_picker' : 'confirming');
            } else if (event.type === 'error') {
              setStatus('error_other');
              setSaveResult({ success: false, error: event.message ?? 'Something went wrong.' });
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
    setStatus('saving');
    const finalDate = overrideDate ?? confirmPayload.extracted_date;
    const dateSource = overrideDate ? 'manual' : 'ai';
    try {
      const res = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: confirmPayload.image_url,
          date: finalDate,
          extraction: confirmPayload.extraction,
          date_source: dateSource,
        }),
      });
      const json: SaveResult = await res.json();
      setSaveResult(json);
      setStatus(json.success ? 'success' : 'error_other');
    } catch {
      setStatus('error_other');
      setSaveResult({ success: false, error: 'Network error. Please try again.' });
    }
  }

  const confidenceColor = saveResult?.confidence != null
    ? saveResult.confidence >= 0.9 ? 'text-emerald-400'
      : saveResult.confidence >= 0.75 ? 'text-yellow-400' : 'text-red-400'
    : '';

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
          <div className="space-y-5">
            <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-5 text-center">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-emerald-400 font-semibold text-lg">Sheet Saved</p>
              {saveResult.date && <p className="text-slate-300 text-sm mt-1">{formatDate(saveResult.date)}</p>}
              {saveResult.confidence != null && (
                <p className={`text-sm mt-2 font-medium ${confidenceColor}`}>
                  Extraction confidence: {Math.round(saveResult.confidence * 100)}%
                </p>
              )}
            </div>

            <FlaggedPanel
              flaggedFields={saveResult.flagged_fields ?? []}
              imageUrl={confirmPayload?.image_url ?? null}
            />

            <div className="flex gap-3">
              <button onClick={resetToIdle} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">
                Upload Another
              </button>
              <Link href="/" className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium text-center transition-colors">
                View Dashboard
              </Link>
            </div>
          </div>
        )}

        {status === 'date_picker' && confirmPayload && (
          <DatePickerScreen
            imageUrl={preview}
            aiGuess={confirmPayload.extracted_date}
            onConfirm={(date) => handleConfirm(date)}
            onRetake={resetToIdle}
          />
        )}

        {status === 'error_other' && (
          <div className="space-y-5">
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
              <p className="text-red-400 text-sm">{saveResult?.error ?? 'Something went wrong.'}</p>
            </div>
            <button onClick={resetToIdle} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">Try Again</button>
          </div>
        )}

        {status === 'confirming' && confirmPayload && confirmPayload.extracted_date && (
          <div className="space-y-4">
            {preview && (
              <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                <Image src={preview} alt="Sheet preview" width={400} height={200} className="w-full object-contain max-h-48" unoptimized />
              </div>
            )}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Date found on sheet</p>
              <p className="text-white text-xl font-bold mt-1">{formatDate(confirmPayload.extracted_date)}</p>
              <p className="text-emerald-400 text-xs mt-1.5">AI confidence: {Math.round(confirmPayload.date_confidence * 100)}%</p>
            </div>
            <p className="text-slate-400 text-sm text-center">Does this date look correct?</p>
            <div className="flex gap-3">
              <button onClick={resetToIdle} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">Retake Photo</button>
              <button onClick={() => handleConfirm()} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold transition-colors">Confirm & Save</button>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">Sheet Photo</label>
              {preview ? (
                <div className="relative rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                  <Image src={preview} alt="Sheet preview" width={400} height={300} className="w-full object-contain max-h-72" unoptimized />
                  <button type="button" onClick={resetToIdle} className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-800 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm">✕</button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-48 bg-slate-800 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-slate-800/80 transition-colors">
                  <div className="text-center px-4">
                    <div className="text-4xl mb-2">📷</div>
                    <p className="text-slate-300 font-medium text-sm">Tap to take photo or choose file</p>
                    <p className="text-slate-500 text-xs mt-1">JPG, PNG, HEIC accepted</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" required />
                </label>
              )}
            </div>
            <button type="submit" disabled={!file} className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-base transition-colors">
              Submit Sheet
            </button>
            <p className="text-slate-500 text-xs text-center">No login required. Date is read automatically from the sheet.</p>
            <div className="border-t border-slate-800 pt-4 text-center">
              <p className="text-slate-500 text-xs mb-2">Prefer to enter data manually?</p>
              <Link href="/upload/logbook" className="inline-block text-sm text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 rounded-lg px-4 py-2 transition-colors">
                Open Log Book Entry Form →
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
