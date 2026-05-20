'use client';

import { useState, useRef, ChangeEvent, FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import imageCompression from 'browser-image-compression';

function getTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface UploadResult {
  success: boolean;
  sheet_id?: string;
  confidence?: number;
  flagged_fields?: string[];
  error?: string;
}

export default function UploadPage() {
  const [date, setDate] = useState(getTodayLocal());
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    const url = URL.createObjectURL(f);
    setPreview(url);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;

    setResult(null);
    setCompressing(true);

    let imageToUpload: File;
    try {
      imageToUpload = await imageCompression(file, {
        maxSizeMB: 2,
        maxWidthOrHeight: 1920,
        useWebWorker: true,
      });
    } catch {
      imageToUpload = file;
    } finally {
      setCompressing(false);
    }

    setLoading(true);

    const formData = new FormData();
    formData.append('image', imageToUpload);
    formData.append('date', date);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const json: UploadResult = await res.json();
      setResult(json);
      if (json.success) {
        setFile(null);
        setPreview(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch {
      setResult({ success: false, error: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  }

  const confidenceColor =
    result?.confidence != null
      ? result.confidence >= 0.9
        ? 'text-emerald-400'
        : result.confidence >= 0.75
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
            <p className="text-slate-400 text-xs">Trinity World Water</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6">
        {result?.success ? (
          /* Success state */
          <div className="space-y-5">
            <div className="bg-emerald-900/30 border border-emerald-700 rounded-xl p-5 text-center">
              <div className="text-4xl mb-2">✓</div>
              <p className="text-emerald-400 font-semibold text-lg">Sheet Processed</p>
              <p className="text-slate-400 text-sm mt-1">Data extracted and saved successfully</p>
              {result.confidence != null && (
                <p className={`text-sm mt-2 font-medium ${confidenceColor}`}>
                  Extraction confidence: {Math.round(result.confidence * 100)}%
                </p>
              )}
            </div>

            {result.flagged_fields && result.flagged_fields.length > 0 && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
                <p className="text-yellow-400 font-medium text-sm mb-2">
                  Low-confidence fields — please verify:
                </p>
                <ul className="space-y-1">
                  {result.flagged_fields.map((f) => (
                    <li key={f} className="text-yellow-300/80 text-xs font-mono bg-slate-800 rounded px-2 py-1">
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setResult(null)}
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
        ) : (
          /* Upload form */
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Date field */}
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-2">
                Sheet Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Image upload */}
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
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
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

            {/* Error message */}
            {result?.error && (
              <div className="bg-red-900/30 border border-red-700 rounded-xl p-4">
                <p className="text-red-400 text-sm">{result.error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || compressing || !file}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2"
            >
              {compressing ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Compressing…
                </>
              ) : loading ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing…
                </>
              ) : (
                'Submit Sheet'
              )}
            </button>

            <p className="text-slate-500 text-xs text-center">
              No login required. Data is saved automatically.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
