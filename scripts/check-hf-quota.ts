/**
 * One-off diagnostic for docs/ocr-audit-2026-07.md P0-1: is Qwen3-VL-8B (via the
 * Hugging Face Router / Novita provider) still working, or has HF's new $0.10/mo
 * Inference Provider credit cap started rejecting calls?
 *
 * This makes exactly ONE tiny real call (a 1x1 pixel image, ~20 output tokens) —
 * negligible cost even if the free credit is already gone, since the point is to
 * read the error message, not to succeed cheaply.
 *
 * Run this on a machine where the REAL production env vars live (your local
 * .env.local or wherever HF_TOKEN is actually set) — this sandbox's .env.local
 * does not have HF_TOKEN, GEMINI_API_KEY, MISTRAL_API_KEY, OPENROUTER_API_KEY, or
 * OCR_SPACE_API_KEY, so this script cannot be run from here. That's intentional:
 * it means I (Claude) never see the token value, only you do.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/check-hf-quota.ts
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const HF_TOKEN = process.env.HF_TOKEN;

// Smallest possible valid JPEG (1x1 white pixel) as base64 — we don't care about
// the answer, only whether the call is accepted or rejected, and why.
const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

async function main() {
  if (!HF_TOKEN) {
    console.error('HF_TOKEN is not set in this environment. Run this where the real production env vars live.');
    process.exit(1);
  }

  console.log('[check-hf-quota] Calling Qwen/Qwen3-VL-8B-Instruct via HF Router (novita)...');
  const t0 = Date.now();
  try {
    const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HF_TOKEN}`,
      },
      body: JSON.stringify({
        model: 'Qwen/Qwen3-VL-8B-Instruct',
        provider: 'novita',
        max_tokens: 20,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Reply with just the word OK.' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${TINY_JPEG_BASE64}` } },
            ],
          },
        ],
      }),
    });
    const ms = Date.now() - t0;
    const bodyText = await response.text();

    console.log(`[check-hf-quota] HTTP ${response.status} in ${ms}ms`);
    // Surface anything that looks like a billing/credit/quota signal explicitly.
    const billingSignal = /credit|quota|billing|insufficient|exceeded|payment/i.test(bodyText);
    if (response.ok) {
      console.log('[check-hf-quota] ✅ Call succeeded — Qwen3-VL is currently reachable and billing OK.');
      console.log(`[check-hf-quota] Response: ${bodyText.slice(0, 300)}`);
    } else if (billingSignal) {
      console.log('[check-hf-quota] 🚨 Call FAILED with what looks like a billing/quota-related error:');
      console.log(bodyText.slice(0, 800));
      console.log('\n[check-hf-quota] This confirms P0-1 — HF Inference Provider credit is likely exhausted.');
      console.log('[check-hf-quota] Next step: check https://huggingface.co/settings/billing to confirm, then either');
      console.log('  (a) add a small monthly HF budget, or (b) migrate Qwen\'s role per docs/ocr-audit-2026-07.md Part C #13.');
    } else {
      console.log('[check-hf-quota] Call failed for a non-billing reason (model/provider issue, not quota):');
      console.log(bodyText.slice(0, 800));
    }

    // Log any rate-limit / quota related response headers, if HF sends them.
    const interestingHeaders = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-credits-remaining', 'retry-after'];
    for (const h of interestingHeaders) {
      const v = response.headers.get(h);
      if (v) console.log(`[check-hf-quota] header ${h}: ${v}`);
    }
  } catch (err) {
    console.error('[check-hf-quota] Network/unexpected error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
