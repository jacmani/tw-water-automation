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
import { extractTextWithMistralOcr } from '@/lib/mistralOcr';
import { validateExtraction } from '@/lib/extractionValidator';
import { CostTracker } from '@/lib/costTracker';

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

  // HEIC/HEIF from iPhone cannot be decoded by any AI vision API (binary format mismatch).
  // Detect before reading the buffer to avoid wasting memory on a large file we can't use.
  const imageType = image.type || '';
  const isHEIC = imageType === 'image/heic' || imageType === 'image/heif' || !!image.name.match(/\.(heic|heif)$/i);
  if (isHEIC) {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(enc.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'HEIC/HEIF format from iPhone cannot be processed. On your iPhone, go to Settings → Camera → Formats → "Most Compatible" to capture in JPEG. Then retake the photo and upload again.' })}\n\n`
          ));
          ctrl.close();
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } }
    );
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

      let fileName: string | undefined;
      try {
        const supabase = createServerClient();

        // ── Step 1: Upload to storage ─────────────────────────────────────────
        log('info', 'Uploading image to storage…');
        const ext = image.name.split('.').pop()?.toLowerCase() ?? 'jpg';
        fileName = `pending-${Date.now()}.${ext}`;
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
        const cost = new CostTracker();

        // Free OCR/word engines record as ₹0 so the cost card shows the full roster.
        cost.addFree('Google Vision (date/number)', 'free tier');
        cost.addFree('OCR.space Engine 2', 'free tier');

        // ── Step 2: All parallel engines ──────────────────────────────────────
        log('info', 'Phase 1 — running 4 free engines in parallel', 'Qwen3-VL · Mistral OCR 3 · Google Vision · OCR.space');

        const [qwenResult, mistralOcrResult, visionResult, ocrSpaceResult] = await Promise.all([
          (async () => {
            const t0 = Date.now();
            const r = await extractTowerTotalsWithQwen(base64, mediaType);
            const ms = Date.now() - t0;
            if (r.success && r.readings.length > 0) {
              const summary = r.readings
                .map(x => `${x.tower} ${x.type}=${x.total_ltrs != null ? (x.total_ltrs/1000).toFixed(0)+'kL' : '?'}`)
                .join(', ');
              log('engine', `Qwen3-VL-8B ✓ (free, ${ms}ms)`, summary);
            } else {
              log('warn', 'Qwen3-VL-8B — no result', process.env.HF_TOKEN ? 'API returned empty' : 'HF_TOKEN not configured');
            }
            return r;
          })(),
          (async () => {
            const t0 = Date.now();
            const r = await extractTextWithMistralOcr(base64, mediaType);
            const ms = Date.now() - t0;
            if (r.success) {
              log('engine', `Mistral OCR 3 ✓ (free, ${ms}ms)`, `${r.markdown.length} chars transcribed — handwriting specialist, injected into primary`);
            } else {
              log('warn', 'Mistral OCR 3 — no result', process.env.MISTRAL_API_KEY ? 'API returned empty' : 'MISTRAL_API_KEY not configured');
            }
            return r;
          })(),
          (async () => {
            const t0 = Date.now();
            const r = await extractTextFromImage(base64);
            const ms = Date.now() - t0;
            if (r.words.length > 0) {
              log('engine', `Google Vision ✓ (free, ${ms}ms)`, `${r.words.length} words${r.detectedDate ? ', date: ' + r.detectedDate : ''}`);
            } else {
              log('warn', 'Google Vision — no text', process.env.GOOGLE_CLOUD_VISION_API_KEY ? 'Empty result' : 'API key not configured');
            }
            return r;
          })(),
          (async () => {
            const t0 = Date.now();
            const r = await extractTextWithOcrSpace(base64, mediaType);
            const ms = Date.now() - t0;
            if (r.words.length > 0) {
              log('engine', `OCR.space Engine 2 ✓ (free, ${ms}ms)`, `${r.words.length} words${r.detectedDate ? ', date: ' + r.detectedDate : ''}`);
            } else {
              log('warn', 'OCR.space — no text', process.env.OCR_SPACE_API_KEY ? 'Empty result' : 'API key not configured');
            }
            return r;
          })(),
        ]);

        // ── Step 3: Cost-inverted extraction (free Gemini primary, Haiku last resort) ──
        log('info', `Phase 2 — primary extraction (free Gemini first)${mistralOcrResult.success ? ' + Mistral OCR hint' : ''}…`);
        const extractStart = Date.now();
        const extracted = await extractSheetData(
          base64, mediaType, qwenResult, mistralOcrResult, cost,
          // Real-time progress callback — each internal pipeline step emits SSE immediately
          (level, message, detail) => log(level, message, detail)
        );
        const extractMs = Date.now() - extractStart;

        // Report final tower totals summary (pipeline steps already logged individually above)
        const fields = extracted.flagged_fields ?? [];
        const towerSummary = (['Venus','Mercury','Neptune','Jupiter'] as const)
          .flatMap(tw => (['DO','DR'] as const).map(ty => {
            const v = extracted.tower_section?.[tw]?.[ty]?.total_ltrs;
            return `${tw[0]}${ty}=${v != null ? (v/1000).toFixed(0)+'k' : '?'}`;
          })).join(' ');
        log('info', `Final tower totals (kL) — ${extractMs}ms total`, towerSummary);

        // ── Full transparency: dump every tower row with its confidence ──────────
        for (const tw of ['Venus','Mercury','Neptune','Jupiter'] as const) {
          for (const ty of ['DO','DR'] as const) {
            const row = extracted.tower_section?.[tw]?.[ty];
            if (!row) continue;
            const v = row.total_ltrs;
            const cf = row.confidence != null ? `${(row.confidence*100).toFixed(0)}%` : '—';
            log('engine', `${tw.toUpperCase()} ${ty}: ${v != null ? v.toLocaleString('en-IN') + ' L' : 'NOT READ'}`,
              `TOTAL IN LTRS · confidence ${cf}`);
          }
        }
        log('info', `Date read: ${extracted.date ?? 'unclear'}`, `date confidence ${((extracted.date_confidence ?? 0)*100).toFixed(0)}%`);

        // ── Step 4: Validation ────────────────────────────────────────────────
        // Pass Mistral markdown as a third corroboration source (it has the best
        // handwriting accuracy and is already available from Phase 1).
        const validation = validateExtraction(
          extracted,
          visionResult,
          ocrSpaceResult,
          mistralOcrResult.success ? mistralOcrResult.markdown : undefined
        );
        extracted.overall_confidence = Math.min(1, Math.max(0, extracted.overall_confidence + validation.confidenceBoost));
        extracted.flagged_fields = [...(extracted.flagged_fields ?? []), ...validation.flags];

        if (validation.corroboratedNumbers > 0) {
          const srcLabel = validation.ocrSources.join('+');
          log('success', `Cross-validation ✓`, `${validation.corroboratedNumbers} values corroborated (${srcLabel})`);
        }
        if (validation.confidenceBoost < 0) {
          log('warn', `Low OCR corroboration`, `${validation.unverifiedNumbers.length} of ${validation.corroboratedNumbers + validation.unverifiedNumbers.length} checked values not found in OCR word lists — confidence adjusted`);
        }
        if (validation.dateMismatch) {
          log('warn', 'Date mismatch between engines', `OCR: ${validation.visionDate}, Claude: ${extracted.date}`);
        }
        if (validation.visionDate !== null && (extracted.date_confidence ?? 0) < DATE_CONFIDENCE_THRESHOLD) {
          extracted.date = validation.visionDate;
        }

        const visionValidated = visionResult.words.length > 0 || (ocrSpaceResult?.words.length ?? 0) > 0 || mistralOcrResult.success;

        // ── Step 5: Cost summary (USD → INR) ──────────────────────────────────
        const costJson = cost.toJSON();
        log('info', '─── Scan cost breakdown ───');
        for (const e of costJson.breakdown) {
          log(e.paid ? 'warn' : 'engine',
            `${e.engine}: ${CostTracker.formatInr(e.inr)}`,
            e.detail ?? (e.paid ? 'paid' : 'free'));
        }
        log(costJson.paid_calls === 0 ? 'success' : 'info',
          `💰 Total this scan: ${cost.summaryLine()}`,
          `@ ₹${costJson.usd_to_inr}/USD · $${costJson.total_usd.toFixed(6)}`);

        // ── Step 6: Done ──────────────────────────────────────────────────────
        const dateUnclear = !extracted.date || (extracted.date_confidence ?? 0) < DATE_CONFIDENCE_THRESHOLD;
        const totalSec = ((Date.now() - startMs) / 1000).toFixed(1);
        log('success', `✓ Done in ${totalSec}s`, `extraction phase ${(extractMs/1000).toFixed(1)}s`);
        log('info', 'Preparing result…');

        // ── Build pipeline metrics for persistent storage ─────────────────────
        const primaryEngine = fields.find(f => f.startsWith('primary_engine:'))?.replace('primary_engine:', '') ?? 'unknown';
        const escalated = fields.find(f => f.startsWith('escalation_engine:'));
        const tieBroken = fields.find(f => f === 'resolved_by:free_tie_breaker');
        const autoFixed = fields.find(f => f.includes('auto_corrected'));
        const pipelineMetrics = {
          primary_engine: primaryEngine,
          escalated: !!escalated,
          tie_broken: !!tieBroken,
          auto_corrected: !!autoFixed,
          corroborated: validation.corroboratedNumbers,
          unverified: validation.unverifiedNumbers.length,
          qwen_ok: qwenResult.success,
          mistral_ok: mistralOcrResult.success,
          confidence_boost: Number(validation.confidenceBoost.toFixed(3)),
        };

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
            cost: costJson,
            pipeline_metrics: pipelineMetrics,
          },
        });

      } catch (err) {
        // Log the full detail server-side (Vercel function logs), but never
        // forward a raw internal error (stack traces, JSON parse errors, SDK
        // error shapes) straight to the technician's screen — a 2026-07-05
        // incident showed a raw "Unexpected token '`'... is not valid JSON"
        // SyntaxError reaching the upload UI verbatim. Known, already-friendly
        // messages (like the one runExtraction throws on unparseable Haiku
        // output) are still shown as-is; anything else falls back to a
        // generic retry prompt.
        console.error('[stream] Unexpected error:', err);
        const message = err instanceof Error && /please retry|not configured|failed to/i.test(err.message)
          ? err.message
          : 'Something went wrong while reading the sheet. Please try again — if it keeps failing, try a clearer photo or better lighting.';
        send({ type: 'error', message });
        if (fileName) {
          const supabase = createServerClient();
          await supabase.storage.from('sheet-images').remove([fileName]);
        }
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
