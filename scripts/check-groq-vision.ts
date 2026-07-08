/**
 * Verification script for the Groq fallback tie-breaker in src/lib/groqVision.ts
 * (docs/ocr-audit-2026-07.md follow-up — "awesome-free-llm-apis" pass, 2026-07-08).
 *
 * Unlike scripts/check-openrouter-roster.ts, Groq has no public unauthenticated model
 * catalog — this needs a real GROQ_API_KEY. Makes one minimal real vision call against
 * each hardcoded candidate to confirm the model ID is still live and accepts image
 * input, without touching the actual water-sheet pipeline.
 *
 * Usage:
 *   GROQ_API_KEY=gsk_... npx ts-node --project tsconfig.json scripts/check-groq-vision.ts
 *
 * (Or add GROQ_API_KEY to .env.local and load it with `dotenv -e .env.local -- npx ts-node ...`)
 */

export {}; // isolate module scope — prevents `main` colliding with other standalone scripts

const CANDIDATES = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3.6-27b',
];

// 1x1 white PNG — smallest possible valid image, just to confirm the model accepts
// image_url input and responds; not a real OCR test.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[check-groq-vision] GROQ_API_KEY not set. Get a free key (no card) at https://console.groq.com/keys');
    process.exit(1);
  }

  console.log(`[check-groq-vision] Checking ${CANDIDATES.length} candidate model(s)...\n`);
  let liveCount = 0;

  for (const model of CANDIDATES) {
    process.stdout.write(`  ${model} ... `);
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 20,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Reply with just the word OK.' },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${TINY_PNG_BASE64}` } },
              ],
            },
          ],
        }),
      });
      if (res.ok) {
        console.log('✅ live');
        liveCount++;
      } else {
        const body = await res.text();
        console.log(`🚨 HTTP ${res.status} — ${body.slice(0, 150)}`);
      }
    } catch (err) {
      console.log(`🚨 ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n[check-groq-vision] ${liveCount}/${CANDIDATES.length} candidate(s) live.`);
  if (liveCount === 0) {
    console.log('All candidates failed — update MODEL_CANDIDATES in src/lib/groqVision.ts (check console.groq.com/docs/vision for current model IDs).');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[check-groq-vision] Unexpected error:', err);
  process.exit(1);
});
