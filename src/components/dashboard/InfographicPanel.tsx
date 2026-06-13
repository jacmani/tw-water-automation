'use client';

import { useRef, useState, useCallback } from 'react';
import { toPng } from 'html-to-image';
import type { DashboardData, TowerName } from '@/types';
import { TOWERS, TOWER_COLORS, isAboveThreshold } from '@/lib/utils';
import TemplateA from '@/components/infographics/TemplateA';
import TemplateB from '@/components/infographics/TemplateB';
import TemplateC from '@/components/infographics/TemplateC';

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

export default function InfographicPanel({ data }: Props) {
  const [selectedTower, setSelectedTower] = useState<TowerName>('Venus');
  const [exporting, setExporting] = useState<string | null>(null);
  const [gifProgress, setGifProgress] = useState<number>(0);

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

  function ExportButtons({
    pngFile,
    gifFile,
    ref,
    template,
    setAnimP,
  }: {
    pngFile: string;
    gifFile: string;
    ref: React.RefObject<HTMLDivElement>;
    template: 'A' | 'B' | 'C';
    setAnimP: (p: number) => void;
  }) {
    const isPngBusy = exporting === pngFile;
    const isGifBusy = exporting === `gif-${template}`;
    const busy = !!exporting;

    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => doExportPng(ref, pngFile)}
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
          onClick={() => doExportGif(template, gifFile, ref, setAnimP)}
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
            ref={refA}
            template="A"
            setAnimP={setAnimProgressA}
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
          ref={refB}
          template="B"
          setAnimP={setAnimProgressB}
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
            ref={refC}
            template="C"
            setAnimP={setAnimProgressC}
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
