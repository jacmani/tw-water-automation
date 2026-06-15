import type { SheetRecord } from './types';
import type { TowerName } from '@/types';

const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];
const METER_TYPES = ['DO', 'DR'] as const;

function esc(s: string): string {
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function buildCsv(sheets: SheetRecord[], towerFilter: TowerName | 'All'): string {
  const activeTowers = towerFilter === 'All' ? TOWERS : [towerFilter];

  // Collect all unique source locations across the range (sorted for stable columns)
  const srcLocations = Array.from(
    new Set(sheets.flatMap(s => s.water_sources.map(w => w.location)))
  ).sort();

  const towerCols = activeTowers.flatMap(t => METER_TYPES.map(m => `${t} ${m}`));
  const confCols = activeTowers.flatMap(t => METER_TYPES.map(m => `${t} ${m} confidence`));

  const header = [
    'date', 'flag',
    'input_total', 'tower_usage', 'diff',
    ...srcLocations,
    ...towerCols,
    ...confCols,
  ];

  const dataRows = sheets.map(s => {
    const sum = s.summary;
    const srcMap = new Map(s.water_sources.map(w => [w.location, w.total]));
    const tcMap = new Map(s.tower_consumption.map(r => [`${r.tower} ${r.type}`, r]));

    return [
      s.date,
      s.flag.label,
      String(sum?.input_total ?? ''),
      String(sum?.tower_usage ?? ''),
      String(sum?.diff ?? ''),
      ...srcLocations.map(loc => String(srcMap.get(loc) ?? '')),
      ...towerCols.map(col => String(tcMap.get(col)?.total_ltrs ?? '')),
      ...confCols.map(col => {
        const key = col.replace(' confidence', '');
        return String(tcMap.get(key)?.confidence ?? '');
      }),
    ];
  });

  return [header, ...dataRows]
    .map(row => row.map(esc).join(','))
    .join('\n');
}

export function downloadCsv(csv: string, start: string, end: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trinity-water-history_${start}_to_${end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
