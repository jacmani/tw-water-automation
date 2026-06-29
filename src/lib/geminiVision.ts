/**
 * Google Gemini 2.5 Flash — FREE primary full-sheet extractor.
 *
 * Role: NEW default primary extractor (replaces Claude Haiku's everyday role).
 * Reads the complete sheet and returns the same structured `ExtractionResult` as
 * `runExtraction` in anthropic.ts — so it is a drop-in primary. The cost-inverted
 * pipeline (extractSheetData) calls this FIRST on every upload.
 *
 * Why Gemini 2.5 Flash:
 * - Free tier: 1,500 requests/day, 15 RPM, 1M TPM, NO credit card required.
 *   We upload ~1 sheet/day → we never approach the cap.
 * - Handwriting accuracy benchmarks ~93% (Gemini 2.5 Pro; Flash a step below but
 *   still strong), close to Claude's tier (Gemini 3 ~1.44% CER vs Claude Opus ~1.31%
 *   on the IAM benchmark). As a primary backed by Qwen cross-validation + Mistral OCR
 *   transcript injection, this is safe.
 * - Resilience: when the Anthropic credit balance hits zero, uploads still work.
 *
 * IMPORTANT — data privacy: Google may use FREE-tier requests to improve its models.
 * Trinity World water-meter readings are non-sensitive community data (see CLAUDE.md
 * RLS rationale), so this is acceptable here. Keep GEMINI_API_KEY on a billing-DISABLED
 * project — enabling billing removes the free tier for that project entirely.
 *
 * Graceful degradation: if GEMINI_API_KEY is unset, returns success=false and the
 * pipeline falls through to the next engine — same pattern as every other engine.
 */

import type { ExtractionResult } from '@/types';
import { EXTRACTION_PROMPT } from './anthropic';

export interface GeminiVisionResult {
  result: ExtractionResult | null;
  success: boolean;
  model: string;
}

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

const EMPTY_RESULT: GeminiVisionResult = {
  result: null,
  success: false,
  model: MODEL,
};

/**
 * Run a full-sheet extraction via Gemini. Optionally injects the Mistral OCR
 * transcript as a digit-disambiguation reference (same trick used for Haiku).
 */
export async function extractSheetWithGemini(
  base64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  ocrTranscript?: string
): Promise<GeminiVisionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[gemini] GEMINI_API_KEY not set — skipping Gemini (free primary)');
    return EMPTY_RESULT;
  }

  console.log(`[gemini] Calling ${MODEL} (free primary extractor)`);

  const transcriptHint = ocrTranscript
    ? `\n\n--- MISTRAL OCR TRANSCRIPT (purpose-built handwriting OCR, high accuracy) ---\nUse this as a reference to resolve any digit ambiguities you see in the image above.\nIf a number in the image is unclear, prefer the value shown in this transcript.\nHowever, the transcript may have table alignment errors — always verify against the image.\n\n${ocrTranscript}\n--- END TRANSCRIPT ---`
    : '';

  try {
    // Hard timeout so a slow Gemini response can't stall the whole pipeline.
    // Raised to 60s: gemini-2.5-flash with a long structured-JSON output was
    // hitting the old 30s cap and ALWAYS aborting → falling back to paid Haiku.
    // We have a 5-min function budget, so 60s is safe.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        signal: ac.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: EXTRACTION_PROMPT + transcriptHint },
                { inline_data: { mime_type: mediaType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            // The full-sheet JSON (8 towers + 8 sources + 24 levels + 14 amenities +
            // summary) is large — 4096 truncated it mid-object, producing invalid JSON.
            maxOutputTokens: 8192,
            // CRITICAL: gemini-2.5-flash enables "thinking" by default, which adds
            // 20–40s of latency before any output — that was the real cause of the
            // 30s timeouts. Disable it: this is structured OCR extraction, not reasoning.
            thinkingConfig: { thinkingBudget: 0 },
            // Force pure-JSON output so we don't have to strip markdown fences.
            responseMimeType: 'application/json',
          },
        }),
      }
    );
    clearTimeout(timer);

    if (!response.ok) {
      const err = await response.text();
      console.error(`[gemini] API error ${response.status}: ${err.slice(0, 300)}`);
      return EMPTY_RESULT;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    };

    const candidate = data.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      // MAX_TOKENS / SAFETY / RECITATION → output is incomplete or blocked.
      console.warn(`[gemini] finishReason=${candidate.finishReason} — output may be truncated; attempting repair`);
    }

    const raw = candidate?.content?.parts?.[0]?.text ?? '';
    if (!raw) {
      console.warn('[gemini] Empty response');
      return EMPTY_RESULT;
    }

    const parsed = parseLenientJson(raw) as ExtractionResult | null;
    if (!parsed || typeof parsed !== 'object') {
      console.error(`[gemini] Could not parse JSON even after repair. First 200 chars: ${raw.slice(0, 200)}`);
      return EMPTY_RESULT;
    }
    if (!parsed.flagged_fields) parsed.flagged_fields = [];

    console.log(`[gemini] Extraction OK, confidence=${parsed.overall_confidence}`);
    return { result: parsed, success: true, model: MODEL };
  } catch (err) {
    console.error('[gemini] Unexpected error:', err);
    return EMPTY_RESULT;
  }
}

/**
 * Tolerant JSON parser for LLM output. Tries strict parse first, then progressively
 * repairs the common failure modes seen from Gemini:
 *   - markdown fences ```json ... ```
 *   - leading/trailing prose around the object
 *   - trailing commas before } or ]
 *   - unquoted NaN / Infinity (→ null)
 *   - truncated output (close dangling brackets so the valid prefix parses)
 * Returns null if nothing salvageable.
 */
function parseLenientJson(raw: string): unknown {
  let s = raw.trim();

  // Strip markdown fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) s = fence[1].trim();

  // Narrow to the outermost object.
  const start = s.indexOf('{');
  if (start > 0) s = s.slice(start);

  const attempts: string[] = [s];

  // Repair pass 1: remove trailing commas, normalise NaN/Infinity.
  const repaired = s
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\b(NaN|Infinity|-Infinity)\b/g, 'null');
  attempts.push(repaired);

  // Repair pass 2: if truncated, close any open brackets/strings on the repaired text.
  attempts.push(closeTruncatedJson(repaired));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch { /* try next */ }
  }
  return null;
}

/** Best-effort: balance unclosed strings/brackets in truncated JSON. */
function closeTruncatedJson(s: string): string {
  let out = s;
  // If we're inside an unterminated string, close it.
  const quotes = (out.match(/(?<!\\)"/g) ?? []).length;
  if (quotes % 2 === 1) out += '"';
  // Drop any dangling trailing comma.
  out = out.replace(/,\s*$/, '');
  // Close brackets in the right order using a stack.
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of out) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  while (stack.length) {
    out += stack.pop() === '{' ? '}' : ']';
  }
  return out;
}
