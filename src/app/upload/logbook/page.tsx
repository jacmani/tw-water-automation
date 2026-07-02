'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOWERS = ['Venus', 'Mercury', 'Neptune', 'Jupiter'] as const;
const METER_TYPES = ['DO', 'DR'] as const;

const SOURCE_NAMES = [
  'mercury_venus_tanker',
  'jupiter_neptune_tanker',
  'venus_side_well_123',
  'venus_side_well_4',
  'neptune_side_well_5',
  'neptune_side_well_6',
  'open_well',
] as const;

const SOURCE_LABELS: Record<string, string> = {
  mercury_venus_tanker: 'M+V Tanker',
  jupiter_neptune_tanker: 'J+N Tanker',
  venus_side_well_123: 'Venus Well 1+2+3',
  venus_side_well_4: 'Venus Well 4',
  neptune_side_well_5: 'Neptune Well 5',
  neptune_side_well_6: 'Neptune Well 6',
  open_well: 'Open Well',
};

const CAR_WASH_LOCS = ['jupiter', 'mercury', 'venus', 'neptune'] as const;
const POOL_LOCS = ['meter_1', 'meter_2', 'meter_3'] as const;
const LOC_LABELS: Record<string, string> = {
  jupiter: 'Jupiter', mercury: 'Mercury', venus: 'Venus', neptune: 'Neptune',
  meter_1: 'Meter 1', meter_2: 'Meter 2', meter_3: 'Meter 3',
};

const WATER_LEVEL_SLOTS = ['06:00', '12:00', '18:00', '00:00'] as const;
const SLOT_LABELS: Record<string, string> = { '06:00': '6 AM', '12:00': '12 PM', '18:00': '6 PM', '00:00': '12 AM' };

const SECTIONS = [
  'Header',
  'Tower Meters',
  'Input Sources',
  'Car Wash',
  'Swimming Pool',
  'Water Levels',
  'Utilities',
  'Inflow Summary',
] as const;
type Section = typeof SECTIONS[number];

// ─── State shape ──────────────────────────────────────────────────────────────

interface TowerRow { yesterday_reading: string; today_reading: string; consumption_yesterday: string; consumption_today: string }
interface SourceRow { yesterday_reading: string; today_reading: string; consumption_yesterday: string; consumption_today: string }
interface AmenityRow { yesterday: string; today: string; cumulative: string }
interface WaterLevelRow {
  jupiter_do: string; jupiter_dr: string; collection_tank: string;
  mercury_do: string; mercury_dr: string;
  cumulative_j: string; cumulative_m: string; cumulative_v: string; cumulative_n: string; cumulative_total: string;
}
interface UtilityRow {
  p_hall_meter_1: string; p_hall_meter_2: string;
  wtp_1: string; wtp_2: string; venus_side_uf: string; total_tankers: string;
  consumption_yesterday: string; consumption_today: string;
}
interface InflowRow {
  water_inflow: string; well_inflow: string; tanker_inflow: string;
  total_usage: string;
  cumulative_water: string; cumulative_well: string; cumulative_tanker: string;
  cumulative_total_usage: string;
}

function emptyTower(): TowerRow { return { yesterday_reading: '', today_reading: '', consumption_yesterday: '', consumption_today: '' }; }
function emptySource(): SourceRow { return { yesterday_reading: '', today_reading: '', consumption_yesterday: '', consumption_today: '' }; }
function emptyAmenity(): AmenityRow { return { yesterday: '', today: '', cumulative: '' }; }
function emptyLevel(): WaterLevelRow {
  return { jupiter_do: '', jupiter_dr: '', collection_tank: '', mercury_do: '', mercury_dr: '', cumulative_j: '', cumulative_m: '', cumulative_v: '', cumulative_n: '', cumulative_total: '' };
}

