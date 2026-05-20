import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { ExtractionResult, TowerName } from '@/types';

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  let body: { image_url: string; date: string; extraction: ExtractionResult };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { image_url, date, extraction } = body;
  if (!image_url || !date || !extraction) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  // Create the daily_sheets record now that the user has confirmed
  const { data: sheet, error: sheetError } = await supabase
    .from('daily_sheets')
    .insert({ date, image_url, processed_status: 'pending' })
    .select()
    .single();

  if (sheetError || !sheet) {
    console.error('Sheet insert error:', sheetError);
    return NextResponse.json({ error: 'Failed to create sheet record' }, { status: 500 });
  }

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
      .update({
        processed_status: 'processed',
        confidence_score: extraction.overall_confidence,
      })
      .eq('id', sheet.id);

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
