import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase';
import { sendSpikeAlert } from '@/lib/email';
import type { ExtractionResult, TowerName } from '@/types';
import { percentageDiff } from '@/lib/utils';

const SPIKE_THRESHOLD = 15; // % above 7-day avg

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  let body: { image_url: string; date: string; extraction: ExtractionResult; date_source?: string };
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
    await supabase.from('tower_consumption').insert(towerRows);

    const sourceRows = extraction.water_sources.map((s) => ({
      sheet_id: sheet.id,
      location: s.location,
      r_yesterday: s.r_yesterday,
      r_today: s.r_today,
      yesterday_ltrs: s.yesterday_ltrs,
      today_ltrs: s.today_ltrs,
      total: s.total,
    }));
    await supabase.from('water_sources').insert(sourceRows);

    const levelRows = extraction.water_levels.map((l) => ({
      sheet_id: sheet.id,
      tank: l.tank,
      time_slot: l.time_slot,
      cm_reading: l.cm_reading,
      percentage: l.percentage,
    }));
    await supabase.from('water_levels').insert(levelRows);

    const amenityRows = extraction.amenities.map((a) => ({
      sheet_id: sheet.id,
      section: a.section,
      meter_name: a.meter_name,
      y_day: a.y_day,
      r_day: a.r_day,
      diff: a.diff,
    }));
    await supabase.from('amenities').insert(amenityRows);

    const { confidence: _c, ...summaryFields } = extraction.summary;
    await supabase.from('summary').insert({ sheet_id: sheet.id, ...summaryFields });

    await supabase
      .from('daily_sheets')
      .update({ processed_status: 'processed', confidence_score: extraction.overall_confidence })
      .eq('id', sheet.id);

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
    for (const tower of towers) {
      const current = towerTotals[tower];
      const avg = sevenDayAvgs[tower];
      if (current > 0 && avg != null && avg > 0) {
        const pct = percentageDiff(current, avg);
        if (pct >= SPIKE_THRESHOLD) {
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

    // Purge ISR cache so dashboard shows new data immediately
    revalidatePath('/');
    revalidatePath('/history');

    return NextResponse.json({
      success: true,
      sheet_id: sheet.id,
      date,
      confidence: extraction.overall_confidence,
      flagged_fields: extraction.flagged_fields ?? [],
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
