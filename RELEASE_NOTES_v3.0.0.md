# v3.0.0 — Cost-Inverted Multi-Engine OCR

**Free-first extraction. Anthropic only on doubt. Opus removed.**

## What changed

The OCR pipeline is now **cost-inverted**: free engines do the everyday work, and Claude is called only when the free engines genuinely disagree. This was driven by a real incident — the Anthropic credit balance hit zero and every upload dead-ended with `400 invalid_request_error`. v3.0.0 makes that failure mode nearly impossible.

## New engines

- **Google Gemini 2.5 Flash** (`gemini-2.5-flash`) — the **new default primary extractor** (`EXTRACTION_PRIMARY=gemini`). Free tier: 1,500 requests/day, no credit card. Reads the full sheet and returns the same structured result as Claude, with the Mistral OCR transcript injected as a digit-disambiguation hint. Module: `src/lib/geminiVision.ts`.
- **OpenRouter free tie-breaker** (`qwen/qwen2.5-vl-32b-instruct:free`) — a free second opinion used only when Gemini and Qwen3-VL disagree on tower totals. If 2 of 3 free engines agree on a disputed value, it's adopted with no paid call. Module: `src/lib/openRouterVision.ts`.

## Pipeline flow

```
Gemini 2.5 Flash (FREE)   → primary full-sheet extraction
   ↓  agreement gate (vs Qwen3-VL) + checkSanity + confidence ≥ 0.80
   ↓  PASS → accept, zero paid cost  (expected ~80–90% of uploads)
   ↓  FAIL ↓
OpenRouter (FREE)         → tie-breaker; 2-of-3 free majority resolves disputed rows
   ↓  still unresolved ↓
Claude Haiku (PAID)       → last-resort escalation + vol_today auto-correction net
```

## Cost & resilience

- **Opus removed entirely** — it was 5× the cost of Haiku ($5/$25 vs $1/$5 per million tokens). Haiku is now the only paid model.
- **$0 Anthropic cost on ~80–90% of uploads.** Annual cost drops from ~$2.55 to under $1.
- **No more dead-ends.** If Gemini is unavailable, the pipeline falls back to Haiku as primary. If the Anthropic key fails, the free engines still produce a result. `EXTRACTION_PRIMARY=haiku` restores legacy Claude-primary behaviour instantly.

## Safety preserved

The architecture that made v2.0.0 trustworthy is intact: the **agreement gate** (not a lone confidence score) is the accept/reject decision, `checkSanity` runs on the escalation result too, and `vol_today` auto-correction remains the final net. A single model can confidently misread a handwritten 1 as a 7 — the cross-validation, not self-reported confidence, is what catches it.

## Honest trade-off

The last-resort escalation model is now **Haiku, not Opus**, so worst-case accuracy on genuinely ambiguous sheets is slightly lower than v2.0.0 — a deliberate trade for resilience and cost. The free Gemini primary plus cross-validation compensates for the common case. **Verify against one real sheet after setting the new API keys before fully trusting production.**

## New environment variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `GEMINI_API_KEY` | Strongly recommended | Free primary extractor |
| `EXTRACTION_PRIMARY` | Optional (default `gemini`) | `gemini` or `haiku` rollback switch |
| `OPENROUTER_API_KEY` | Optional | Free tie-breaker before paid Haiku |
| `GEMINI_MODEL` / `OPENROUTER_MODEL` | Optional | Model overrides |

See `.env.example` and `CLAUDE.md` for full setup notes.
