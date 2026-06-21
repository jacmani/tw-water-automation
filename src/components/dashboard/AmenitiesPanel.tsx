import type { AmenityMeterReading } from '@/types';

// Amenity meter readings are in kilolitres (kL), not litres
function fmtKL(v: number | null | undefined): string {
  if (v == null) return '—';
  return `${v.toLocaleString('en-IN')} kL`;
}

interface Props {
  data: AmenityMeterReading[];
}

const LOC_LABEL: Record<string, string> = {
  jupiter: 'Jupiter', mercury: 'Mercury', venus: 'Venus', neptune: 'Neptune',
  meter_1: 'Meter 1', meter_2: 'Meter 2', meter_3: 'Meter 3',
};

export default function AmenitiesPanel({ data }: Props) {
  if (!data.length) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">Amenities</p>
        <p className="text-slate-400 dark:text-slate-600 text-sm">No amenity data for this date</p>
      </div>
    );
  }

  const carWash = data.filter((r) => r.amenity_type === 'Car Wash');
  const pool = data.filter((r) => r.amenity_type === 'Swimming Pool');
  const carWashTotal = carWash.reduce((s, r) => s + (r.consumption ?? 0), 0);
  const poolTotal = pool.reduce((s, r) => s + (r.consumption ?? 0), 0);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
      <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">Amenities</p>
      <div className="grid grid-cols-2 gap-3">
        {carWash.length > 0 && (
          <div>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-2">Car Wash</p>
            <div className="space-y-1">
              {carWash.map((r) => (
                <div key={r.location} className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{LOC_LABEL[r.location] ?? r.location}</span>
                  <span className="text-slate-700 dark:text-slate-300">{fmtKL(r.consumption)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs font-semibold">
              <span className="text-slate-500 dark:text-slate-400">Total</span>
              <span className="text-slate-900 dark:text-white">{fmtKL(carWashTotal)}</span>
            </div>
          </div>
        )}
        {pool.length > 0 && (
          <div>
            <p className="text-slate-400 dark:text-slate-500 text-xs mb-2">Swimming Pool</p>
            <div className="space-y-1">
              {pool.map((r) => (
                <div key={r.location} className="flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{LOC_LABEL[r.location] ?? r.location}</span>
                  <span className="text-slate-700 dark:text-slate-300">{fmtKL(r.consumption)}</span>
                </div>
              ))}
            </div>
            <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex justify-between text-xs font-semibold">
              <span className="text-slate-500 dark:text-slate-400">Total</span>
              <span className="text-slate-900 dark:text-white">{fmtKL(poolTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
