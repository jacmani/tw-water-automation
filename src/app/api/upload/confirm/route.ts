import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase';
import { sendSpikeAlert } from '@/lib/email';
import type { ExtractionResult, TowerName } from '@/types';
import { percentageDiff } from '@/lib/utils';

const SPIKE_THRESHOLD = 15; // % above 7-day avg

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  let body: { image_url: string; date: string; extraction: ExtractionResult; date_source?: string; pipeline_metrics?: object };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { image_url, date, extraction, date_source } = body;
  if (!image_url || !date || !extraction) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  // Reject empty extractions — at least 4 towers must have a non-null total_ltrs
  // (either DO or DR). Prevents a failed Claude response from overwriting good data.
  const towersWithData = (['Venus', 'Mercury', 'Neptune', 'Jupiter'] as TowerName[]).filter((t) => {
    const tower = extraction.tower_section?.[t];
    return tower && (tower.DO?.total_ltrs != null || tower.DR?.total_ltrs != null);
  });
  if (towersWithData.length < 4) {
    console.error(`[confirm] Rejecting empty extraction — only ${towersWithData.length}/4 towers have data`);
    return NextResponse.json(
      { error: 'Extraction produced no tower data. Please re-upload a clearer photo.' },
      { status: 422 }
    );
  }

  // 'ai' = AI read date confidently; 'manual' = user entered date because AI couldn't read it
  const resolvedDateSource = date_source === 'manual' ? 'manual' : 'ai';

  // Create the daily_sheets record now that the user has confirmed
  const { data: sheet, error: sheetError } = await supabase
    .from('daily_sheets')
    .insert({ date, image_url, processed_status: 'pending', date_source: resolvedDateSource })
    .select()
    .single();

  if (sheetError || !sheet) {
    console.error('Sheet insert error:', sheetError);
    return NextResponse.json({ error: 'Failed to create sheet record' }, { status: 500 });
  }

  // Dedup invariant: the newest sheet for a date is canonical. Supersede any
  // older sheets sharing this date so trend/dashboard aggregates don't double-count.
  await supabase
    .from('daily_sheets')
    .update({ superseded: true })
    .eq('date', date)
    .neq('id', sheet.id);

  try {
    const towers: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

    const towerRows = towers.flatMap((tower) =>
      (['DO', 'DR'] as const).map((type) => {
        const d = extraction.tower_section[tower][type];
        return {
          sheet_id: sheet.id,
          tower,
          type,
          r_yesterday: d.r_yesterday,
          r_today: d.r_today,
          total_ltrs: d.total_ltrs,
          vol_yesterday: d.vol_yesterday,
          vol_today: d.vol_today,
          diff: d.diff,
          confidence: d.confidence,
        };
      })
    );
    const { error: towerErr } = await supabase.from('tower_consumption').insert(towerRows);
    if (towerErr) throw new Error(`[confirm] tower_consumption insert failed: ${towerErr.message}`);

    const sourceRows = extraction.water_sources.map((s) => ({
      sheet_id: sheet.id,
      location: s.location,
      r_yesterday: s.r_yesterday,
      r_today: s.r_today,
      yesterday_ltrs: s.yesterday_ltrs,
      today_ltrs: s.today_ltrs,
      total: s.total,
    }));
    const { error: sourceErr } = await supabase.from('water_sources').insert(sourceRows);
    if (sourceErr) throw new Error(`[confirm] water_sources insert failed: ${sourceErr.message}`);

    const levelRows = extraction.water_levels.map((l) => ({
      sheet_id: sheet.id,
      tank: l.tank,
      time_slot: l.time_slot,
      cm_reading: l.cm_reading,
      percentage: l.percentage,
    }));
    const { error: levelErr } = await supabase.from('water_levels').insert(levelRows);
    if (levelErr) throw new Error(`[confirm] water_levels insert failed: ${levelErr.message}`);

    const amenityRows = extraction.amenities.map((a) => ({
      sheet_id: sheet.id,
      section: a.section,
      meter_name: a.meter_name,
      y_day: a.y_day,
      r_day: a.r_day,
      diff: a.diff,
      cumulative: a.cumulative ?? null,
    }));
    const { error: amenityErr } = await supabase.from('amenities').insert(amenityRows);
    if (amenityErr) throw new Error(`[confirm] amenities insert failed: ${amenityErr.message}`);

    const { confidence: _c, ...summaryFields } = extraction.summary;
    const { error: summaryErr } = await supabase.from('summary').insert({ sheet_id: sheet.id, ...summaryFields });
    if (summaryErr) throw new Error(`[confirm] summary insert failed: ${summaryErr.message}`);

    await supabase
      .from('daily_sheets')
      .update({
        processed_status: 'processed',
        confidence_score: extraction.overall_confidence,
        ...(body.pipeline_metrics ? { pipeline_metrics: body.pipeline_metrics } : {}),
      })
      .eq('id', sheet.id);

    // ── Mirror into the logbook data model so /logbook shows photo uploads too ──
    // Best-effort: a mirror failure must never fail the upload (the canonical data
    // already lives in the daily_sheets model above).
    try {
      await mirrorToLogbook(supabase, date, extraction);
    } catch (mirrorErr) {
      console.error('[confirm] logbook mirror failed (non-fatal):', mirrorErr);
    }

    // ── Spike alert check ─────────────────────────────────────────────────────
    // Build per-tower totals from extraction
    const towerTotals: Record<TowerName, number> = {
      Venus: 0, Mercury: 0, Neptune: 0, Jupiter: 0,
    };
    for (const row of towerRows) {
      if (row.total_ltrs != null) {
        towerTotals[row.tower as TowerName] += row.total_ltrs;
      }
    }

    // Fetch 7-day averages (last 7 non-superseded sheets before today, excluding today's)
    const { data: recentSheets } = await supabase
      .from('daily_sheets')
      .select('id')
      .lt('date', date)
      .eq('processed_status', 'processed')
      .eq('superseded', false)
      .order('date', { ascending: false })
      .limit(7);

    const recentSheetIds = (recentSheets ?? []).map((s) => s.id);

    const sevenDayAvgs: Record<TowerName, number | null> = {
      Venus: null, Mercury: null, Neptune: null, Jupiter: null,
    };

    if (recentSheetIds.length > 0) {
      const { data: historicRows } = await supabase
        .from('tower_consumption')
        .select('tower, type, total_ltrs, sheet_id')
        .in('sheet_id', recentSheetIds);

      if (historicRows) {
        // Sum DO+DR per tower per sheet, then average across sheets
        const perSheetTower: Record<string, Record<TowerName, number>> = {};
        for (const row of historicRows) {
          if (row.total_ltrs == null) continue;
          if (!perSheetTower[row.sheet_id]) perSheetTower[row.sheet_id] = { Venus: 0, Mercury: 0, Neptune: 0, Jupiter: 0 };
          perSheetTower[row.sheet_id][row.tower as TowerName] += row.total_ltrs;
        }
        for (const tower of towers) {
          const vals = Object.values(perSheetTower).map((r) => r[tower]).filter((v) => v > 0);
          if (vals.length > 0) sevenDayAvgs[tower] = vals.reduce((a, b) => a + b, 0) / vals.length;
        }
      }
    }

    // Fire spike alerts (non-blocking — don't fail the request if email fails)
    const spikes: Promise<void>[] = [];
    const towerSpikesData: { tower: string; overagePct: number }[] = [];
    for (const tower of towers) {
      const current = towerTotals[tower];
      const avg = sevenDayAvgs[tower];
      if (current > 0 && avg != null && avg > 0) {
        const pct = percentageDiff(current, avg);
        if (pct >= SPIKE_THRESHOLD) {
          towerSpikesData.push({ tower, overagePct: Math.round(pct) });
          spikes.push(
            sendSpikeAlert(supabase, {
              tower,
              sheetDate: date,
              currentLitres: current,
              sevenDayAvg: avg,
              overagePct: pct,
            }).catch((err) => console.error(`Spike alert failed for ${tower}:`, err))
          );
        }
      }
    }
    await Promise.all(spikes);

    const communityTotal = Object.values(towerTotals).reduce((a, b) => a + b, 0);

    // Purge ISR cache so dashboard shows new data immediately
    revalidatePath('/');
    revalidatePath('/history');
    revalidatePath('/logbook');

    return NextResponse.json({
      success: true,
      sheet_id: sheet.id,
      date,
      confidence: extraction.overall_confidence,
      flagged_fields: extraction.flagged_fields ?? [],
      community_total: communityTotal,
      tower_spikes: towerSpikesData,
    });
  } catch (err) {
    console.error('DB insert error:', err);
    await supabase
      .from('daily_sheets')
      .update({ processed_status: 'failed' })
      .eq('id', sheet.id);
    return NextResponse.json({ error: 'Failed to store extracted data' }, { status: 500 });
  }
}

