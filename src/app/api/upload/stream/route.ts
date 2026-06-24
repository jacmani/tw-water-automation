/**
 * POST /api/upload/stream
 *
 * Streaming version of the upload pipeline.
 * Returns Server-Sent Events (SSE) so the client can show a live log
 * as each engine completes. Final event carries the full JSON payload
 * (same shape as /api/upload response) so the client can proceed to confirm.
 */
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { extractSheetData } from '@/lib/anthropic';
import { extractTextFromImage } from '@/lib/googleVision';
import { extractTextWithOcrSpace } from '@/lib/ocrSpace';
import { extractTowerTotalsWithQwen } from '@/lib/qwenVision';
import { validateExtraction } from '@/lib/extractionValidator';

const DATE_CONFIDENCE_THRESHOLD = 0.8;

type LogLevel = 'info' | 'success' | 'warn' | 'error' | 'engine';

interface LogEvent {
  type: 'log';
  level: LogLevel;
  message: string;
  detail?: string;
  elapsed?: number; // ms since start
}

interface DoneEvent {
  type: 'done';
  payload: object; // same as /api/upload JSON response
}

interface ErrorEvent {
  type: 'error';
  message: string;
}

export async function POST(request: NextRequest) {
  const startMs = Date.now();

  // Parse multipart form data from request
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response('Invalid form data', { status: 400 });
  }

  const image = formData.get('image') as File | null;
  if (!image) return new Response('Missing image', { status: 400 });

  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!validTypes.includes(image.type) && !image.name.match(/\.(jpg|jpeg|png|webp|heic|heif)$/i)) {
    return new Response('Invalid file type', { status: 400 });
  }

  const arrayBuffer = await image.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const rawType = image.type || 'image/jpeg';
  const mediaType = (
    ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(rawType)
      ? rawType : 'image/jpeg'
  ) as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: LogEvent | DoneEvent | ErrorEvent) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      function log(level: LogLevel, message: string, detail?: string) {
        send({ type: 'log', level, message, detail, elapsed: Date.now() - startMs });
      }

      try {
        const supabase = createServerClient();

        // ── Step 1: Upload to storage ─────────────────────────────────────────
        log('info', 'Uploading image to storage…');
        const ext = image.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        const fileName = `pending-${Date.now()}.${ext}`;
        const { error: storageError } = await supabase.storage
          .from('sheet-images')
          .upload(fileName, buffer, { contentType: image.type || 'image/jpeg', upsert: false });

        if (storageError) {
          log('error', 'Storage upload failed', storageError.message);
          send({ type: 'error', message: 'Failed to store image' });
          controller.close();
          return;
        }
        const { data: { publicUrl } } = supabase.storage.from('sheet-images').getPublicUrl(fileName);
        log('success', 'Image stored', `${(buffer.length / 1024).toFixed(0)} KB`);

        const base64 = buffer.toString('base64');

        // ── Step 2: OCR engines + Mistral in parallel ─────────────────────────
        log('info', 'Starting parallel OCR & vision engines…');

        const [qwenResult, visionResult, ocrSpaceResult] = await Promise.all([
          extractTowerTotalsWithQwen(base64, mediaType).then(r => {
            if (r.success && r.readings.length > 0) {
              const summary = r.readings
                .map(x => `${x.tower} ${x.type}=${x.total_ltrs != null ? (x.total_ltrs/1000).toFixed(0)+'kL' : '?'}`)
                .join(', ');
              log('engine', 'Qwen3-VL-8B ✓', summary);
            } else {
              log('warn', 'Qwen3-VL-8B — no result', process.env.HF_TOKEN ? 'API returned empty' : 'HF_TOKEN not configured');
            }
            return r;
          }),
          extractTextFromImage(base64).then(r => {
            if (r.words.length > 0) {
              log('engine', `Google Vision ✓`, `${r.words.length} words extracted${r.detectedDate ? ', date: ' + r.detectedDate : ''}`);
            } else {
              log('warn', 'Google Vision — no text', process.env.GOOGLE_CLOUD_VISION_API_KEY ? 'Empty result' : 'API key not configured');
            }
            return r;
          }),
          extractTextWithOcrSpace(base64, mediaType).then(r => {
            if (r.words.length > 0) {
              log('engine', `OCR.space Engine 2 ✓`, `${r.words.length} words extracted${r.detectedDate ? ', date: ' + r.detectedDate : ''}`);
            } else {
              log('warn', 'OCR.space — no text', process.env.OCR_SPACE_API_KEY ? 'Empty result' : 'API key not configured');
            }
            return r;
          }),
        ]);

        // ── Step 3: Claude Haiku (+ possible Opus escalation) ─────────────────
        log('info', 'Claude Haiku extracting all sheet data…');
        const extracted = await extractSheetData(base64, mediaType, qwenResult);

        // Detect whether Opus was used (flagged_fields contain opus_reason)
        const opusReason = extracted.flagged_fields?.find(f => f.startsWith('opus_reason:'));
        const autoFixed = extracted.flagged_fields?.find(f => f.includes('auto_corrected'));
        if (opusReason) {
          const reason = opusReason.replace('opus_reason:', '');
          log('warn', 'Haiku/Qwen disagreed — Claude Opus called', reason);
          if (autoFixed) {
            log('warn', 'Claude Opus ✓ (with auto-correction)', `Both models failed sanity — vol_today used as source of truth`);
          } else {
            log('success', `Claude Opus ✓`, `confidence ${(extracted.overall_confidence * 100).toFixed(0)}%`);
          }
        } else {
          log('success', `Claude Haiku ✓`, `Qwen3-VL agrees — confidence ${(extracted.overall_confidence * 100).toFixed(0)}%, Opus not needed`);
        }

        // ── Step 4: Validation ────────────────────────────────────────────────
        const validation = validateExtraction(extracted, visionResult, ocrSpaceResult);
        extracted.overall_confidence = Math.min(1, extracted.overall_confidence + validation.confidenceBoost);
        extracted.flagged_fields = [...(extracted.flagged_fields ?? []), ...validation.flags];

        if (validation.corroboratedNumbers > 0) {
          log('success', `Cross-validation ✓`, `${validation.corroboratedNumbers} numbers corroborated across engines`);
        }
        if (validation.dateMismatch) {
          log('warn', 'Date mismatch between engines', `OCR: ${validation.visionDate}, Claude: ${extracted.date}`);
        }
        if (validation.visionDate !== null && (extracted.date_confidence ?? 0) < DATE_CONFIDENCE_THRESHOLD) {
          extracted.date = validation.visionDate;
        }

        const visionValidated = visionResult.words.length > 0 || (ocrSpaceResult?.words.length ?? 0) > 0;

        // ── Step 5: Done ──────────────────────────────────────────────────────
        const dateUnclear = !extracted.date || (extracted.date_confidence ?? 0) < DATE_CONFIDENCE_THRESHOLD;
        log('info', 'Preparing result…');

        send({
          type: 'done',
          payload: {
            pending: true,
            image_url: publicUrl,
            extracted_date: extracted.date ?? null,
            date_confidence: extracted.date_confidence ?? 0,
            date_unclear: dateUnclear,
            extraction: extracted,
            visionValidated,
          },
        });

      } catch (err) {
        console.error('[stream] Unexpected error:', err);
        send({ type: 'error', message: err instanceof Error ? err.message : 'Unexpected error' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering on Vercel
    },
  });
}
