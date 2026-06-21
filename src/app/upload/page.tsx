'use client';

import { useState, useRef, useEffect, ChangeEvent, FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import imageCompression from 'browser-image-compression';
import type { ExtractionResult } from '@/types';
import { formatDate } from '@/lib/utils';

type Status =
  | 'idle'
  | 'compressing'
  | 'extracting'
  | 'confirming'
  | 'saving'
  | 'success'
  | 'error_date'
  | 'error_other';

interface ConfirmPayload {
  image_url: string;
  extracted_date: string;
  date_confidence: number;
  extraction: ExtractionResult;
}

interface SaveResult {
  success: boolean;
  sheet_id?: string;
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
                  Artificial Intelligence is reading the handwritten log sheet uploaded
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

interface FlagInfo {
  sectionY: number;   // % from top — start of highlight band
  sectionH: number;   // % height of band
  sectionName: string;
  rowHint: string;    // which row/cell within the section
  problem: string;    // plain-English problem
  color: string;      // hex
}

const COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#3B82F6','#A855F7','#EC4899'];

function parseFlag(raw: string, idx: number): FlagInfo {
  const lower = raw.toLowerCase();
  const color = COLORS[idx % COLORS.length];

  // ── Tower readings (section 2) ────────────────────────────────────
  if (lower.match(/tower|venus do|venus dr|mercury do|mercury dr|neptune|jupiter do|jupiter dr/)) {
    const towerMap: Record<string, string> = {
      venus: 'Venus Tower', mercury: 'Mercury Tower',
      neptune: 'Neptune Tower', jupiter: 'Jupiter Tower',
    };
    const typeMap: Record<string, string> = { do: 'Domestic (overhead)', dr: 'Drinking water' };
    const tm = lower.match(/(venus|mercury|neptune|jupiter)/);
    const dm = lower.match(/\b(do|dr)\b/);
    const rowHint = tm ? `${towerMap[tm[1]] ?? tm[1]} — ${dm ? typeMap[dm[1]] ?? dm[1] : ''} row` : 'Tower readings table';
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

  return detail
    .replace(/out_of_range[^)]*\)/gi, 'Number looks unusual — please double-check')
    .replace(/out_of_range/gi, 'Number looks unusual — please double-check')
    .replace(/blank\/unreadable/gi, 'Value is blank or could not be read from the photo')
    .replace(/only yesterday reading visible/gi, "Only yesterday's reading is visible; today's cell appears empty")
    .replace(/not present on sheet/gi, 'This row does not appear on this version of the sheet')
    .replace(/reading uncertain/gi, 'Handwriting is unclear — please check the original')
    .replace(/consumption noted as (\S+)\s*reading uncertain/gi, 'Consumption of $1 is hard to read — please verify')
    .replace(/\(value:?\s*[\d,]+\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

      flags.forEach(({ sectionY, sectionH, color }, i) => {
        const y  = (sectionY  / 100) * H;
        const h  = (sectionH  / 100) * H;

        // Dim everything outside this band with a subtle dark overlay
        // (don't do this per-flag — would compound; only draw the band itself)

        // Filled band
        ctx.save();
        ctx.fillStyle = color + '28';
        ctx.fillRect(0, y, W, h);

        // Left accent bar (thick stripe)
        ctx.fillStyle = color;
        ctx.fillRect(0, y, W * 0.012, h);

        // Top + bottom border lines
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, H * 0.003);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.moveTo(0, y + h);
        ctx.lineTo(W, y + h);
        ctx.stroke();

        // Badge circle on the left accent bar, vertically centred in band
        const bx = W * 0.012 + badgeR * 0.7;
        const by = y + h / 2;

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.fill();

        // White border on badge
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(2, W * 0.003);
        ctx.beginPath();
        ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
        ctx.stroke();

        // Number inside badge
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), bx, by);

        ctx.restore();
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
function FlaggedPanel({ flaggedFields, imageUrl }: { flaggedFields: string[]; imageUrl: string | null }) {
  if (!flaggedFields.length) return null;

  const flags = flaggedFields.map((f, i) => parseFlag(f, i));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
        <p className="text-yellow-400 font-semibold text-sm mb-1">
          ⚠️ {flags.length} area{flags.length > 1 ? 's' : ''} could not be read clearly
        </p>
        <p className="text-slate-400 text-xs">
          The coloured bands on the sheet below show exactly which sections need checking. Find the matching number below for details.
        </p>
      </div>

      {/* Annotated image */}
      {imageUrl && <AnnotatedCanvas imageUrl={imageUrl} flags={flags} />}

      {/* Per-flag cards */}
      <div className="space-y-3">
        {flags.map(({ sectionName, rowHint, problem, color }, i) => (
          <div
            key={i}
            className="rounded-xl overflow-hidden border"
            style={{ borderColor: color + '60' }}
          >
            {/* Coloured header bar */}
            <div className="flex items-center gap-3 px-4 py-2.5" style={{ backgroundColor: color + '22' }}>
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                style={{ backgroundColor: color }}
              >
                {i + 1}
              </span>
              <span className="text-white font-semibold text-sm">{sectionName}</span>
            </div>

            {/* Detail */}
            <div className="bg-slate-900 px-4 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-slate-500 text-xs mt-0.5 flex-shrink-0">📍 Row</span>
                <span className="text-slate-200 text-sm font-medium">{rowHint}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-slate-500 text-xs mt-0.5 flex-shrink-0">⚠️ Issue</span>
                <span className="text-slate-300 text-sm leading-snug">{problem}</span>
              </div>
            </div>
          </div>
        ))}
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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setStatus('compressing');
    let imageToUpload = file;
    try {
      imageToUpload = await imageCompression(file, { maxSizeMB: 2, maxWidthOrHeight: 1920, useWebWorker: true });
    } catch { /* use original */ }

    setStatus('extracting');
    const formData = new FormData();
    formData.append('image', imageToUpload);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const json = await res.json();
      if (res.status === 422 && json.error === 'date_unclear') { setStatus('error_date'); return; }
      if (!res.ok) { setStatus('error_other'); setSaveResult({ success: false, error: json.error ?? 'Something went wrong.' }); return; }
      setConfirmPayload({ image_url: json.image_url, extracted_date: json.extracted_date, date_confidence: json.date_confidence, extraction: json.extraction });
      setStatus('confirming');
    } catch {
      setStatus('error_other');
      setSaveResult({ success: false, error: 'Network error. Please try again.' });
    }
  }

  async function handleConfirm() {
    if (!confirmPayload) return;
    setStatus('saving');
    try {
      const res = await fetch('/api/upload/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: confirmPayload.image_url, date: confirmPayload.extracted_date, extraction: confirmPayload.extraction }),
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
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Upload Sheet</h1>
            <p className="text-slate-500 dark:text-slate-400 text-xs">Trinity World Water Consumption</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6">

        {(status === 'compressing' || status === 'extracting' || status === 'saving') && (
          <ProgressDisplay status={status} preview={preview} />
        )}

        {status === 'success' && saveResult && (
          <div className="space-y-5">
            <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-5 text-center">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-emerald-400 font-semibold text-lg">Sheet Saved</p>
              {confirmPayload && <p className="text-slate-300 text-sm mt-1">{formatDate(confirmPayload.extracted_date)}</p>}
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

        {status === 'error_date' && (
          <div className="space-y-5">
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-5 text-center">
              <div className="text-4xl mb-3">📷</div>
              <p className="text-red-400 font-semibold text-base">Date on sheet is unclear</p>
              <p className="text-slate-300 text-sm mt-2 leading-relaxed">Please retake the photo in better lighting. Make sure the date at the top of the sheet is fully visible.</p>
            </div>
            <button onClick={resetToIdle} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">Retake Photo</button>
          </div>
        )}

        {status === 'error_other' && (
          <div className="space-y-5">
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
              <p className="text-red-400 text-sm">{saveResult?.error ?? 'Something went wrong.'}</p>
            </div>
            <button onClick={resetToIdle} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">Try Again</button>
          </div>
        )}

        {status === 'confirming' && confirmPayload && (
          <div className="space-y-4">
            {preview && (
              <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                <Image src={preview} alt="Sheet preview" width={400} height={200} className="w-full object-contain max-h-48" unoptimized />
              </div>
            )}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Date found on sheet</p>
              <p className="text-white text-xl font-bold mt-1">{formatDate(confirmPayload.extracted_date)}</p>
              <p className="text-emerald-400 text-xs mt-1.5">Confidence: {Math.round(confirmPayload.date_confidence * 100)}%</p>
            </div>
            <p className="text-slate-400 text-sm text-center">Does this date look correct?</p>
            <div className="flex gap-3">
              <button onClick={resetToIdle} className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">Retake Photo</button>
              <button onClick={handleConfirm} className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold transition-colors">Confirm & Save</button>
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