// Maps an extraction `location` string (water source row) to the logbook source_name slug.
// Handles both new template-exact names and legacy abbreviated names for backward compat.
function sourceSlug(location: string): string | null {
  const l = location.toLowerCase();
  if (l.includes('mercury') || l.includes('m+v') || l.includes('mtr')) return 'mercury_venus_tanker';
  if ((l.includes('jupiter') && l.includes('neptune')) || l.includes('j+n') || l.includes('jtr')) return 'jupiter_neptune_tanker';
  if (l.includes('1 2 3') || l.includes('well 1') || l.includes('1+2+3')) return 'venus_side_well_123';
  if (l.includes('well 4') || l.includes('4+b1') || l.includes('b1+b2')) return 'venus_side_well_4';
  if (l.includes('well 5') || l.includes('neptune side well 5')) return 'neptune_side_well_5';
  if (l.includes('well 6') || l.includes('neptune side well 6')) return 'neptune_side_well_6';
  if (l.includes('open')) return 'open_well';
  return null;
}

// Normalise an extracted amenity meter name to a value allowed by the
// amenity_meter_readings.location CHECK constraint (Jupiter/Mercury/Venus/Neptune,
// 'Meter 1'..'Meter 7'). Returns null if it can't be mapped (skip rather than 400).
function normaliseAmenityLocation(name: string | null | undefined): string | null {
  if (!name) return null;
  const t = name.trim();
  // Car wash towers — already valid as-is.
  if (['Jupiter', 'Mercury', 'Venus', 'Neptune'].includes(t)) return t;
  // Swimming pool: "METER-1" / "Meter-1" / "meter 1" → "Meter 1"
  const m = t.match(/meter[\s-]*([1-7])/i);
  if (m) return `Meter ${m[1]}`;
  return null; // anything else (Party Hall meters etc.) isn't a dashboard amenity
}