function initForm() {
  const tower_readings: Record<string, TowerRow> = {};
  for (const t of TOWERS) for (const m of METER_TYPES) tower_readings[`${t}_${m}`] = emptyTower();

  const source_readings: Record<string, SourceRow> = {};
  for (const s of SOURCE_NAMES) source_readings[s] = emptySource();

  const amenity_readings: Record<string, AmenityRow> = {};
  for (const l of CAR_WASH_LOCS) amenity_readings[`car_wash_${l}`] = emptyAmenity();
  for (const l of POOL_LOCS) amenity_readings[`swimming_pool_${l}`] = emptyAmenity();

  const water_levels: Record<string, WaterLevelRow> = {};
  for (const s of WATER_LEVEL_SLOTS) water_levels[s] = emptyLevel();

  const utility_meters: UtilityRow = { p_hall_meter_1: '', p_hall_meter_2: '', wtp_1: '', wtp_2: '', venus_side_uf: '', total_tankers: '', consumption_yesterday: '', consumption_today: '' };
  const inflow_summary: InflowRow = { water_inflow: '', well_inflow: '', tanker_inflow: '', total_usage: '', cumulative_water: '', cumulative_well: '', cumulative_tanker: '', cumulative_total_usage: '' };

  return {
    log_date: new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0],
    technician_name: '',
    fm_signed: false,
    tower_readings,
    source_readings,
    amenity_readings,
    water_levels,
    utility_meters,
    inflow_summary,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function n(v: string): number | null {
  const trimmed = v.trim();
  if (!trimmed) return null;
  const x = parseFloat(trimmed);
  return isNaN(x) ? null : x;
}
function autoCalc(a: string, b: string, op: '+' | '-' = '-'): string {
  const av = n(a), bv = n(b);
  if (av == null || bv == null) return '';
  return op === '-' ? String((av - bv).toFixed(2)) : String((av + bv).toFixed(2));
}
function autoSum(...vals: string[]): string {
  const nums = vals.map(n).filter((v): v is number => v !== null);
  if (nums.length === 0) return '';
  return String(nums.reduce((a, b) => a + b, 0).toFixed(2));
}

// ─── UI primitives ───────────────────────────────────────────────────────────

function Field({ label, value, onChange, computed }: {
  label: string; value: string;
  onChange?: (v: string) => void;
  computed?: boolean;
}) {
  return (
    <div>
      <label className="block text-slate-500 text-xs mb-0.5">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        readOnly={computed}
        onChange={computed ? undefined : (e) => onChange?.(e.target.value)}
        placeholder={computed ? '—' : '0'}
        className={`w-full rounded-lg px-2.5 py-2 text-sm border text-right tabular-nums
          ${computed
            ? 'bg-slate-800/50 border-slate-700 text-slate-500 cursor-default'
            : 'bg-slate-800 border-slate-700 text-white focus:border-blue-500 focus:outline-none'
          }`}
      />
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-4 mt-1">{title}</p>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LogbookEntryPage() {
  const [form, setForm] = useState(initForm);
  const [section, setSection] = useState<Section>('Header');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<'draft' | 'submitted' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateTower = useCallback((key: string, field: keyof TowerRow, value: string) => {
    setForm((prev) => ({
      ...prev,
      tower_readings: { ...prev.tower_readings, [key]: { ...prev.tower_readings[key], [field]: value } },
    }));
  }, []);

  const updateSource = useCallback((key: string, field: keyof SourceRow, value: string) => {
    setForm((prev) => ({
      ...prev,
      source_readings: { ...prev.source_readings, [key]: { ...prev.source_readings[key], [field]: value } },
    }));
  }, []);

  const updateAmenity = useCallback((key: string, field: keyof AmenityRow, value: string) => {
    setForm((prev) => ({
      ...prev,
      amenity_readings: { ...prev.amenity_readings, [key]: { ...prev.amenity_readings[key], [field]: value } },
    }));
  }, []);

  const updateLevel = useCallback((slot: string, field: keyof WaterLevelRow, value: string) => {
    setForm((prev) => ({
      ...prev,
      water_levels: { ...prev.water_levels, [slot]: { ...prev.water_levels[slot], [field]: value } },
    }));
  }, []);

  const updateUtil = useCallback((field: keyof UtilityRow, value: string) => {
    setForm((prev) => ({ ...prev, utility_meters: { ...prev.utility_meters, [field]: value } }));
  }, []);

  const updateInflow = useCallback((field: keyof InflowRow, value: string) => {
    setForm((prev) => ({ ...prev, inflow_summary: { ...prev.inflow_summary, [field]: value } }));
  }, []);

  async function save(fmSigned: boolean) {
    setSaving(true);
    setError(null);
    setSaved(null);

    const towerRows = Object.entries(form.tower_readings).map(([key, r]) => {
      const [tower, meter_type] = key.split('_');
      const total_in_ltrs = autoCalc(r.today_reading, r.yesterday_reading, '-');
      const difference = autoCalc(r.consumption_today, r.consumption_yesterday, '-');
      return { tower, meter_type, ...r, total_in_ltrs, difference };
    });

    const sourceRows = Object.entries(form.source_readings).map(([source_name, r]) => {
      const total = autoSum(r.consumption_yesterday, r.consumption_today);
      return { source_name, ...r, total };
    });

    const amenityRows = Object.entries(form.amenity_readings).map(([key, r]) => {
      // Keys are "car_wash_jupiter", "swimming_pool_meter_1" etc — can't split on first '_'
      // because both prefixes contain underscores.
      let amenity_type: string;
      let location: string;
      if (key.startsWith('car_wash_')) {
        amenity_type = 'Car Wash';
        // e.g. "car_wash_jupiter" → "Jupiter"
        const loc = key.slice('car_wash_'.length);
        location = loc.charAt(0).toUpperCase() + loc.slice(1);
      } else if (key.startsWith('swimming_pool_')) {
        amenity_type = 'Swimming Pool';
        // e.g. "swimming_pool_meter_1" → "Meter 1"
        const loc = key.slice('swimming_pool_'.length).replace('meter_', 'Meter ');
        location = loc;
      } else {
        amenity_type = key;
        location = key;
      }
      const consumption = autoCalc(r.today, r.yesterday, '-');
      return { amenity_type, location, ...r, consumption };
    });

    const levelRows = Object.entries(form.water_levels).map(([time_slot, r]) => ({ time_slot, ...r }));

    const util = form.utility_meters;
    const utilPayload = { ...util, consumption_total: autoSum(util.consumption_yesterday, util.consumption_today) };

    const inf = form.inflow_summary;
    const total_collection = autoSum(inf.water_inflow, inf.well_inflow, inf.tanker_inflow);
    const balance = n(total_collection) != null && n(inf.total_usage) != null
      ? String((n(total_collection)! - n(inf.total_usage)!).toFixed(2)) : '';
    const cumulative_total_collection = autoSum(inf.cumulative_water, inf.cumulative_well, inf.cumulative_tanker);
    const cumulative_balance = n(cumulative_total_collection) != null && n(inf.cumulative_total_usage) != null
      ? String((n(cumulative_total_collection)! - n(inf.cumulative_total_usage)!).toFixed(2)) : '';
    const inflowPayload = { ...inf, total_collection, balance, cumulative_total_collection, cumulative_balance };

    try {
      const res = await fetch('/api/logbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          log_date: form.log_date,
          technician_name: form.technician_name || null,
          fm_signed: fmSigned,
          tower_readings: towerRows,
          source_readings: sourceRows,
          amenity_readings: amenityRows,
          water_levels: levelRows,
          utility_meters: utilPayload,
          inflow_summary: inflowPayload,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? 'Save failed');
      } else {
        setSaved(fmSigned ? 'submitted' : 'draft');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const sectionIdx = SECTIONS.indexOf(section);
  const isFirst = sectionIdx === 0;
  const isLast = sectionIdx === SECTIONS.length - 1;

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-xl mx-auto flex items-center gap-3">
          <Link href="/upload" className="text-slate-400 hover:text-white transition-colors shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-white leading-tight truncate">Log Book Entry</h1>
            <p className="text-slate-400 text-xs">Trinity World Water Consumption</p>
          </div>
          {saved && (
            <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${saved === 'submitted' ? 'bg-emerald-900 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
              {saved === 'submitted' ? 'Submitted' : 'Draft saved'}
            </span>
          )}
        </div>
      </header>

      {/* Section tabs */}
      <div className="bg-slate-900 border-b border-slate-800 overflow-x-auto scrollbar-hide">
        <div className="flex px-4 gap-1 max-w-xl mx-auto py-1">
          {SECTIONS.map((s, i) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap
                ${section === s ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 max-w-xl mx-auto w-full px-4 py-5">

        {/* ── Header ── */}
        {section === 'Header' && (
          <div className="space-y-4">
            <SectionHeader title="Log Book Header" />
            <div>
              <label className="block text-slate-400 text-sm font-medium mb-1">Date</label>
              <input
                type="date"
                value={form.log_date}
                onChange={(e) => setForm((p) => ({ ...p, log_date: e.target.value }))}
                className="w-full rounded-xl px-3 py-3 bg-slate-800 border border-slate-700 text-white text-sm focus:border-blue-500 focus:outline-none"
              />
              <p className="text-slate-500 text-xs mt-1">{form.log_date ? formatDate(form.log_date) : ''}</p>
            </div>
            <div>
              <label className="block text-slate-400 text-sm font-medium mb-1">Technician Name</label>
              <input
                type="text"
                value={form.technician_name}
                onChange={(e) => setForm((p) => ({ ...p, technician_name: e.target.value }))}
                placeholder="Enter technician name"
                className="w-full rounded-xl px-3 py-3 bg-slate-800 border border-slate-700 text-white text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.fm_signed}
                onChange={(e) => setForm((p) => ({ ...p, fm_signed: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <span className="text-slate-300 text-sm">FM Signed</span>
            </label>
          </div>
        )}

        {/* ── Tower Meters ── */}
        {section === 'Tower Meters' && (
          <div className="space-y-5">
            <SectionHeader title="Tower Meter Readings" />
            {TOWERS.map((tower) =>
              METER_TYPES.map((mt) => {
                const key = `${tower}_${mt}`;
                const r = form.tower_readings[key];
                const totalCalc = autoCalc(r.today_reading, r.yesterday_reading, '-');
                const diffCalc = autoCalc(r.consumption_today, r.consumption_yesterday, '-');
                return (
                  <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                    <p className="text-sm font-semibold text-white mb-3">
                      {tower} <span className="text-slate-400">{mt}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Yesterday Reading" value={r.yesterday_reading} onChange={(v) => updateTower(key, 'yesterday_reading', v)} />
                      <Field label="Today Reading" value={r.today_reading} onChange={(v) => updateTower(key, 'today_reading', v)} />
                      <Field label="Total in Ltrs" value={totalCalc || r.today_reading} computed />
                      <Field label="Cons. Yesterday" value={r.consumption_yesterday} onChange={(v) => updateTower(key, 'consumption_yesterday', v)} />
                      <Field label="Cons. Today" value={r.consumption_today} onChange={(v) => updateTower(key, 'consumption_today', v)} />
                      <Field label="Difference" value={diffCalc} computed />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Input Sources ── */}
        {section === 'Input Sources' && (
          <div className="space-y-5">
            <SectionHeader title="Input Source Readings" />
            {SOURCE_NAMES.map((src) => {
              const r = form.source_readings[src];
              const total = autoSum(r.consumption_yesterday, r.consumption_today);
              return (
                <div key={src} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-white mb-3">{SOURCE_LABELS[src]}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Yesterday Reading" value={r.yesterday_reading} onChange={(v) => updateSource(src, 'yesterday_reading', v)} />
                    <Field label="Today Reading" value={r.today_reading} onChange={(v) => updateSource(src, 'today_reading', v)} />
                    <Field label="Cons. Yesterday" value={r.consumption_yesterday} onChange={(v) => updateSource(src, 'consumption_yesterday', v)} />
                    <Field label="Cons. Today" value={r.consumption_today} onChange={(v) => updateSource(src, 'consumption_today', v)} />
                    <Field label="Total" value={total} computed />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Car Wash ── */}
        {section === 'Car Wash' && (
          <div className="space-y-5">
            <SectionHeader title="Car Wash Meters" />
            {CAR_WASH_LOCS.map((loc) => {
              const key = `car_wash_${loc}`;
              const r = form.amenity_readings[key];
              const cons = autoCalc(r.today, r.yesterday, '-');
              return (
                <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-white mb-3">{LOC_LABELS[loc]}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Yesterday" value={r.yesterday} onChange={(v) => updateAmenity(key, 'yesterday', v)} />
                    <Field label="Today" value={r.today} onChange={(v) => updateAmenity(key, 'today', v)} />
                    <Field label="Consumption" value={cons} computed />
                    <Field label="Cumulative" value={r.cumulative} onChange={(v) => updateAmenity(key, 'cumulative', v)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Swimming Pool ── */}
        {section === 'Swimming Pool' && (
          <div className="space-y-5">
            <SectionHeader title="Swimming Pool Meters" />
            {POOL_LOCS.map((loc) => {
              const key = `swimming_pool_${loc}`;
              const r = form.amenity_readings[key];
              const cons = autoCalc(r.today, r.yesterday, '-');
              return (
                <div key={key} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-white mb-3">{LOC_LABELS[loc]}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Yesterday" value={r.yesterday} onChange={(v) => updateAmenity(key, 'yesterday', v)} />
                    <Field label="Today" value={r.today} onChange={(v) => updateAmenity(key, 'today', v)} />
                    <Field label="Consumption" value={cons} computed />
                    <Field label="Cumulative" value={r.cumulative} onChange={(v) => updateAmenity(key, 'cumulative', v)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Water Levels ── */}
        {section === 'Water Levels' && (
          <div className="space-y-5">
            <SectionHeader title="Water Level Readings (%)" />
            {WATER_LEVEL_SLOTS.map((slot) => {
              const r = form.water_levels[slot];
              return (
                <div key={slot} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-white mb-3">{SLOT_LABELS[slot]}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Jupiter DO %" value={r.jupiter_do} onChange={(v) => updateLevel(slot, 'jupiter_do', v)} />
                    <Field label="Jupiter DR %" value={r.jupiter_dr} onChange={(v) => updateLevel(slot, 'jupiter_dr', v)} />
                    <Field label="Collection Tank %" value={r.collection_tank} onChange={(v) => updateLevel(slot, 'collection_tank', v)} />
                    <Field label="Mercury DO %" value={r.mercury_do} onChange={(v) => updateLevel(slot, 'mercury_do', v)} />
                    <Field label="Mercury DR %" value={r.mercury_dr} onChange={(v) => updateLevel(slot, 'mercury_dr', v)} />
                    <Field label="Cumulative J" value={r.cumulative_j} onChange={(v) => updateLevel(slot, 'cumulative_j', v)} />
                    <Field label="Cumulative M" value={r.cumulative_m} onChange={(v) => updateLevel(slot, 'cumulative_m', v)} />
                    <Field label="Cumulative V" value={r.cumulative_v} onChange={(v) => updateLevel(slot, 'cumulative_v', v)} />
                    <Field label="Cumulative N" value={r.cumulative_n} onChange={(v) => updateLevel(slot, 'cumulative_n', v)} />
                    <Field label="Cumulative Total" value={r.cumulative_total} onChange={(v) => updateLevel(slot, 'cumulative_total', v)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Utility Meters ── */}
        {section === 'Utilities' && (
          <div className="space-y-5">
            <SectionHeader title="Utility Meter Readings" />
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-white mb-3">Party Hall</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="P. Hall Meter 1" value={form.utility_meters.p_hall_meter_1} onChange={(v) => updateUtil('p_hall_meter_1', v)} />
                <Field label="P. Hall Meter 2" value={form.utility_meters.p_hall_meter_2} onChange={(v) => updateUtil('p_hall_meter_2', v)} />
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-white mb-3">WTP / UF</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="WTP 1" value={form.utility_meters.wtp_1} onChange={(v) => updateUtil('wtp_1', v)} />
                <Field label="WTP 2" value={form.utility_meters.wtp_2} onChange={(v) => updateUtil('wtp_2', v)} />
                <Field label="Venus Side UF" value={form.utility_meters.venus_side_uf} onChange={(v) => updateUtil('venus_side_uf', v)} />
                <Field label="Total Tankers" value={form.utility_meters.total_tankers} onChange={(v) => updateUtil('total_tankers', v)} />
              </div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-white mb-3">Consumption</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Consumption Yesterday" value={form.utility_meters.consumption_yesterday} onChange={(v) => updateUtil('consumption_yesterday', v)} />
                <Field label="Consumption Today" value={form.utility_meters.consumption_today} onChange={(v) => updateUtil('consumption_today', v)} />
                <Field label="Total" value={autoSum(form.utility_meters.consumption_yesterday, form.utility_meters.consumption_today)} computed />
              </div>
            </div>
          </div>
        )}

        {/* ── Inflow Summary ── */}
        {section === 'Inflow Summary' && (
          <div className="space-y-5">
            <SectionHeader title="Daily Inflow Summary" />
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-white mb-3">Today&apos;s Inflow</p>
              {(() => {
                const inf = form.inflow_summary;
                const total_collection = autoSum(inf.water_inflow, inf.well_inflow, inf.tanker_inflow);
                const balanceNum = n(total_collection) != null && n(inf.total_usage) != null
                  ? (n(total_collection)! - n(inf.total_usage)!).toFixed(2) : '';
                return (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Water Inflow" value={inf.water_inflow} onChange={(v) => updateInflow('water_inflow', v)} />
                    <Field label="Well Inflow" value={inf.well_inflow} onChange={(v) => updateInflow('well_inflow', v)} />
                    <Field label="Tanker Inflow" value={inf.tanker_inflow} onChange={(v) => updateInflow('tanker_inflow', v)} />
                    <Field label="Total Collection" value={total_collection} computed />
                    <Field label="Total Usage" value={inf.total_usage} onChange={(v) => updateInflow('total_usage', v)} />
                    <Field label="Balance" value={balanceNum} computed />
                  </div>
                );
              })()}
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-white mb-3">Cumulative</p>
              {(() => {
                const inf = form.inflow_summary;
                const cumTotal = autoSum(inf.cumulative_water, inf.cumulative_well, inf.cumulative_tanker);
                const cumBalance = n(cumTotal) != null && n(inf.cumulative_total_usage) != null
                  ? (n(cumTotal)! - n(inf.cumulative_total_usage)!).toFixed(2) : '';
                return (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Cumulative Water" value={inf.cumulative_water} onChange={(v) => updateInflow('cumulative_water', v)} />
                    <Field label="Cumulative Well" value={inf.cumulative_well} onChange={(v) => updateInflow('cumulative_well', v)} />
                    <Field label="Cumulative Tanker" value={inf.cumulative_tanker} onChange={(v) => updateInflow('cumulative_tanker', v)} />
                    <Field label="Cum. Total Collection" value={cumTotal} computed />
                    <Field label="Cum. Total Usage" value={inf.cumulative_total_usage} onChange={(v) => updateInflow('cumulative_total_usage', v)} />
                    <Field label="Cum. Balance" value={cumBalance} computed />
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-700 rounded-xl p-3">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Navigation + save buttons */}
        <div className="mt-6 space-y-3">
          <div className="flex gap-3">
            {!isFirst && (
              <button
                onClick={() => setSection(SECTIONS[sectionIdx - 1])}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium text-sm transition-colors"
              >
                ← Prev
              </button>
            )}
            {!isLast && (
              <button
                onClick={() => setSection(SECTIONS[sectionIdx + 1])}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white py-3 rounded-xl font-medium text-sm transition-colors"
              >
                Next →
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => save(false)}
              disabled={saving}
              className="flex-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white py-3 rounded-xl font-medium text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            <button
              onClick={() => save(true)}
              disabled={saving}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-3 rounded-xl font-semibold text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Submit'}
            </button>
          </div>
          {saved && (
            <Link
              href={`/logbook?date=${form.log_date}`}
              className="block text-center text-blue-400 hover:text-blue-300 text-sm transition-colors py-1"
            >
              View log entry →
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
