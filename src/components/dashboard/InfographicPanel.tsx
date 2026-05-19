'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import type { DashboardData, TowerName } from '@/types';
import { TOWERS, TOWER_COLORS, TOWER_TEXT_CLASSES, isAboveThreshold } from '@/lib/utils';
import TemplateA from '@/components/infographics/TemplateA';
import TemplateB from '@/components/infographics/TemplateB';
import TemplateC from '@/components/infographics/TemplateC';

interface Props {
  data: DashboardData;
}

export default function InfographicPanel({ data }: Props) {
  const [selectedTower, setSelectedTower] = useState<TowerName>('Venus');
  const [exporting, setExporting] = useState<string | null>(null);

  const refA = useRef<HTMLDivElement>(null);
  const refB = useRef<HTMLDivElement>(null);
  const refC = useRef<HTMLDivElement>(null);

  const alertTower = data.towers.find((t) =>
    isAboveThreshold(t.total_today, t.seven_day_avg, 15)
  );

  async function doExport(ref: React.RefObject<HTMLDivElement>, filename: string) {
    if (!ref.current) return;
    setExporting(filename);
    try {
      const dataUrl = await toPng(ref.current, {
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: false,
      });
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(null);
    }
  }

  const towerDataA = data.towers.find((t) => t.tower === selectedTower)!;
  const isLoadingA = exporting === `A-${selectedTower}`;
  const isLoadingB = exporting === 'B';
  const isLoadingC = exporting === 'C';

  return (
    <div className="space-y-3">
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
          <button
            onClick={() => doExport(refA, `tw-${selectedTower.toLowerCase()}-${data.date}.png`)}
            disabled={!!exporting}
            className="flex-shrink-0 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {isLoadingA ? (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              '↓'
            )}
            PNG
          </button>
        </div>
      </div>

      {/* Template B — Pie Chart */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-slate-300 text-sm font-medium">Tower Wise Pie Chart</p>
          <p className="text-slate-500 text-xs mt-0.5">All 4 towers, usage breakdown</p>
        </div>
        <button
          onClick={() => doExport(refB, `tw-pie-${data.date}.png`)}
          disabled={!!exporting}
          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          {isLoadingB ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            '↓'
          )}
          PNG
        </button>
      </div>

      {/* Template C — Alert Poster (only if triggered) */}
      {alertTower ? (
        <div className="bg-red-950/30 border border-red-800/50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-red-400 text-sm font-medium">Alert Poster</p>
            <p className="text-red-400/60 text-xs mt-0.5">
              {alertTower.tower} is above threshold
            </p>
          </div>
          <button
            onClick={() => doExport(refC, `tw-alert-${alertTower.tower.toLowerCase()}-${data.date}.png`)}
            disabled={!!exporting}
            className="bg-red-900 hover:bg-red-800 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {isLoadingC ? (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              '↓'
            )}
            PNG
          </button>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <p className="text-slate-500 text-sm">Alert Poster — no towers above 15% threshold today</p>
        </div>
      )}

      {/* Off-screen rendered infographics — must be in DOM for html-to-image */}
      <div className="infographic-offscreen" aria-hidden="true">
        <div ref={refA}>
          <TemplateA tower={towerDataA} date={data.date} />
        </div>
        <div ref={refB}>
          <TemplateB towers={data.towers} date={data.date} totalConsumption={data.total_consumption} />
        </div>
        {alertTower && (
          <div ref={refC}>
            <TemplateC tower={alertTower} date={data.date} />
          </div>
        )}
      </div>
    </div>
  );
}
