'use client';

import { useRef, useState, useCallback } from 'react';
import { toPng } from 'html-to-image';
import type { DashboardData, TowerName } from '@/types';
import { TOWERS, TOWER_COLORS, isAboveThreshold, formatDate, formatLitres } from '@/lib/utils';
import TemplateA from '@/components/infographics/TemplateA';
import TemplateB from '@/components/infographics/TemplateB';
import TemplateC from '@/components/infographics/TemplateC';

const WA_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.125.557 4.122 1.529 5.855L0 24l6.335-1.654A11.953 11.953 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.374l-.359-.214-3.722.972.992-3.624-.235-.372A9.818 9.818 0 1 1 12 21.818z" />
  </svg>
);

interface Props {
  data: DashboardData;
}

const GIF_FRAMES = 22;
const GIF_HOLD_FRAMES = 5;
const GIF_FRAME_DELAY = 130; // ms

async function captureFrames(
  ref: React.RefObject<HTMLDivElement>,
  setProgress: (p: number) => void,
): Promise<HTMLImageElement[]> {
  const frames: HTMLImageElement[] = [];
  for (let i = 0; i <= GIF_FRAMES; i++) {
    setProgress(i / GIF_FRAMES);
    // Two rAF cycles ensure React re-renders before capture
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const dataUrl = await toPng(ref.current!, { pixelRatio: 2, cacheBust: false });
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((r) => { img.onload = () => r(); });
    frames.push(img);
  }
  // Hold on final frame
  for (let i = 0; i < GIF_HOLD_FRAMES; i++) frames.push(frames[frames.length - 1]);
  return frames;
}

async function shareViaWhatsApp(
  ref: React.RefObject<HTMLDivElement>,
  filename: string,
  caption: string,
) {
  if (!ref.current) return;
  const dataUrl = await toPng(ref.current, { pixelRatio: 2, cacheBust: true });

  // Convert data URL to Blob/File
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: 'image/png' });

  const encoded = encodeURIComponent(caption);

  if (
    typeof navigator !== 'undefined' &&
    navigator.share &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    // Mobile: native share sheet — technician picks WhatsApp and image + text go together
    await navigator.share({ files: [file], text: caption });
  } else {
    // Desktop: download image then open WhatsApp Web with pre-filled text
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    link.click();
    window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener');
  }
}

