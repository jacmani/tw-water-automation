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

// ── Progress bar steps ──────────────────────────────────────────────────────
const STEPS = [
  { id: 'compressing', label: 'Compressing image' },
  { id: 'extracting',  label: 'AI reading sheet' },
  { id: 'saving',      label: 'Saving data' },
] as const;

type StepId = typeof STEPS[number]['id'];

function getStepIndex(status: Status): number {
  if (status === 'compressing') return 0;
  if (status === 'extracting')  return 1;
  if (status === 'saving')      return 2;
  return -1;
}

// Simulated sub-progress for the slow AI step (0–100 within extracting)
function useExtractingProgress(active: boolean) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!active) { setPct(0); return; }
    // Fast ramp to 15%, then slow crawl to 82%, hold there until done
    setPct(5);
    const intervals: ReturnType<typeof setInterval>[] = [];
    const t1 = setTimeout(() => setPct(15), 400);
    // ~1% per 600ms from 15→82 over ~40s
    let cur = 15;
    const t2 = setInterval(() => {
      cur = Math.min(82, cur + 1);
      setPct(cur);
      if (cur >= 82) clearInterval(t2);
    }, 600);
    intervals.push(t2);
    return () => { clearTimeout(t1); intervals.forEach(clearInterval); };
  }, [active]);
  return pct;
}

