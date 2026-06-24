import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { extractSheetData } from '@/lib/anthropic';
import { extractTextFromImage } from '@/lib/googleVision';
import { extractTextWithOcrSpace } from '@/lib/ocrSpace';
import { extractTowerTotalsWithQwen } from '@/lib/qwenVision';
import { extractTextWithMistralOcr } from '@/lib/mistralOcr';
import { validateExtraction } from '@/lib/extractionValidator';

const DATE_CONFIDENCE_THRESHOLD = 0.8;

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const image = formData.get('image') as File | null;
  if (!image) {
    return NextResponse.json({ error: 'Missing image' }, { status: 400 });
  }

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!validTypes.includes(image.type) && !image.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
    return NextResponse.json({ error: 'Invalid file type. Please upload a photo.' }, { status: 400 });
  }

  const arrayBuffer = await image.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const rawType = image.type || 'image/jpeg';
  const mediaType = (
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(rawType)
      ? rawType
      : 'image/jpeg'
  ) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  // Upload to storage first so we have the URL for the confirm step
  const ext = image.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const fileName = `pending-${Date.now()}.${ext}`;

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

  // Run Claude extraction + Google Vision OCR in parallel
  let extracted;
  let visionValidated = false;
  try {
    const base64 = buffer.toString('base64');
    // Phase 1: run Qwen3-VL + Mistral OCR 3 + Google Vision + OCR.space in parallel
    const [qwenResult, mistralOcrResult, visionResult, ocrSpaceResult] = await Promise.all([
      extractTowerTotalsWithQwen(base64, mediaType),
      extractTextWithMistralOcr(base64, mediaType),
      extractTextFromImage(base64),
      extractTextWithOcrSpace(base64, mediaType),
    ]);

    if (mistralOcrResult.success) {
      console.log(`[upload] Mistral OCR 3 transcript: ${mistralOcrResult.markdown.length} chars`);
    }

    // Phase 2: run Haiku with OCR transcript hint, compare against Qwen for Opus decision
    const claudeResult = await extractSheetData(base64, mediaType, qwenResult, mistralOcrResult);
    extracted = claudeResult;

    const validation = validateExtraction(extracted, visionResult, ocrSpaceResult);
    extracted.overall_confidence = Math.min(1, extracted.overall_confidence + validation.confidenceBoost);
    extracted.flagged_fields = [...extracted.flagged_fields, ...validation.flags];
    if (validation.dateMismatch) {
      extracted.date_confidence = 0.5;
    }
    if (validation.visionDate !== null && extracted.date_confidence < DATE_CONFIDENCE_THRESHOLD) {
      extracted.date = validation.visionDate;
    }
    visionValidated = visionResult.words.length > 0 || (ocrSpaceResult?.words.length ?? 0) > 0;
    console.log(`[upload] OCR sources active: ${validation.ocrSources.join(', ') || 'none'}`);
  } catch (err) {
    console.error('Extraction error:', err);
    await supabase.storage.from('sheet-images').remove([fileName]);
    return NextResponse.json({ error: 'Failed to read the sheet image' }, { status: 500 });
  }

  // If date confidence is low, return the extraction anyway with a flag so the
  // client can show a date picker instead of a dead-end error screen.
  if (!extracted.date || extracted.date_confidence < DATE_CONFIDENCE_THRESHOLD) {
    return NextResponse.json({
      pending: true,
      image_url: publicUrl,
      extracted_date: extracted.date ?? null,   // best guess, may be null
      date_confidence: extracted.date_confidence ?? 0,
      date_unclear: true,                        // tells UI to show date picker
      extraction: extracted,
      visionValidated,
    });
  }

  // Date confident — return for client-side confirmation. Nothing saved to DB yet.
  return NextResponse.json({
    pending: true,
    image_url: publicUrl,
    extracted_date: extracted.date,
    date_confidence: extracted.date_confidence,
    date_unclear: false,
    extraction: extracted,
    visionValidated,
  });
}
