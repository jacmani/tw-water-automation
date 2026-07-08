/**
 * Re-verification script for the OpenRouter free-model roster in
 * src/lib/openRouterVision.ts (docs/ocr-audit-2026-07.md — "go through
 * everything in OpenRouter" pass, 2026-07-08).
 *
 * Unlike scripts/check-hf-quota.ts, this needs NO API key — OpenRouter's model
 * catalog (`GET /api/v1/models`) is public. Run this anytime to re-check
 * whether the hardcoded MODEL_CANDIDATES list has gone stale (free rosters
 * rotate — this exact roster already needed replacing once, just two OCR-audit
 * sessions after it was first written).
 *
 * What it does:
 *   1. Fetches the live OpenRouter catalog.
 *   2. Lists every current free (`:free`) vision-capable (image input) model —
 *      i.e., everything this file COULD use, not just what it currently does.
 *   3. Flags any model currently hardcoded in MODEL_CANDIDATES that is no
 *      longer in that live list.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/check-openrouter-roster.ts
 */

// Kept as a plain string array here (not imported from openRouterVision.ts) so
// this script has zero dependency on that module's other exports/env reads —
// update this list by hand to match MODEL_CANDIDATES when you change one.
const CURRENTLY_HARDCODED = [
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'openrouter/free',
];

interface ORModel {
  id: string;
  created: number;
  context_length: number;
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  description?: string;
}

async function main() {
  console.log('[check-openrouter-roster] Fetching https://openrouter.ai/api/v1/models ...');
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) {
    console.error(`[check-openrouter-roster] Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const json = await res.json() as { data: ORModel[] };
  const models = json.data;
  console.log(`[check-openrouter-roster] Catalog has ${models.length} total models.\n`);

  const freeVision = models.filter(
    m => m.id.endsWith(':free') && (m.architecture?.input_modalities ?? []).includes('image')
  );
  // openrouter/free is a special meta-router — doesn't end in ':free' the same way, add explicitly.
  const metaRouter = models.find(m => m.id === 'openrouter/free');

  console.log(`=== Every free, vision-capable model OpenRouter currently lists (${freeVision.length}) ===`);
  for (const m of freeVision) {
    const created = new Date(m.created * 1000).toISOString().slice(0, 10);
    console.log(`  ${m.id}  (created ${created}, ${m.context_length} ctx)`);
  }
  if (metaRouter) {
    console.log(`  ${metaRouter.id}  (meta-router — randomly picks a live free model)`);
  }

  console.log(`\n=== Checking currently hardcoded MODEL_CANDIDATES (${CURRENTLY_HARDCODED.length}) ===`);
  const liveIds = new Set([...freeVision.map(m => m.id), ...(metaRouter ? [metaRouter.id] : [])]);
  let staleCount = 0;
  for (const id of CURRENTLY_HARDCODED) {
    if (liveIds.has(id)) {
      console.log(`  ✅ ${id} — still listed`);
    } else {
      staleCount++;
      console.log(`  🚨 ${id} — NO LONGER in the live free+vision catalog! Update MODEL_CANDIDATES in src/lib/openRouterVision.ts`);
    }
  }

  if (staleCount === 0) {
    console.log('\n[check-openrouter-roster] All good — hardcoded roster matches the live catalog.');
  } else {
    console.log(`\n[check-openrouter-roster] ${staleCount} candidate(s) need updating. See list above for what's currently live.`);
  }
}

main().catch(err => {
  console.error('[check-openrouter-roster] Unexpected error:', err);
  process.exit(1);
});