export default function InfographicPanel({ data }: Props) {
  const [selectedTower, setSelectedTower] = useState<TowerName>('Venus');
  const [exporting, setExporting] = useState<string | null>(null);
  const [gifProgress, setGifProgress] = useState<number>(0);
  const [sharing, setSharing] = useState<string | null>(null);

  const [animProgressA, setAnimProgressA] = useState(1);
  const [animProgressB, setAnimProgressB] = useState(1);
  const [animProgressC, setAnimProgressC] = useState(1);

  const refA = useRef<HTMLDivElement>(null);
  const refB = useRef<HTMLDivElement>(null);
  const refC = useRef<HTMLDivElement>(null);

  const alertTower = data.towers.find((t) =>
    isAboveThreshold(t.total_today, t.seven_day_avg, 15)
  );

  const doExportPng = useCallback(
    async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
      if (!ref.current) return;
      setExporting(filename);
      try {
        const dataUrl = await toPng(ref.current, { pixelRatio: 2, cacheBust: true });
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
      } catch (err) {
        console.error('PNG export failed:', err);
      } finally {
        setExporting(null);
      }
    },
    [],
  );

  const doExportGif = useCallback(
    async (
      template: 'A' | 'B' | 'C',
      filename: string,
      ref: React.RefObject<HTMLDivElement>,
      setAnimP: (p: number) => void,
    ) => {
      if (!ref.current) return;
      const key = `gif-${template}`;
      setExporting(key);
      setGifProgress(0);

      try {
        // Reset to start of animation
        setAnimP(0);
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

        const frames = await captureFrames(ref, (p) => {
          setAnimP(p);
          setGifProgress(p);
        });

        // Encode with gif.js (dynamic import — browser only)
        const GIF = (await import('gif.js')).default;
        const gif = new GIF({
          workers: 2,
          quality: 8,
          workerScript: '/gif.worker.js',
          repeat: 0,
        });
        for (const img of frames) {
          gif.addFrame(img, { delay: GIF_FRAME_DELAY, copy: true });
        }

        await new Promise<void>((resolve, reject) => {
          gif.on('finished', (blob: Blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = filename;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
            resolve();
          });
          gif.on('error', (err: Error) => reject(err));
          gif.render();
        });
      } catch (err) {
        console.error('GIF export failed:', err);
      } finally {
        setAnimP(1);
        setExporting(null);
        setGifProgress(0);
      }
    },
    [],
  );

  const towerDataA = data.towers.find((t) => t.tower === selectedTower)!;
  const isExportingGif = exporting?.startsWith('gif-') ?? false;
  const gifPct = Math.round(gifProgress * 100);

  const doShare = useCallback(
    async (elRef: React.RefObject<HTMLDivElement>, filename: string, caption: string) => {
      const key = `share-${filename}`;
      setSharing(key);
      try {
        await shareViaWhatsApp(elRef, filename, caption);
      } catch (err) {
        // User cancelled native share — not an error worth surfacing
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('WhatsApp share failed:', err);
        }
      } finally {
        setSharing(null);
      }
    },
    [],
  );

  function ExportButtons({
    pngFile,
    gifFile,
    elRef,
    template,
    setAnimP,
    waCaption,
  }: {
    pngFile: string;
    gifFile: string;
    elRef: React.RefObject<HTMLDivElement>;
    template: 'A' | 'B' | 'C';
    setAnimP: (p: number) => void;
    waCaption: string;
  }) {
    const isPngBusy = exporting === pngFile;
    const isGifBusy = exporting === `gif-${template}`;
    const isShareBusy = sharing === `share-${pngFile}`;
    const busy = !!exporting || !!sharing;

    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => doShare(elRef, pngFile, waCaption)}
          disabled={busy}
          className="bg-[#075E54] hover:bg-[#128C7E] disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {isShareBusy ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            WA_ICON
          )}
          Share
        </button>
        <button
          onClick={() => doExportPng(elRef, pngFile)}
          disabled={busy}
          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {isPngBusy ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            '↓'
          )}
          PNG
        </button>
        <button
          onClick={() => doExportGif(template, gifFile, elRef, setAnimP)}
          disabled={busy}
          className="bg-indigo-900 hover:bg-indigo-800 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {isGifBusy ? (
            <span className="text-[10px] font-bold">{gifPct}%</span>
          ) : (
            '↓'
          )}
          GIF
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {isExportingGif && (
        <div className="bg-indigo-950/60 border border-indigo-700/40 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-indigo-300 text-xs font-medium">Capturing animation frames…</p>
            <p className="text-indigo-400 text-xs">{gifPct}%</p>
          </div>
          <div className="h-1.5 bg-indigo-950 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${gifPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Template A — Daily Tower Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <p className="text-slate-300 text-sm font-medium mb-3">Daily Tower Card</p>
        <div className="flex gap-2">
          <div className="flex-1 grid grid-cols-4 gap-1.5">
            {TOWERS.map((tower) => (
              <button
                key={tower}
                onClick={() => setSelectedTower(tower)}
                className="py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: selectedTower === tower ? TOWER_COLORS[tower] : '#1e293b',
                  color: selectedTower === tower ? '#fff' : '#94a3b8',
                  borderWidth: 1,
                  borderColor: selectedTower === tower ? TOWER_COLORS[tower] : '#334155',
                }}
              >
                {tower.slice(0, 3)}
              </button>
            ))}
          </div>
          <ExportButtons
            pngFile={`tw-${selectedTower.toLowerCase()}-${data.date}.png`}
            gifFile={`tw-${selectedTower.toLowerCase()}-${data.date}.gif`}
            elRef={refA}
            template="A"
            setAnimP={setAnimProgressA}
            waCaption={`🏢 Trinity World — ${selectedTower} Tower\n📅 ${formatDate(data.date)}\n💧 DO: ${formatLitres(towerDataA?.today_do)} | DR: ${formatLitres(towerDataA?.today_dr)}\n📊 Total: ${formatLitres(towerDataA?.total_today)}`}
          />
        </div>
      </div>

      {/* Template B — Pie Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-slate-300 text-sm font-medium">Tower Wise Pie Chart</p>
          <p className="text-slate-500 text-xs mt-0.5">All 4 towers, usage breakdown</p>
        </div>
        <ExportButtons
          pngFile={`tw-pie-${data.date}.png`}
          gifFile={`tw-pie-${data.date}.gif`}
          elRef={refB}
          template="B"
          setAnimP={setAnimProgressB}
          waCaption={`🏢 Trinity World — Daily Water Usage\n📅 ${formatDate(data.date)}\n💧 Total: ${formatLitres(data.total_consumption)}\n🔵 Venus | 🟢 Neptune | 🟠 Jupiter | 🔵 Mercury`}
        />
      </div>

      {/* Template C — Alert Poster */}
      {alertTower ? (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-red-400 text-sm font-medium">Alert Poster</p>
            <p className="text-red-400/60 text-xs mt-0.5">{alertTower.tower} is above threshold</p>
          </div>
          <ExportButtons
            pngFile={`tw-alert-${alertTower.tower.toLowerCase()}-${data.date}.png`}
            gifFile={`tw-alert-${alertTower.tower.toLowerCase()}-${data.date}.gif`}
            elRef={refC}
            template="C"
            setAnimP={setAnimProgressC}
            waCaption={`⚠️ Trinity World — Water Usage Alert\n📅 ${formatDate(data.date)}\n🚨 ${alertTower.tower} Tower is above threshold\n💧 Today: ${formatLitres(alertTower.total_today)} | Avg: ${formatLitres(alertTower.seven_day_avg)}`}
          />
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-500 text-sm">Alert Poster — no towers above 15% threshold today</p>
        </div>
      )}

      {/* Off-screen rendered infographics — must stay in DOM for html-to-image */}
      <div className="infographic-offscreen" aria-hidden="true">
        <div ref={refA}>
          <TemplateA tower={towerDataA} date={data.date} animProgress={animProgressA} />
        </div>
        <div ref={refB}>
          <TemplateB
            towers={data.towers}
            date={data.date}
            totalConsumption={data.total_consumption}
            animProgress={animProgressB}
          />
        </div>
        {alertTower && (
          <div ref={refC}>
            <TemplateC tower={alertTower} date={data.date} animProgress={animProgressC} />
          </div>
        )}
      </div>
    </div>
  );
}
