/**
 * One-time backfill: mirror existing photo-upload data (daily_sheets model) into the
 * logbook data model (daily_log + child tables) so the /logbook page shows historical
 * uploads, not just ones saved after the mirror feature shipped.
 *
 * Uses the SAME field mapping and upsert conflict keys as mirrorToLogbook() in
 * src/app/api/upload/confirm/route.ts, so re-running is idempotent and converges with
 * any manual logbook edits rather than duplicating.
 *
 * Run:  node scripts/backfill-logbook.mjs            (dry run — shows what it would write)
 *       node scripts/backfill-logbook.mjs --commit   (actually writes)
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 * (or .env.local — this script reads it).
 */
import { readFileSync } from 'node:fs';

// ── Load env from .env.local if present ─────────────────────────────────────
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* env vars may already be set */ }

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COMMIT = process.argv.includes('--commit');

if (!URL_BASE || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function get(path) {
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
  return r.json();
}
async function upsert(table, conflict, body) {
  const r = await fetch(`${URL_BASE}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`UPSERT ${table} → ${r.status} ${await r.text()}`);
}

function sourceSlug(location) {
  const l = (location ?? '').toLowerCase();
  if (l.includes('m+v') || l.includes('mtr')) return 'mercury_venus_tanker';
  if (l.includes('j+n') || l.includes('jtr')) return 'jupiter_neptune_tanker';
  if (l.includes('well 1') || l.includes('1+2+3')) return 'venus_side_well_123';
  if (l.includes('well 4') || l.includes('4+b1') || l.includes('b1+b2')) return 'venus_side_well_4';
  if (l.includes('well 5')) return 'neptune_side_well_5';
  if (l.includes('well 6')) return 'neptune_side_well_6';
  if (l.includes('open') || l.includes('outside')) return 'open_well';
  return null;
}

async function main() {
  console.log(`\n=== Logbook backfill ${COMMIT ? '(COMMIT)' : '(DRY RUN)'} ===\n`);

  // Canonical sheets only (newest per date).
  const sheets = await get('daily_sheets?superseded=eq.false&processed_status=eq.processed&select=id,date&order=date.asc');
  console.log(`Found ${sheets.length} canonical processed sheet(s).\n`);

  for (const sheet of sheets) {
    const date = sheet.date;
    const [tc, ws, levels, amenities, summaryArr] = await Promise.all([
      get(`tower_consumption?sheet_id=eq.${sheet.id}&select=*`),
      get(`water_sources?sheet_id=eq.${sheet.id}&select=*`),
      get(`water_levels?sheet_id=eq.${sheet.id}&select=*`),
      get(`amenities?sheet_id=eq.${sheet.id}&select=*`),
      get(`summary?sheet_id=eq.${sheet.id}&select=*`),
    ]);
    const summary = summaryArr[0] ?? null;

    const towerRows = tc.map((d) => ({
      log_date: date, tower: d.tower, meter_type: d.type,
      yesterday_reading: d.r_yesterday, today_reading: d.r_today,
      total_in_ltrs: d.total_ltrs, consumption_yesterday: d.vol_yesterday,
      consumption_today: d.vol_today, difference: d.diff,
    }));

    const srcRows = ws.map((s) => {
      const slug = sourceSlug(s.location);
      return slug ? {
        log_date: date, source_name: slug,
        yesterday_reading: s.r_yesterday, today_reading: s.r_today,
        consumption_yesterday: s.yesterday_ltrs, consumption_today: s.today_ltrs, total: s.total,
      } : null;
    }).filter(Boolean);

    const normLoc = (name) => {
      if (!name) return null;
      const t = String(name).trim();
      if (['Jupiter', 'Mercury', 'Venus', 'Neptune'].includes(t)) return t;
      const m = t.match(/meter[\s-]*([1-7])/i);
      return m ? `Meter ${m[1]}` : null;
    };
    const amenityRows = amenities
      .filter((a) => a.section === 'Car Wash' || a.section === 'Swimming Pool')
      .map((a) => ({
        log_date: date, amenity_type: a.section, location: normLoc(a.meter_name),
        yesterday: a.y_day, today: a.r_day, consumption: a.diff, cumulative: null,
      }))
      .filter((r) => r.location !== null);

    const bySlot = {};
    for (const lvl of levels) {
      const slot = lvl.time_slot; // already '6AM'/'12PM'/'6PM'/'12AM'
      if (!['6AM', '12PM', '6PM', '12AM'].includes(slot)) continue;
      bySlot[slot] = bySlot[slot] || {};
      const pct = lvl.percentage ?? null;
      if (lvl.tank === 'JDO') bySlot[slot].jupiter_do = pct;
      else if (lvl.tank === 'JDR') bySlot[slot].jupiter_dr = pct;
      else if (lvl.tank === 'CT') bySlot[slot].collection_tank = pct;
      else if (lvl.tank === 'MDO') bySlot[slot].mercury_do = pct;
      else if (lvl.tank === 'MDR') bySlot[slot].mercury_dr = pct;
    }
    const levelRows = Object.entries(bySlot).map(([time_slot, cols]) => ({ log_date: date, time_slot, ...cols }));

    console.log(`${date}: towers=${towerRows.length} sources=${srcRows.length} amenities=${amenityRows.length} levels=${levelRows.length} summary=${summary ? 'yes' : 'no'}`);

    if (!COMMIT) continue;

    await upsert('daily_log', 'log_date', { log_date: date, updated_at: new Date().toISOString() });
    if (towerRows.length) await upsert('tower_meter_readings', 'log_date,tower,meter_type', towerRows);
    if (srcRows.length) await upsert('input_source_readings', 'log_date,source_name', srcRows);
    if (amenityRows.length) await upsert('amenity_meter_readings', 'log_date,amenity_type,location', amenityRows);
    if (levelRows.length) await upsert('water_level_readings', 'log_date,time_slot', levelRows);
    if (summary) {
      // Prefer the new sheet-accurate columns; fall back to legacy math for old rows
      // that predate migration 008 (they only have v_side/n_side/jtr/mtr).
      await upsert('daily_inflow_summary', 'log_date', {
        log_date: date,
        water_inflow: summary.water_inflow ?? null,
        well_inflow: summary.well_inflow ?? ((summary.v_side ?? 0) + (summary.n_side ?? 0)) || null,
        tanker_inflow: summary.tanker_inflow ?? ((summary.jtr_tanker ?? 0) + (summary.mtr_tanker ?? 0)) || null,
        total_collection: summary.input_total ?? null,
        total_usage: summary.tower_usage ?? null,
        balance: summary.diff ?? null,
      });
    }
  }

  console.log(`\n${COMMIT ? '✓ Backfill committed.' : 'Dry run complete. Re-run with --commit to write.'}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
