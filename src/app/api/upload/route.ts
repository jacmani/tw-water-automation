import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { extractSheetData } from '@/lib/anthropic';
import type { ExtractionResult, TowerName } from '@/types';

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const image = formData.get('image') as File | null;
  const date = formData.get('date') as string | null;

  if (!image || !date) {
    return NextResponse.json({ error: 'Missing image or date' }, { status: 400 });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  // Validate file type
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!validTypes.includes(image.type) && !image.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
    return NextResponse.json({ error: 'Invalid file type. Please upload a photo.' }, { status: 400 });
  }

  const arrayBuffer = await image.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Normalize media type for Anthropic SDK (HEIC not supported, treat as JPEG)
  const rawType = image.type || 'image/jpeg';
  const mediaType = (
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(rawType)
      ? rawType
      : 'image/jpeg'
  ) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  // Upload image to Supabase storage
  const ext = image.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const fileName = `${date}-${Date.now()}.${ext}`;

  const { error: storageError } = await supabase.storage
    .from('sheet-images')
    .upload(fileName, buffer, { contentType: image.type || 'image/jpeg', upsert: false });

  if (storageError) {
    console.error('Storage error:', storageError);
    return NextResponse.json({ error: 'Failed to store image' }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage
    .from('sheet-images')
    .getPublicUrl(fileName);

  // Create daily_sheets record (pending)
  const { data: sheet, error: sheetError } = await supabase
    .from('daily_sheets')
    .insert({ date, image_url: publicUrl, processed_status: 'pending' })
    .select()
    .single();

  if (sheetError || !sheet) {
    console.error('Sheet insert error:', sheetError);
    return NextResponse.json({ error: 'Failed to create sheet record' }, { status: 500 });
  }

  let extracted: ExtractionResult;
  try {
    const base64 = buffer.toString('base64');
    extracted = await extractSheetData(base64, mediaType);
  } catch (err) {
    console.error('Extraction error:', err);
    await supabase
      .from('daily_sheets')
      .update({ processed_status: 'failed' })
      .eq('id', sheet.id);
    return NextResponse.json({ error: 'Failed to extract data from image' }, { status: 500 });
  }

  try {
    // Tower consumption (8 rows: 4 towers × 2 types)
    const towers: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];
    const towerRows = towers.flatMap((tower) =>
      (['DO', 'DR'] as const).map((type) => {
        const d = extracted.tower_section[tower][type];
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

    // Water sources
    const sourceRows = extracted.water_sources.map((s) => ({
      sheet_id: sheet.id,
      location: s.location,
      r_yesterday: s.r_yesterday,
      r_today: s.r_today,
      yesterday_ltrs: s.yesterday_ltrs,
      today_ltrs: s.today_ltrs,
      total: s.total,
    }));
    await supabase.from('water_sources').insert(sourceRows);

    // Water levels
    const levelRows = extracted.water_levels.map((l) => ({
      sheet_id: sheet.id,
      tank: l.tank,
      time_slot: l.time_slot,
      cm_reading: l.cm_reading,
      percentage: l.percentage,
    }));
    await supabase.from('water_levels').insert(levelRows);

    // Amenities (includes party hall via section field)
    const amenityRows = extracted.amenities.map((a) => ({
      sheet_id: sheet.id,
      section: a.section,
      meter_name: a.meter_name,
      y_day: a.y_day,
      r_day: a.r_day,
      diff: a.diff,
    }));
    await supabase.from('amenities').insert(amenityRows);

    // Summary
    const { confidence: _c, ...summaryFields } = extracted.summary;
    await supabase.from('summary').insert({ sheet_id: sheet.id, ...summaryFields });

    // Mark sheet as processed
    await supabase
      .from('daily_sheets')
      .update({
        processed_status: 'processed',
        confidence_score: extracted.overall_confidence,
      })
      .eq('id', sheet.id);

    return NextResponse.json({
      success: true,
      sheet_id: sheet.id,
      date,
      confidence: extracted.overall_confidence,
      flagged_fields: extracted.flagged_fields,
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
