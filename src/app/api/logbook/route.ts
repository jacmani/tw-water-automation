import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

function n(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const x = Number(v);
  return isNaN(x) ? null : x;
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { log_date, technician_name, fm_signed } = body as {
    log_date: string;
    technician_name: string | null;
    fm_signed: boolean;
  };

  if (!log_date || !/^\d{4}-\d{2}-\d{2}$/.test(log_date)) {
    return NextResponse.json({ error: 'Invalid log_date' }, { status: 400 });
  }

  // Upsert daily_log master record
  const { error: logError } = await supabase
    .from('daily_log')
    .upsert(
      { log_date, technician_name: technician_name ?? null, fm_signed: !!fm_signed, updated_at: new Date().toISOString() },
      { onConflict: 'log_date' }
    );

  if (logError) {
    console.error('daily_log upsert error:', logError);
    return NextResponse.json({ error: 'Failed to save log header' }, { status: 500 });
  }

  // ── Tower meter readings ──────────────────────────────────────────────────
  const towerRows = (body.tower_readings as unknown[]) ?? [];
  if (towerRows.length > 0) {
    const rows = (towerRows as Record<string, unknown>[]).map((r) => ({
      log_date,
      tower: r.tower,
      meter_type: r.meter_type,
      yesterday_reading: n(r.yesterday_reading),
      today_reading: n(r.today_reading),
      total_in_ltrs: n(r.total_in_ltrs),
      consumption_yesterday: n(r.consumption_yesterday),
      consumption_today: n(r.consumption_today),
      difference: n(r.difference),
    }));
    const { error } = await supabase
      .from('tower_meter_readings')
      .upsert(rows, { onConflict: 'log_date,tower,meter_type' });
    if (error) console.error('tower_meter_readings upsert error:', error);
  }

  // ── Input source readings ─────────────────────────────────────────────────
  const sourceRows = (body.source_readings as unknown[]) ?? [];
  if (sourceRows.length > 0) {
    const rows = (sourceRows as Record<string, unknown>[]).map((r) => ({
      log_date,
      source_name: r.source_name,
      yesterday_reading: n(r.yesterday_reading),
      today_reading: n(r.today_reading),
      consumption_yesterday: n(r.consumption_yesterday),
      consumption_today: n(r.consumption_today),
      total: n(r.total),
    }));
    const { error } = await supabase
      .from('input_source_readings')
      .upsert(rows, { onConflict: 'log_date,source_name' });
    if (error) console.error('input_source_readings upsert error:', error);
  }

  // ── Amenity meter readings ────────────────────────────────────────────────
  const amenityRows = (body.amenity_readings as unknown[]) ?? [];
  if (amenityRows.length > 0) {
    const rows = (amenityRows as Record<string, unknown>[]).map((r) => ({
      log_date,
      amenity_type: r.amenity_type,
      location: r.location,
      yesterday: n(r.yesterday),
      today: n(r.today),
      consumption: n(r.consumption),
      cumulative: n(r.cumulative),
    }));
    const { error } = await supabase
      .from('amenity_meter_readings')
      .upsert(rows, { onConflict: 'log_date,amenity_type,location' });
    if (error) console.error('amenity_meter_readings upsert error:', error);
  }

  // ── Water level readings ──────────────────────────────────────────────────
  const levelRows = (body.water_levels as unknown[]) ?? [];
  if (levelRows.length > 0) {
    const rows = (levelRows as Record<string, unknown>[]).map((r) => ({
      log_date,
      time_slot: r.time_slot,
      jupiter_do: n(r.jupiter_do),
      jupiter_dr: n(r.jupiter_dr),
      collection_tank: n(r.collection_tank),
      mercury_do: n(r.mercury_do),
      mercury_dr: n(r.mercury_dr),
      cumulative_j: n(r.cumulative_j),
      cumulative_m: n(r.cumulative_m),
      cumulative_v: n(r.cumulative_v),
      cumulative_n: n(r.cumulative_n),
      cumulative_total: n(r.cumulative_total),
    }));
    const { error } = await supabase
      .from('water_level_readings')
      .upsert(rows, { onConflict: 'log_date,time_slot' });
    if (error) console.error('water_level_readings upsert error:', error);
  }

  // ── Utility meter readings ────────────────────────────────────────────────
  const util = body.utility_meters as Record<string, unknown> | null;
  const utilHasData = util && Object.values(util).some((v) => v !== '' && v !== null && v !== undefined);
  if (utilHasData) {
    const { error } = await supabase
      .from('utility_meter_readings')
      .upsert({
        log_date,
        p_hall_meter_1: n(util.p_hall_meter_1),
        p_hall_meter_2: n(util.p_hall_meter_2),
        wtp_1: n(util.wtp_1),
        wtp_2: n(util.wtp_2),
        venus_side_uf: n(util.venus_side_uf),
        total_tankers: n(util.total_tankers),
        consumption_yesterday: n(util.consumption_yesterday),
        consumption_today: n(util.consumption_today),
        consumption_total: n(util.consumption_total),
      }, { onConflict: 'log_date' });
    if (error) console.error('utility_meter_readings upsert error:', error);
  }

  // ── Daily inflow summary ──────────────────────────────────────────────────
  const inflow = body.inflow_summary as Record<string, unknown> | null;
  const inflowHasData = inflow && Object.values(inflow).some((v) => v !== '' && v !== null && v !== undefined);
  if (inflowHasData) {
    const { error } = await supabase
      .from('daily_inflow_summary')
      .upsert({
        log_date,
        water_inflow: n(inflow.water_inflow),
        well_inflow: n(inflow.well_inflow),
        tanker_inflow: n(inflow.tanker_inflow),
        total_collection: n(inflow.total_collection),
        total_usage: n(inflow.total_usage),
        balance: n(inflow.balance),
        cumulative_water: n(inflow.cumulative_water),
        cumulative_well: n(inflow.cumulative_well),
        cumulative_tanker: n(inflow.cumulative_tanker),
        cumulative_total_collection: n(inflow.cumulative_total_collection),
        cumulative_total_usage: n(inflow.cumulative_total_usage),
        cumulative_balance: n(inflow.cumulative_balance),
      }, { onConflict: 'log_date' });
    if (error) console.error('daily_inflow_summary upsert error:', error);
  }

  return NextResponse.json({ success: true, log_date });
}