function ProgressDisplay({
  status,
  preview,
}: {
  status: Status;
  preview: string | null;
}) {
  const stepIdx = getStepIndex(status);
  const extractingProgress = useExtractingProgress(status === 'extracting');

  // Overall bar: each step = 33.3%
  // Within extracting, animate sub-progress
  let overallPct = 0;
  if (stepIdx === 0) overallPct = 8; // compressing started
  if (stepIdx === 1) overallPct = 33 + (extractingProgress / 100) * 34; // 33→67
  if (stepIdx === 2) overallPct = 90; // saving

  return (
    <div className="space-y-6">
      {/* Sheet thumbnail while processing */}
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
              <div className="bg-slate-900/80 backdrop-blur-sm rounded-xl px-4 py-3 flex items-center gap-3">
                <span className="w-5 h-5 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin flex-shrink-0" />
                <span className="text-blue-300 text-sm font-medium">Claude is reading…</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step labels */}
      <div className="flex justify-between text-xs mb-1 px-0.5">
        {STEPS.map((s, i) => (
          <span
            key={s.id}
            className={
              i < stepIdx
                ? 'text-emerald-400 font-medium'
                : i === stepIdx
                ? 'text-blue-300 font-semibold'
                : 'text-slate-600'
            }
          >
            {i < stepIdx ? '✓ ' : ''}{s.label}
          </span>
        ))}
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-700 ease-out"
          style={{ width: `${overallPct}%` }}
        />
      </div>

      {/* Current step detail */}
      <p className="text-center text-slate-400 text-sm">
        {status === 'compressing' && 'Preparing your photo…'}
        {status === 'extracting' && 'Reading handwritten values from the sheet. This takes 15–30 seconds.'}
        {status === 'saving' && 'Writing to database…'}
      </p>

      {/* Step dots */}
      <div className="flex justify-center gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              i < stepIdx
                ? 'bg-emerald-400'
                : i === stepIdx
                ? 'bg-blue-400 scale-125'
                : 'bg-slate-700'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ── Flagged fields panel with annotated image ───────────────────────────────
function FlaggedPanel({
  flaggedFields,
  imageUrl,
}: {
  flaggedFields: string[];
  imageUrl: string | null;
}) {
  if (!flaggedFields.length) return null;

  return (
    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 space-y-4">
      <p className="text-yellow-400 font-medium text-sm">
        Low-confidence fields — please verify:
      </p>

      {/* Annotated image */}
      {imageUrl && (
        <div className="relative rounded-lg overflow-hidden bg-slate-800 border border-slate-700">
          <Image
            src={imageUrl}
            alt="Uploaded sheet"
            width={400}
            height={300}
            className="w-full object-contain max-h-64"
            unoptimized
          />
          {/* Number badges overlaid along the right edge */}
          <div className="absolute top-2 right-2 flex flex-col gap-1.5">
            {flaggedFields.map((_, i) => (
              <span
                key={i}
                className="w-5 h-5 rounded-full bg-yellow-400 text-slate-900 text-xs font-bold flex items-center justify-center shadow-lg"
              >
                {i + 1}
              </span>
            ))}
          </div>
          {/* "Review required" banner */}
          <div className="absolute bottom-0 inset-x-0 bg-yellow-900/80 backdrop-blur-sm px-3 py-1.5">
            <p className="text-yellow-300 text-xs text-center font-medium">
              {flaggedFields.length} field{flaggedFields.length > 1 ? 's' : ''} need manual verification
            </p>
          </div>
        </div>
      )}

      {/* Numbered legend */}
      <ul className="space-y-1.5">
        {flaggedFields.map((f, i) => (
          <li key={f} className="flex items-start gap-2">
            <span className="mt-0.5 w-5 h-5 rounded-full bg-yellow-400/20 border border-yellow-500/50 text-yellow-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
              {i + 1}
            </span>
            <span className="text-yellow-300/80 text-xs font-mono bg-slate-800 rounded px-2 py-1 flex-1">
              {f}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
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

    // Step 1: compress
    setStatus('compressing');
    let imageToUpload = file;
    try {
      imageToUpload = await imageCompression(file, {
        maxSizeMB: 2,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
    } catch {
      // fall back to original
    }

    // Step 2: upload + extract (no DB save yet)
    setStatus('extracting');
    const formData = new FormData();
    formData.append('image', imageToUpload);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const json = await res.json();

      if (res.status === 422 && json.error === 'date_unclear') {
        setStatus('error_date');
        return;
      }
      if (!res.ok) {
        setStatus('error_other');
        setSaveResult({ success: false, error: json.error ?? 'Something went wrong.' });
        return;
      }

      setConfirmPayload({
        image_url: json.image_url,
        extracted_date: json.extracted_date,
        date_confidence: json.date_confidence,
        extraction: json.extraction,
      });
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
        body: JSON.stringify({
          image_url: confirmPayload.image_url,
          date: confirmPayload.extracted_date,
          extraction: confirmPayload.extraction,
        }),
      });
      const json: SaveResult = await res.json();
      setSaveResult(json);
      if (json.success) {
        setStatus('success');
      } else {
        setStatus('error_other');
      }
    } catch {
      setStatus('error_other');
      setSaveResult({ success: false, error: 'Network error. Please try again.' });
    }
  }

  const confidenceColor =
    saveResult?.confidence != null
      ? saveResult.confidence >= 0.9
        ? 'text-emerald-400'
        : saveResult.confidence >= 0.75
        ? 'text-yellow-400'
        : 'text-red-400'
      : '';

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
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

        {/* ── Progress (compressing / extracting / saving) ── */}
        {(status === 'compressing' || status === 'extracting' || status === 'saving') && (
          <ProgressDisplay status={status} preview={preview} />
        )}

        {/* ── Success ── */}
        {status === 'success' && saveResult && (
          <div className="space-y-5">
            <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-5 text-center">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-emerald-400 font-semibold text-lg">Sheet Saved</p>
              {confirmPayload && (
                <p className="text-slate-300 text-sm mt-1">
                  {formatDate(confirmPayload.extracted_date)}
                </p>
              )}
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
              <button
                onClick={resetToIdle}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors"
              >
                Upload Another
              </button>
              <Link
                href="/"
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-medium text-center transition-colors"
              >
                View Dashboard
              </Link>
            </div>
          </div>
        )}

        {/* ── Date unclear error ── */}
        {status === 'error_date' && (
          <div className="space-y-5">
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-5 text-center">
              <div className="text-4xl mb-3">📷</div>
              <p className="text-red-400 font-semibold text-base">Date on sheet is unclear</p>
              <p className="text-slate-300 text-sm mt-2 leading-relaxed">
                Please retake the photo in better lighting. Make sure the date at the top of the sheet is fully visible.
              </p>
            </div>
            <button
              onClick={resetToIdle}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Retake Photo
            </button>
          </div>
        )}

        {/* ── Other error ── */}
        {status === 'error_other' && (
          <div className="space-y-5">
            <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
              <p className="text-red-400 text-sm">{saveResult?.error ?? 'Something went wrong.'}</p>
            </div>
            <button
              onClick={resetToIdle}
              className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* ── Date confirmation ── */}
        {status === 'confirming' && confirmPayload && (
          <div className="space-y-4">
            {preview && (
              <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                <Image
                  src={preview}
                  alt="Sheet preview"
                  width={400}
                  height={200}
                  className="w-full object-contain max-h-48"
                  unoptimized
                />
              </div>
            )}

            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5">
              <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
                Date found on sheet
              </p>
              <p className="text-white text-xl font-bold mt-1">
                {formatDate(confirmPayload.extracted_date)}
              </p>
              <p className="text-emerald-400 text-xs mt-1.5">
                Confidence: {Math.round(confirmPayload.date_confidence * 100)}%
              </p>
            </div>

            <p className="text-slate-400 text-sm text-center">
              Does this date look correct?
            </p>

            <div className="flex gap-3">
              <button
                onClick={resetToIdle}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium transition-colors"
              >
                Retake Photo
              </button>
              <button
                onClick={handleConfirm}
                className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold transition-colors"
              >
                Confirm & Save
              </button>
            </div>
          </div>
        )}

        {/* ── Upload form (idle) ── */}
        {status === 'idle' && (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">
                Sheet Photo
              </label>

              {preview ? (
                <div className="relative rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
                  <Image
                    src={preview}
                    alt="Sheet preview"
                    width={400}
                    height={300}
                    className="w-full object-contain max-h-72"
                    unoptimized
                  />
                  <button
                    type="button"
                    onClick={resetToIdle}
                    className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-800 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-48 bg-slate-800 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-slate-800/80 transition-colors">
                  <div className="text-center px-4">
                    <div className="text-4xl mb-2">📷</div>
                    <p className="text-slate-300 font-medium text-sm">Tap to take photo or choose file</p>
                    <p className="text-slate-500 text-xs mt-1">JPG, PNG, HEIC accepted</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                    required
                  />
                </label>
              )}
            </div>

            <button
              type="submit"
              disabled={!file}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-base transition-colors"
            >
              Submit Sheet
            </button>

            <p className="text-slate-500 text-xs text-center">
              No login required. Date is read automatically from the sheet.
            </p>

            <div className="border-t border-slate-800 pt-4 text-center">
              <p className="text-slate-500 text-xs mb-2">Prefer to enter data manually?</p>
              <Link
                href="/upload/logbook"
                className="inline-block text-sm text-blue-400 hover:text-blue-300 border border-blue-800 hover:border-blue-600 rounded-lg px-4 py-2 transition-colors"
              >
                Open Log Book Entry Form →
              </Link>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