/**
 * Mirror a photo-upload extraction into the logbook data model (daily_log + child
 * tables) so the /logbook page reflects photo uploads, not just manual entries.
 * Uses the SAME upsert conflict keys as the manual /api/logbook route, so a manual
 * edit and a photo upload for the same date converge instead of duplicating.
 */
async function mirrorToLogbook(
  supabase: any, // SupabaseClient — typed as any to avoid importing the heavy generic form
  date: string,
  extraction: ExtractionResult
): Promise<void> {
  // 1. Master record
  const { error: logErr } = await supabase.from('daily_log').upsert(
    { log_date: date, updated_at: new Date().toISOString() },
    { onConflict: 'log_date' }
  );
  if (logErr) console.error('[mirror] daily_log upsert error:', logErr);

  // 2. Tower meter readings (type → meter_type, total_ltrs → total_in_ltrs)
  const towers: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];
  const towerRows = towers.flatMap((tower) =>
    (['DO', 'DR'] as const).map((mt) => {
      const d = extraction.tower_section?.[tower]?.[mt];
      return {
        log_date: date,
        tower,
        meter_type: mt,
        yesterday_reading: d?.r_yesterday ?? null,
        today_reading: d?.r_today ?? null,
        total_in_ltrs: d?.total_ltrs ?? null,
        consumption_yesterday: d?.vol_yesterday ?? null,
        consumption_today: d?.vol_today ?? null,
        difference: d?.diff ?? null,
      };
    })
  );
  const { error: towerMirrorErr } = await supabase.from('tower_meter_readings').upsert(towerRows, { onConflict: 'log_date,tower,meter_type' });
  if (towerMirrorErr) console.error('[mirror] tower_meter_readings upsert error:', towerMirrorErr);

  // 3. Input source readings (location → source_name slug)
  const srcRows = (extraction.water_sources ?? [])
    .map((s) => {
      const slug = sourceSlug(s.location ?? '');
      if (!slug) return null;
      return {
        log_date: date,
        source_name: slug,
        yesterday_reading: s.r_yesterday ?? null,
        today_reading: s.r_today ?? null,
        consumption_yesterday: s.yesterday_ltrs ?? null,
        consumption_today: s.today_ltrs ?? null,
        total: s.total ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (srcRows.length > 0) {
    const { error: srcMirrorErr } = await supabase.from('input_source_readings').upsert(srcRows, { onConflict: 'log_date,source_name' });
    if (srcMirrorErr) console.error('[mirror] input_source_readings upsert error:', srcMirrorErr);
  }

  // 4. Amenity meter readings (Car Wash + Swimming Pool → amenity_meter_readings)
  // The photo sheet prints Swimming Pool meters as "METER-1/2/3" (hyphen), but the
  // amenity_meter_readings.location CHECK constraint only allows "Meter 1/2/3" (space).
  // Normalise so the upsert passes the constraint AND matches the dashboard's keys —
  // previously every Swimming Pool row silently failed the 400 and the dashboard
  // showed "No amenity data for this date".
  const amenityRows = (extraction.amenities ?? [])
    .filter((a) => a.section === 'Car Wash' || a.section === 'Swimming Pool')
    .map((a) => ({
      log_date: date,
      amenity_type: a.section,
      location: normaliseAmenityLocation(a.meter_name),
      yesterday: a.y_day ?? null,
      today: a.r_day ?? null,
      consumption: a.diff ?? null,
      cumulative: a.cumulative ?? null,
    }))
    .filter((r): r is typeof r & { location: string } => r.location !== null);
  if (amenityRows.length > 0) {
    const { error: amenityMirrorErr } = await supabase
      .from('amenity_meter_readings')
      .upsert(amenityRows, { onConflict: 'log_date,amenity_type,location' });
    if (amenityMirrorErr) console.error('[mirror] amenity_meter_readings upsert error:', amenityMirrorErr);
  }

  // 4b. Party Hall → utility_meter_readings (wide table: one row per date, one column per meter)
  const phAmenities = (extraction.amenities ?? []).filter(a => a.section === 'Party Hall');
  if (phAmenities.length > 0) {
    const ph = (name: string) => phAmenities.find(a => a.meter_name === name);
    const { error: phErr } = await supabase.from('utility_meter_readings').upsert({
      log_date: date,
      p_hall_meter_1: ph('P Hall Meter-1')?.r_day ?? null,
      p_hall_meter_2: ph('P Hall Meter-2')?.r_day ?? null,
      wtp_1:          ph('WTP-1')?.r_day ?? null,
      wtp_2:          ph('WTP-2')?.r_day ?? null,
      venus_side_uf:  ph('Venus Side UF')?.r_day ?? null,
      total_tankers:  ph('Total Tankers')?.r_day ?? null,
      consumption_yesterday: null,
      consumption_today:     null,
      consumption_total:     null,
    }, { onConflict: 'log_date' });
    if (phErr) console.error('[mirror] utility_meter_readings upsert error:', phErr);
  }

  // 5. Water level readings (tank/time_slot → wide columns). The extraction model
  // stores one row per tank+slot; the logbook stores one wide row per slot.
  const slotMap: Record<string, string> = { '6AM': '6AM', '12PM': '12PM', '6PM': '6PM', '12AM': '12AM' };
  const bySlot: Record<string, Record<string, number | null>> = {};
  for (const lvl of extraction.water_levels ?? []) {
    const slot = slotMap[lvl.time_slot];
    if (!slot) continue;
    if (!bySlot[slot]) bySlot[slot] = {};
    const pct = lvl.percentage ?? null;
    if (lvl.tank === 'JDO') bySlot[slot].jupiter_do = pct;
    else if (lvl.tank === 'JDR') bySlot[slot].jupiter_dr = pct;
    else if (lvl.tank === 'CT') bySlot[slot].collection_tank = pct;
    else if (lvl.tank === 'MDO') bySlot[slot].mercury_do = pct;
    else if (lvl.tank === 'MDR') bySlot[slot].mercury_dr = pct;
  }
  const levelRows = Object.entries(bySlot).map(([time_slot, cols]) => ({
    log_date: date, time_slot, ...cols,
  }));
  if (levelRows.length > 0) {
    const { error: levelMirrorErr } = await supabase.from('water_level_readings').upsert(levelRows, { onConflict: 'log_date,time_slot' });
    if (levelMirrorErr) console.error('[mirror] water_level_readings upsert error:', levelMirrorErr);
  }

  // 6. Daily inflow summary — now a DIRECT 1:1 mapping to the sheet's TOTAL INFLOW
  // columns (no more v_side+n_side guesswork that mislabeled tanker/well values).
  const s = extraction.summary;
  if (s) {
    const { error: inflowErr } = await supabase.from('daily_inflow_summary').upsert({
      log_date: date,
      water_inflow: s.water_inflow ?? null,
      well_inflow: s.well_inflow ?? null,
      tanker_inflow: s.tanker_inflow ?? null,
      total_collection: s.input_total ?? null,
      total_usage: s.tower_usage ?? null,
      balance: s.diff ?? null,
    }, { onConflict: 'log_date' });
    if (inflowErr) console.error('[mirror] daily_inflow_summary upsert error:', inflowErr);
  }
}
