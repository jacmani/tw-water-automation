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
          <Image
            src={preview}
            alt="Sheet being processed"
            width={400}
            height={240}
            className="w-full object-contain max-h-52 opacity-60"
            unoptimized
          />
          {status === 'extracting' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-slate-900/85 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3 max-w-xs text-center">
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
          <span
            key={s.id}
            className={
              i < stepIdx ? 'text-emerald-400 font-medium'
              : i === stepIdx ? 'text-blue-300 font-semibold'
              : 'text-slate-600'
            }
          >
            {i < stepIdx ? '✓ ' : ''}{s.label}
          </span>
        ))}
      </div>

      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${overallPct}%` }}
        />
      </div>

      <p className="text-center text-slate-400 text-sm">
        {status === 'compressing' && 'Preparing your photo…'}
        {status === 'extracting' && 'This takes 15–30 seconds. Please wait.'}
        {status === 'saving' && 'Writing to database…'}
      </p>

      <div className="flex justify-center gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i < stepIdx ? 'bg-emerald-400'
              : i === stepIdx ? 'bg-blue-400 scale-125'
              : 'bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Sheet region map ────────────────────────────────────────────────────────
// Each region is [x%, y%, w%, h%] as percentage of image dimensions.
// Coordinates are calibrated to the Trinity World A3 sheet template.
// Sections (top→bottom): Tower (0–28%), Sources (28–47%), Water Levels (47–62%),
//   Car Wash/Pool (62–75%), Party Hall (75–84%), Summary (84–100%)

interface Region { x: number; y: number; w: number; h: number; }

const TOWER_ROWS: Record<string, number> = {
  'venus do': 5.5, 'venus dr': 8,
  'mercury do': 10.5, 'mercury dr': 13,
  'neptune do': 15.5, 'neptune dr': 18,
  'jupiter do': 20.5, 'jupiter dr': 23,
};

const SOURCE_ROWS: Record<string, number> = {
  'm+v do with mtr': 30, 'mercury': 30,
  'j+n do with jtr': 32.5, 'jupiter': 32.5,
  'v well 1+2+3': 35, 'venus side well 1': 35,
  'v well 4+b1+b2': 37.5, 'v well 4': 37.5,
  'n well 5': 40, 'neptune side well 5': 40,
  'n well 6': 42.5, 'neptune side well 6': 42.5,
  'on outside well': 45, 'open well': 45,
  'kingsley': 47,
};

const AMENITY_ROWS: Record<string, number> = {
  'jupiter': 64.5, 'mercury': 67, 'venus': 69.5, 'neptune': 72,
  'meter 1': 64.5, 'meter 2': 67, 'meter 3': 64.5, 'meter 4': 67, 'meter 5': 69.5,
};

const SUMMARY_FIELDS: Record<string, number> = {
  'v_side': 85.5, 'v side': 85.5,
  'n_side': 87.5, 'n side': 87.5,
  'jtr_tanker': 89.5, 'jtr tanker': 89.5,
  'mtr_tanker': 91.5, 'mtr tanker': 91.5,
  'input_total': 93.5, 'in put total': 93.5,
  'tower_usage': 95.5, 'tower usage': 95.5,
  'diff': 97.5,
};

const WATER_LEVEL_ROWS: Record<string, number> = {
  '6am': 49, '06:00': 49,
  '12pm': 52, '12:00': 52,
  '6pm': 55, '18:00': 55,
  '12am': 58, '00:00': 58,
};

function parseFlag(raw: string): { region: Region | null; label: string } {
  const lower = raw.toLowerCase();

  // ── Tower section ────────────────────────────────────────────────
  const towerMatch = lower.match(/tower_consumption\[(\w+)\]\[(\w+)\]|towers?\.(venus|mercury|neptune|jupiter)\.(do|dr)/);
  if (towerMatch) {
    const tower = (towerMatch[1] || towerMatch[3] || '').toLowerCase();
    const type = (towerMatch[2] || towerMatch[4] || '').toLowerCase();
    const key = `${tower} ${type}`;
    const y = TOWER_ROWS[key];
    if (y) return { region: { x: 0, y, w: 100, h: 2.5 }, label: humanLabel(raw) };
  }

  // ── Water sources ────────────────────────────────────────────────
  const srcMatch = lower.match(/water_sources?\[([^\]]+)\]/);
  if (srcMatch) {
    const src = srcMatch[1].toLowerCase();
    for (const [key, y] of Object.entries(SOURCE_ROWS)) {
      if (src.includes(key) || key.includes(src.split(':')[0])) {
        return { region: { x: 0, y, w: 100, h: 2.3 }, label: humanLabel(raw) };
      }
    }
    // fallback: sources section
    return { region: { x: 0, y: 28, w: 100, h: 19 }, label: humanLabel(raw) };
  }

  // ── Summary section ──────────────────────────────────────────────
  if (lower.includes('summary.')) {
    const field = lower.replace('summary.', '').split(':')[0].trim();
    for (const [key, y] of Object.entries(SUMMARY_FIELDS)) {
      if (field.includes(key) || key.includes(field)) {
        return { region: { x: 0, y, w: 100, h: 2 }, label: humanLabel(raw) };
      }
    }
    return { region: { x: 0, y: 84, w: 100, h: 16 }, label: humanLabel(raw) };
  }

  // ── Amenities ────────────────────────────────────────────────────
  if (lower.includes('amenities') || lower.includes('car wash') || lower.includes('swimming pool')) {
    const locMatch = lower.match(/\.(jupiter|mercury|venus|neptune|meter [1-7])/);
    const loc = locMatch ? locMatch[1] : null;
    const isPool = lower.includes('swimming pool') || lower.includes('pool');
    const baseY = isPool ? 64 : 62;
    const y = loc ? (AMENITY_ROWS[loc] ?? baseY) : baseY;
    const x = isPool ? 50 : 0;
    return { region: { x, y, w: 50, h: 2.3 }, label: humanLabel(raw) };
  }

  // ── Water levels ─────────────────────────────────────────────────
  if (lower.includes('water_level') || lower.includes('tank') || lower.includes('level')) {
    const slotMatch = lower.match(/6am|12pm|6pm|12am|06:00|12:00|18:00|00:00/);
    const slot = slotMatch ? slotMatch[0] : null;
    const y = slot ? (WATER_LEVEL_ROWS[slot] ?? 47) : 47;
    return { region: { x: 0, y, w: 100, h: 2.5 }, label: humanLabel(raw) };
  }

  return { region: null, label: humanLabel(raw) };
}

/** Convert a raw flagged_field string to a plain-English grandmother-friendly label */
function humanLabel(raw: string): string {
  const lower = raw.toLowerCase();

  // Section prefix → human section name
  let section = '';
  let detail = raw.split(':').slice(1).join(':').trim();

  if (lower.startsWith('tower_consumption') || lower.includes('towers.')) {
    const m = raw.match(/\[(venus|mercury|neptune|jupiter)\]\[(do|dr)\]/i);
    if (m) section = `Tower — ${m[1]} ${m[2] === 'DO' ? 'Domestic' : 'Drinking'} water`;
  } else if (lower.startsWith('water_sources')) {
    const m = raw.match(/\[([^\]]+)\]/);
    section = m ? `Water Source — ${m[1]}` : 'Water Sources section';
  } else if (lower.startsWith('summary.')) {
    const field = raw.split('.')[1]?.split(':')[0];
    const names: Record<string, string> = {
      v_side: 'Summary — Venus Side Well total',
      n_side: 'Summary — Neptune Side Well total',
      jtr_tanker: 'Summary — JTR Tanker total',
      mtr_tanker: 'Summary — MTR Tanker total',
      input_total: 'Summary — Total Water Input',
      tower_usage: 'Summary — Total Tower Usage',
      diff: 'Summary — Difference (Input vs Output)',
    };
    section = names[field ?? ''] ?? `Summary — ${field}`;
  } else if (lower.includes('amenities') || lower.includes('car wash') || lower.includes('swimming pool')) {
    const m = raw.match(/amenities?\.(Car Wash|Swimming Pool|Party Hall)\.([^:]+)/i);
    section = m ? `${m[1]} meter — ${m[2]}` : 'Amenities section';
  } else if (lower.includes('water_level') || lower.includes('level')) {
    section = 'Water Tank Levels';
  } else {
    section = raw.split(':')[0].replace(/[._\[\]]/g, ' ').trim();
  }

  // Simplify the detail message
  const friendly = detail
    .replace(/blank\/unreadable/gi, 'Value is blank or unreadable in the photo')
    .replace(/out_of_range/gi, 'Number looks unusual — please double-check')
    .replace(/not present on sheet/gi, 'This row is missing from this sheet format')
    .replace(/only yesterday reading visible/gi, 'Only yesterday\'s reading is visible; today\'s is missing')
    .replace(/consumption noted as (\S+)/gi, 'Consumption reading of $1 looks unusual')
    .replace(/reading uncertain/gi, 'Reading is unclear — please verify against the original sheet')
    .replace(/\(([^)]+)\)/gi, '')
    .trim();

  return `${section}${friendly ? ' — ' + friendly : ''}`;
}

// ── Annotated sheet canvas ──────────────────────────────────────────────────
const BADGE_COLORS = ['#EF4444','#F97316','#EAB308','#22C55E','#3B82F6','#A855F7','#EC4899','#14B8A6'];

function AnnotatedSheet({ imageUrl, flags }: { imageUrl: string; flags: { region: Region | null; label: string }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !loaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      const W = canvas.width;
      const H = canvas.height;

      flags.forEach(({ region }, i) => {
        if (!region) return;
        const color = BADGE_COLORS[i % BADGE_COLORS.length];
        const x = (region.x / 100) * W;
        const y = (region.y / 100) * H;
        const w = (region.w / 100) * W;
        const h = (region.h / 100) * H;

        // Highlight rectangle
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, W * 0.005);
        ctx.fillStyle = color + '30'; // 19% opacity fill
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Badge circle (top-left of box)
        const radius = Math.max(16, W * 0.022);
        const bx = x + radius * 0.6;
        const by = y - radius * 0.4;
        ctx.save();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(bx, by, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.round(radius * 1.1)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), bx, by);
        ctx.restore();
      });
    };
    img.src = imageUrl;
  }, [imageUrl, flags, loaded]);

  return (
    <div className="relative rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
      {/* Hidden img to trigger load detection */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt=""
        className="hidden"
        crossOrigin="anonymous"
        onLoad={() => setLoaded(true)}
      />
      <canvas
        ref={canvasRef}
        className="w-full object-contain"
        style={{ display: loaded ? 'block' : 'none' }}
      />
      {!loaded && (
        <div className="h-48 flex items-center justify-center text-slate-500 text-sm">
          Loading sheet…
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 bg-yellow-900/85 backdrop-blur-sm px-3 py-1.5">
        <p className="text-yellow-300 text-xs text-center font-medium">
          {flags.length} area{flags.length > 1 ? 's' : ''} marked for your review — see details below
        </p>
      </div>
    </div>
  );
}

// ── Flagged panel ───────────────────────────────────────────────────────────
function FlaggedPanel({ flaggedFields, imageUrl }: { flaggedFields: string[]; imageUrl: string | null }) {
  if (!flaggedFields.length) return null;

  const parsed = flaggedFields.map(f => parseFlag(f));

  return (
    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 space-y-4">
      <p className="text-yellow-400 font-semibold text-sm">
        ⚠️ {flaggedFields.length} area{flaggedFields.length > 1 ? 's' : ''} need your attention — please check the original sheet
      </p>

      {imageUrl && <AnnotatedSheet imageUrl={imageUrl} flags={parsed} />}

      <ul className="space-y-2">
        {parsed.map(({ label }, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className="mt-0.5 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0 shadow"
              style={{ backgroundColor: BADGE_COLORS[i % BADGE_COLORS.length] }}
            >
              {i + 1}
            </span>
            <span className="text-slate-200 text-sm leading-snug flex-1 pt-0.5">
              {label}
            </span>
          </li>
        ))}
      </ul>
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
      : saveResult.confidence >= 0.75 ? 'text-yellow-400'
      : 'text-red-400'
    : '';

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-4">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-bold text-white">Upload Sheet</h1>
            <p className="text-slate-400 text-xs">Trinity World Water Consumption</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6">

        {/* ── Progress ── */}
        {(status === 'compressing' || status === 'extracting' || status === 'saving') && (
          <ProgressDisplay status={status} preview={preview} />
        )}

        {/* ── Success ── */}
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

        {/* ── Date unclear ── */}
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

        {/* ── Other error ── */}
        {status === 'error_other' && (
          <div className="space-y-5">
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
              <p className="text-red-400 text-sm">{saveResult?.error ?? 'Something went wrong.'}</p>
            </div>
            <button onClick={resetToIdle} className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors">Try Again</button>
          </div>
        )}

        {/* ── Confirming date ── */}
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

        {/* ── Idle / upload form ── */}
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
