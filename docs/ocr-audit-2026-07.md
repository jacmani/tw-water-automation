# OCR Engine Deep Audit & Free-Tier Improvement Roadmap (July 2026)

**Date:** 8 July 2026
**Scope:** Full extraction pipeline — `src/lib/anthropic.ts`, `geminiVision.ts`, `qwenVision.ts`, `openRouterVision.ts`, `mistralOcr.ts`, `mistralVision.ts`, `googleVision.ts`, `ocrSpace.ts`, `extractionValidator.ts`, `jsonRepair.ts`, both upload routes — plus external research on free/open handwriting-OCR options for Indian-format handwritten numerals.
**Method:** Full read of every engine module and both orchestration routes (not a sample), cross-referenced against the incident log embedded in code comments; live web research (July 2026) on current free-tier terms, open-weight OCR models, and the applied research literature on handwritten digit-string recognition.

---

## 0. Executive Summary

The pipeline is **better engineered than the average production OCR system** — it already does the two things that matter most (independent-engine cross-validation instead of trusting one model's confidence score, and hard arithmetic sanity ceilings that cannot be talked around) and it has visibly learned from real failures: five documented incidents are named in code comments with the exact misread, the exact fix, and the exact reasoning for why simpler fixes were rejected. That is a rare level of institutional memory for a side project.

Two things pull the score down. First, **the "free" pipeline has quietly grown paid/fragile edges that the code doesn't reflect**: Hugging Face's Inference Providers now cap free usage at $0.10/month in provider credits rather than the old unlimited-but-rate-limited model, which is a direct risk to Qwen3-VL — the engine every other free-tier decision in the system depends on. OpenRouter's free-model roster has also rotated since the code was written; one of the three hard-coded tie-breaker candidates is very likely dead. Second, **the coverage is uneven**: Section 1 (Towers) gets three independent engines, a hard ceiling, and an aggregate cross-check. Section 6 (Summary) and Section 2 (Sources) — which is where the two worst-documented incidents actually happened — get at most two engines and zero auto-correction. Sections 3–5 (Water Levels, Amenities, Party Hall) get *no* cross-validation at all.

On the research side, the good news is that this project's exact problem — handwritten numeral strings, Indian comma grouping, a handful of recurring writers, high accountability stakes — is a well-studied shape of problem in two adjacent literatures (automatic meter reading, and Indian bank-cheque courtesy-amount recognition), and both point to the same conclusion: **a small model trained on this specific complex's handwriting will beat any general-purpose VLM**, cheaply, and for zero marginal cost per upload. Section 2 of this report lays out why, and Section 3 gives a phased, mostly-free path to get there without disturbing what already works.

---

## PART A — Deep Audit of the Current Pipeline

### A.1 What's genuinely strong — keep this, don't refactor it away

- **The agreement-gate architecture is the right shape.** Accepting a result only when an *architecturally independent* second reader (Qwen3-VL's DeepStack encoder vs. Gemini's encoder) agrees, rather than trusting a single model's self-reported confidence, is exactly what the applied literature on ensemble OCR recommends — and the code comments show this was learned the hard way (`CONFIDENCE_THRESHOLD` was raised 0.70→0.80 after models "reported falsely high confidence on misreads").
- **Hard physical ceilings (`enforceHardCeilings`) as a true last line of defense** — applied unconditionally after every code path, including the paid-escalation path — is a correct, boring, and important safety property. No return path in `anthropic.ts` can skip it.
- **`SANITY_CONFIDENCE_CEILING`** (anthropic.ts:418) is a subtle, well-reasoned fix: it stops generic OCR corroboration from *overriding* an internal-consistency violation, closing exactly the failure mode that let the 2026-07-05 962,000 L incident reach the dashboard at 90% confidence. Good catch, correctly generalized to both upload routes.
- **Refusal to fabricate corrections.** `deriveCorrection` only ever accepts a genuinely independent engine's reading or nulls the field for manual entry — never a same-engine derived value (delta, ÷10, vol_today). This was clearly earned through two separate incidents (documented inline) and is the single best piece of engineering in the file.
- **Cost-inversion is real, not cosmetic.** Gemini free → Qwen agreement gate free → OpenRouter tie-breaker free → Haiku paid-last-resort is actually gated in code, not just described in a comment; `gateClean` genuinely returns before any paid call.

### A.2 Findings, ranked by severity

#### P0-1 — Qwen3-VL, the backbone of the entire free agreement gate, may no longer be reliably free
**Evidence:** `qwenVision.ts` calls Qwen3-VL-8B via the Hugging Face Router (`novita` provider) using `HF_TOKEN`. Current (July 2026) Hugging Face pricing gives free accounts **$0.10/month in Inference Provider credits**, replacing the older "few hundred free requests/hour" framing the code's comments assume. Novita is a paid third-party provider routed through HF's Inference Providers marketplace — i.e. Qwen3-VL-8B calls through this path are billed against that $0.10/month credit, not against a separate unlimited free quota.
**Why it matters:** Every disagreement/agreement decision in `extractSheetDataInner` depends on `qwenResult`. If HF silently starts rate-limiting or erroring once the monthly credit is exhausted, `qwenResult.success` goes `false`, the agreement gate has nothing to compare against, and — per `checkSanity`'s `lowConfidence` branch — every single upload escalates straight to paid Haiku. The system will keep working (graceful degradation is correctly implemented), but the "~$2.55/year" cost model in `CLAUDE.md` would be quietly wrong, and you'd only notice from a Vercel log pattern or a cost-tracker spike, not a hard error.
**Fix:** Check the actual Hugging Face billing dashboard for this token's Inference Provider spend this month. If it's non-zero and climbing, either (a) budget a small monthly HF spend explicitly (this is likely still under $1/month at 1 upload/day), or (b) replace Qwen's role with a model/provider still on a genuinely free HF Space (see Part C).

#### P0-2 — OpenRouter's free-model roster has rotated again since the code was last verified
**Evidence:** `openRouterVision.ts` comments say the candidate list was "verified live against the OpenRouter models API (June 2026)" and lists `nvidia/nemotron-nano-12b-v2-vl:free` first. Live research this month (July 2026) shows OpenRouter's current free vision roster is `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, and `google/gemma-4-26b-a4b-it:free` — a **different Nemotron slug** (`nemotron-3-nano-omni-30b-a3b-reasoning`, not `nemotron-nano-12b-v2-vl`). The code's own comment above `MODEL_CANDIDATES` explicitly warns free slugs "disappear without notice," and this looks like exactly that.
**Why it matters:** The loop tries each candidate and falls through on 404/400, so this degrades gracefully to the next candidate rather than failing hard — but every call to the dead slug wastes ~1 retry cycle (up to the 20s per-attempt timeout) before falling through, adding latency to every tie-breaker call, and the roster could rotate again before you next check it.
**Fix:** Update `MODEL_CANDIDATES` to the current live list; more durably, this is a good candidate for a scheduled task (weekly) that pings OpenRouter's `/api/v1/models` endpoint, filters for `:free` + vision-capable, and alerts if the current candidates have gone stale.

#### P0-3 — Section 6 (Summary/accountability totals) and Section 2 (Sources) have the thinnest coverage, but caused the two worst incidents
**Evidence:** Both documented 2026-07-02 and 2026-07-05 incidents were in the Summary section (`input_total` 43,300 vs. real ~433,000; `input_total` 362,000 misread as 962,000). Yet `resolveWithTieBreaker` and `extractTowerTotalsWithOpenRouter` **only ever read the 8 tower totals** — the OpenRouter free tie-breaker structurally cannot resolve a Section 2 or Section 6 disagreement. Looking at `extractSheetDataInner`, any `qwenSourceDisagreements` or `qwenSummaryDisagreements` are routed straight past the free tie-breaker (`stillNeedsPaid = true`) to paid Haiku — which is the financially correct choice, but it also means these two highest-stakes sections only ever get **one** free independent check (Qwen) before falling back to a single paid model with no independent corroboration if Haiku also misreads it (this is exactly the "no auto-correction path exists" case `checkSanity` calls out at anthropic.ts:660-663).
**Why it matters:** This is precisely the section where both real incidents happened, and it remains the section with the least redundancy.
**Fix:** `openRouterVision.ts` already has the pattern to copy — Qwen's `QWEN_PROMPT` was already extended in "v3.1" to read Section 2 + Section 6 alongside Section 1. Do the same extension to `openRouterVision.ts`'s prompt/parsing (it's almost entirely copy-paste from `qwenVision.ts`'s already-written JSON shape). This gives Section 2/6 a genuine 3-way free tie-breaker instead of a 2-way check, closing the exact gap that let both incidents through.

#### P1-1 — Sections 3, 4, and 5 have zero cross-validation
**Evidence:** Water Levels (24 cells/day), Car Wash/Swimming Pool amenities, and Party Hall meters are extracted only by the primary engine (Gemini or Haiku). No Qwen coverage, no OpenRouter coverage, no `checkSanity` ranges, no independent-engine correction path exists for any of these fields.
**Why it matters:** Lower stakes than the accountability sections (not used in committee-facing headline totals), but a misread here is currently undetectable by anything in the pipeline — it would only surface if a human happened to notice.
**Fix:** Lowest priority of the coverage gaps — but cheap to partially close: add plausibility ranges to `checkSanity` (CM readings 0–300ish, percentage 0–100 is already partially handled in the prompt) as a flag-only check, no independent engine required.

#### P1-2 — `mistralVision.ts` is dead code
**Evidence:** `grep` across `src/` shows `extractTowerTotalsWithMistral` (and its Gemma fallback) is exported but never imported anywhere. `mistralOcr.ts` (the actual OCR-3 transcript engine used in production) is a completely different, correctly-wired module. `mistralVision.ts` duplicates `qwenVision.ts`'s "8 tower totals" job using `mistral-small-latest` chat completions, not the OCR-specialized endpoint, and isn't called by either upload route.
**Why it matters:** Not a bug, but a real maintainability risk — a future session (human or AI) reading the codebase cold will reasonably assume this file is part of the live pipeline (it's well-written and well-commented) and could waste time debugging or "fixing" a path nothing calls, or worse, wire it back in as a duplicate of Qwen's role without realizing OpenRouter already fills that slot.
**Fix:** Delete it, or if you want to keep it as a documented "alternate tie-breaker if OpenRouter's roster ever fully dies," add a one-line comment at the top making that explicit and reference it from `CLAUDE.md`.

#### P1-3 — Mistral OCR is mis-categorized as "free" in the cost model
**Evidence:** `CLAUDE.md`'s engine table and `mistralOcr.ts`'s own header comment describe cost as "~$0.002/page = ~$0.73/year," which is accurate — but the *pipeline* narrative in `anthropic.ts` (Phase 1 diagram) groups it under free-tier engines in spirit ("free-first... Gemini (free) → Qwen agreement gate (free) → OpenRouter tie-breaker (free) → Claude Haiku (paid, last resort)" — Mistral OCR is called unconditionally in Phase 1, before any gate, and it's paid on every single upload, gate outcome notwithstanding). Additionally, current research shows Mistral's Le Chat free trial tier (a possible informal fallback) was **retired in June 2026** — there is no longer any consumer-facing free path to Mistral OCR at all, only the metered API.
**Why it matters:** Purely a documentation-accuracy issue, not a functional bug — the $0.73/year is negligible — but worth fixing so a future audit doesn't waste time assuming Mistral OCR is skippable-when-broke like the genuinely-free engines.
**Fix:** One-line CLAUDE.md clarification: "Mistral OCR 3 runs on every upload regardless of gate outcome and is the one always-paid (but negligible-cost) engine in Phase 1."

#### P2-1 — Full-sheet image sent at one resolution to every engine
**Evidence:** All five vision engines (Gemini, Qwen, OpenRouter, Haiku, Mistral OCR) receive the same single base64 image of the entire A3 sheet. No cropping, tiling, or region-specific high-resolution pass exists anywhere in the pipeline.
**Why it matters:** This is the single most consequential *technical* (as opposed to process) gap given the stated goal of the request — see Part B.2 below for the research behind why this specifically affects Indian-format handwritten digit strings.
**Fix:** See Part C — this is the highest-leverage, zero-marginal-cost recommendation in this report.

---

## PART B — Research: Closing the Human/Machine Gap on Cursive Indian Numerals

### B.1 Reframing the problem, precisely

Worth being exact about what "Indian numeral writing" means here, because it changes which research applies. This is **not** Devanagari/Indic-script numerals (०, १, २...) — the sheet uses ordinary Western Arabic digits (0–9), written cursively by a handful of Indian technicians, grouped with the **Indian comma convention** (lakh/crore: `1,76,000`) rather than the Western convention (`176,000`). That's an important distinction because most "Indian handwritten numeral" datasets in the academic literature (NumtaDB, CMATERDB, PHDIndic11, etc.) are actually Devanagari/Bengali/Urdu *script* digit datasets — not directly transferable here. The actually-relevant literatures are:

1. **Automatic meter reading (AMR)** — the closest possible domain match: cropped digit-string regions from physical meters, read by CNN/CRNN pipelines.
2. **Bank cheque courtesy-amount recognition (CAR)**, specifically Indian-bank research — handwritten numeral strings, high-accountability stakes, same "5-digit vs 6-digit lakh-grouping" ambiguity this project already fights in its prompts.
3. **Single-writer / few-shot handwriting-recognition domain adaptation** — because this sheet is filled out by a small, *fixed* set of technicians day after day, not an open population of unknown writers.

### B.2 Five research threads that point to concrete action

**1. Resolution is a bigger lever than model choice.** VLM vision encoders process images at fixed, modest resolutions (often 224–896px per tile) regardless of the source photo's actual resolution; research on VLM OCR shows raising effective input resolution from 448→896px improved text-perception performance by roughly 4 percentage points on small-text benchmarks, and dedicated "crop-and-zoom" architectures (e.g. CropVLM) exist specifically because full-image downsampling erases exactly the fine detail (a crossbar on a 7, a closed loop on a 2) that this pipeline's prompts are trying to talk the model into re-examining. **This system currently sends the full A3 sheet at one resolution to every engine and asks it, in text, to "look carefully."** The prompt-engineering in `EXTRACTION_PROMPT` is already excellent at describing *which* digit pairs get confused — but no amount of prompt text can recover detail that was downsampled away before the model ever saw it.

**2. Ensemble/consensus voting has real, bounded value — and this pipeline is already near the useful ceiling of the "different models" version of it.** Classic OCR ensemble research finds 20–50% of a single engine's errors resolvable by consensus voting across independent passes; digit-recognition-specific ensembles report 20–25% accuracy gains over the best single model. This validates the core architecture already built here. Where there's headroom left: research on LLM self-consistency (multiple temperature-sampled calls of the *same* model, majority-voted) shows real but smaller, more inconsistent gains than cross-architecture ensembling — useful as a cheap additional free vote on a disputed field, not a replacement for the Qwen/OpenRouter architecture-diversity approach already in place.

**3. Automatic meter reading research is a near-exact template for the "Total Litres" and "R Today/R Y Day" columns.** The UFPR-AMR benchmark (2,000 meter images, 10,000 annotated digits) shows purpose-built CRNN models hitting ~92% digit-string accuracy, and augmentation-heavy CR-NET architectures reaching ~94%, on the *general population* of meters and handwriting styles. That's a general-purpose ceiling. This project's actual population is much narrower — a handful of named technicians writing the same template, at the same complex, day after day — which is exactly the condition under which the next thread applies.

**4. Single-writer fine-tuning works with astonishingly little data.** Domain-adaptation research on handwriting-recognition models (fine-tuning a general HTR model on a small, specific target writer's data) shows meaningful accuracy gains from **as few as five real annotated lines** from the target writer, and that fine-tuning consistently beats zero-shot general models as a domain-adaptation baseline. Indian bank-cheque courtesy-amount recognition research — arguably the closest published analogue to this project's exact problem (handwritten Indian-format numeral strings, high stakes, cropped fields) — reports CNN classifiers hitting 98.5–99.1% accuracy once the amount field is cropped and segmented into individual digits. The common thread across both: **narrow the population (one template, few writers) and narrow the input (crop to the field) and accuracy on handwritten digit strings gets dramatically easier than general handwriting OCR.**

**5. General-purpose model accuracy has a real ceiling for cursive handwriting, and it's not that far above what this pipeline likely already achieves via ensembling.** Current (2026) handwriting benchmarks put GPT-5 at the top (~95% handwriting accuracy, ~1.22% character error rate on IAM), Gemini 2.5/3 Pro close behind (~93%), and Claude Opus a close third (~1.31% CER) — none of them near-perfect, and all of these numbers are for *general* handwriting, not this project's narrow, repetitive, high-structure template. That's the ceiling of "just use a smarter model." It's a meaningfully lower ceiling than what a narrow, template-specific, writer-specific model can reach (per thread 4), which is the actual justification for investing engineering time in a custom model rather than chasing the next VLM release.

---

## PART C — Recommendations, Ranked by Effort vs. Impact

All items below are $0 marginal cost per upload (one-time engineering time only) unless noted.

### Quick wins (hours–days, no new infrastructure)

1. **Update `OpenRouter` `MODEL_CANDIDATES`** to the current live free roster (fixes P0-2).
2. **Extend `openRouterVision.ts` to also read Section 2 + Section 6**, mirroring the Qwen v3.1 expansion (fixes P0-3 — this is the single highest-value quick win, since it directly targets the two sections that caused both real production incidents).
3. **Audit the HF billing dashboard for Qwen3-VL spend** and decide explicitly whether to fund a small monthly budget or migrate (addresses P0-1).
4. **Delete or clearly re-flag `mistralVision.ts`** as dead/reserve code (fixes P1-2).
5. **Try `OCREngine=3` instead of `OCREngine=2`** in `ocrSpace.ts` — OCR.space's newer engine claims meaningfully better handwriting support; free tier, one-line change, worth an A/B check since this engine's role is corroboration-only (low risk if it's worse).
6. **Add a "read each digit individually, left to right, before combining into the final number" instruction** to the disambiguation section of `EXTRACTION_PROMPT` — chain-of-thought-style digit-by-digit reasoning has research support for numeric OCR specifically, costs nothing, and is a two-line prompt change.
7. **Fix the Mistral OCR cost-model documentation** in `CLAUDE.md` (fixes P1-3).

### Medium effort (1–2 weeks, still $0/upload)

8. **Crop-and-zoom pass for the two highest-stakes regions.** Before calling any vision engine, use a lightweight image library (`sharp` is already a common Node dependency) to cut two additional high-resolution crops from the source photo — the Section 1 Tower table and the Section 6 Total Inflow table — and send them as *additional* image parts alongside the full-sheet image in the same API call (all five engines already accept multi-part image+text messages; this doesn't require a second API call, just a second image block). This directly attacks the resolution bottleneck identified in B.2 thread 1, for the two sections with the worst incident history, at zero additional API cost.
9. **Targeted re-ask on disagreement, not full-sheet re-extraction.** When `checkSanity` or the agreement gate flags a *specific* row (e.g. "Mercury DR"), crop just that cell region at full resolution and ask a single-field focused question, instead of re-running the entire sheet through paid Haiku. This is cheaper (fewer output tokens), faster, and — per B.2 thread 1 — more likely to actually resolve the ambiguity than re-asking the same low-resolution full-image question a second time.
10. **Capture a structured ground-truth table.** Every time a human corrects a flagged value (via `/history` or the re-extract script's `--commit`), write `{sheet_id, field, cropped_image_url, wrong_value, corrected_value, technician_if_known}` to a new small Supabase table. This is pure plumbing — no ML yet — but it's the prerequisite raw material for recommendation #11, and today that signal only exists as unstructured text inside `flagged_fields`.
11. **Add a temperature-diverse self-consistency vote as a free additional tie-breaker.** When Gemini and Qwen disagree on a field, call Gemini a second time at temperature ~0.3 (instead of immediately going to OpenRouter) — Gemini's free tier has ~1,500 req/day of headroom against ~1 upload/day, so this is free. Per B.2 thread 2, expect a modest, not dramatic, improvement — use it as a cheap extra vote before OpenRouter, not a replacement for it.

### Investment (weeks, one-time; still $0 marginal cost per upload once built)

12. **Train a personalized digit-string reader on this complex's own handwriting, and run it as a genuine "6th engine."** This is the recommendation the research in Part B most directly supports, and it's the one that most literally answers the framing of the original ask ("the human eye can understand it properly but the system doesn't" — a human reader gets that good specifically through repeated exposure to *these* technicians' handwriting, which is exactly what a general-purpose VLM never gets and a fine-tuned model would).
    - **Architecture:** a compact CRNN+CTC model (the domain standard for meter-style digit strings — see B.2 thread 3) or, more simply, a per-cell CNN digit classifier applied to individually-segmented digits (the approach that gets Indian bank-cheque CAR systems to 98–99% — see B.2 thread 4). Given this template's structure (fixed-position cells, not free-form writing), the segment-then-classify approach is likely simpler to build and debug than end-to-end CRNN.
    - **Training data:** start from the ground-truth table in #10. Research shows real, useful gains from single-writer fine-tuning starting at as few as ~5 annotated lines per writer — this project already has months of corrected sheets sitting in Supabase, which is very likely already enough to start.
    - **Training cost:** $0 — Google Colab and Kaggle both still offer free T4/P100 GPU sessions, more than sufficient for a model this small.
    - **Deployment cost:** $0 and zero added latency. A digit classifier this size exports to a few-megabyte ONNX file and can run **directly inside the existing Vercel Next.js serverless function** via `onnxruntime-node`'s WebAssembly backend (avoids the native-binary packaging issues that trip up naive ONNX-on-Vercel deployments) — no external API call, no rate limit, no rotating free-tier roster to babysit, and it only gets more accurate over time as the ground-truth table grows.
    - **Where it plugs in:** as a genuinely independent reading source for `findIndependentReading`/`deriveCorrection` in `anthropic.ts` — today those functions only ever get to choose between Qwen and OpenRouter; a personalized model trained on the actual, historically-confirmed handwriting of Trinity World's technicians would be the single most trustworthy independent signal available, likely more reliable than either.

13. **Lower-priority alternative/supplement:** self-host an open-weight OCR-strong VLM (Qwen3-VL open weights, or a compact document model like `dots.ocr` / PP-OCRv6) on a free-tier GPU host (Hugging Face Spaces with ZeroGPU, for instance) as a fourth architecturally-independent free reader, reducing dependence on OpenRouter's rotating free roster. Ranked below #12 because it's still a *general* handwriting model, not a personalized one — same ceiling described in B.2 thread 5.

---

## Proposed Phased Roadmap

| Phase | Items | Effort | Outcome |
|---|---|---|---|
| **1 — This week** | #1–7 (quick wins) | Hours | Closes the two live P0 risks (OpenRouter roster, HF billing) and the Section 2/6 coverage gap that caused both real incidents, at near-zero cost |
| **2 — Next 2–4 weeks** | #8–11 (crop/zoom, targeted re-ask, ground-truth capture, self-consistency vote) | 1–2 weeks eng time | Directly attacks the resolution bottleneck; starts accumulating the dataset needed for Phase 3 without requiring any ML work yet |
| **3 — Next 1–2 months** | #12 (personalized digit model) | Few weeks, mostly one-time | The actual answer to "make the system see what the human eye sees" — a 6th engine trained on this complex's real handwriting, running for free, forever, inside the existing serverless function |
| **Ongoing** | #13 (self-hosted open-weight VLM), scheduled free-tier roster monitoring | Optional | Extra redundancy once Phase 3 is stable |

---

## Sources

- [Rate limits — Gemini API, Google AI for Developers](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API Free Tier 2026 — TokenMix](https://tokenmix.ai/blog/gemini-api-free-tier-limits)
- [Hugging Face Pricing](https://huggingface.co/pricing)
- [Hugging Face Inference API Free Tier Limits & Pricing 2026 — Dmytro Klymentiev](https://klymentiev.com/blog/huggingface-inference-api)
- [OpenRouter Free Models — costgoat](https://costgoat.com/pricing/openrouter-free-models)
- [OpenRouter Free Tier 2026 — Dmytro Klymentiev](https://klymentiev.com/blog/openrouter-free-tier)
- [Mistral AI Pricing](https://mistral.ai/pricing/)
- [Mistral OCR — Mistral AI](https://mistral.ai/news/mistral-ocr/)
- [OCR.space Free OCR API](https://ocr.space/ocrapi)
- [OCR.space Test / Review 2026 — Koncile](https://www.koncile.ai/en/ressources/ocr-space-test-review)
- [Groq Images and Vision docs](https://console.groq.com/docs/vision)
- [Cerebras Free Tier 2026 — Price Per Token](https://pricepertoken.com/endpoints/cerebras/free)
- [Best Open Source OCR Models for Text Recognition in 2026 — mailxaminer](https://www.mailxaminer.com/blog/best-open-source-ocr-models/)
- [Best OCR Model 2026 — CodeSOTA](https://www.codesota.com/ocr)
- [Qwen2.5-VL Technical Report (arXiv)](https://arxiv.org/pdf/2502.13923)
- [PP-OCRv6 (arXiv)](https://arxiv.org/pdf/2606.13108)
- [Handwritten Text Recognition in Bank Cheques (ResearchGate)](https://www.researchgate.net/publication/329019514_Handwritten_Text_Recognition_in_Bank_Cheques)
- [Automatic processing of handwritten bank cheque images: A survey (ResearchGate)](https://www.researchgate.net/publication/226705617_Automatic_processing_of_handwritten_bank_cheque_images_A_survey)
- [Open Annotations and Synthetic Data for Field Localisation in Indian Bank Cheques (arXiv)](https://arxiv.org/pdf/2606.20682)
- [Convolutional Neural Networks for Automatic Meter Reading (arXiv)](https://arxiv.org/pdf/1902.09600)
- [Deep Learning for Image-based Automatic Dial Meter Reading: Dataset and Baselines (arXiv)](https://arxiv.org/pdf/2005.03106)
- [Awesome-Image-based-Meter-Recognition-Reading (GitHub)](https://github.com/ZZZHANG-jx/Awesome-Image-based-Meter-Recognition-Reading)
- [Fine-tuning Is a Surprisingly Effective Domain Adaptation Baseline in Handwriting Recognition (arXiv)](https://arxiv.org/pdf/2302.06308)
- [How to Choose Pretrained Handwriting Recognition Models for Single Writer Fine-Tuning (arXiv)](https://arxiv.org/pdf/2305.02593)
- [Few-shot Writer Adaptation via Multimodal In-Context Learning (arXiv)](https://arxiv.org/pdf/2603.29450)
- [Evaluation of Ensemble Learning Techniques for handwritten OCR Improvement (arXiv)](https://arxiv.org/pdf/2509.16221)
- [Using Consensus Sequence Voting to Correct OCR Errors (ScienceDirect)](https://www.sciencedirect.com/science/article/abs/pii/S1077314296905020)
- [CropVLM: Learning to Zoom for Fine-Grained Vision-Language Perception (arXiv)](https://arxiv.org/abs/2511.19820)
- [Look Where It Matters: High-Resolution Crops Retrieval for Efficient VLMs (arXiv)](https://arxiv.org/pdf/2603.16932)
- [Handwriting Recognition Benchmark: LLMs vs OCRs — AIMultiple](https://aimultiple.com/handwriting-recognition)
- [Best Handwriting OCR 2026: GPT, Claude, Gemini and TrOCR Compared — CodeSOTA](https://www.codesota.com/ocr/best-for-handwriting)
- [Fine-tune TrOCR on the IAM Handwriting Database (Colab notebook)](https://colab.research.google.com/github/NielsRogge/Transformers-Tutorials/blob/master/TrOCR/Fine_tune_TrOCR_on_IAM_Handwriting_Database_using_Seq2SeqTrainer.ipynb)
- [Introduction to Serverless Model Deployment with AWS Lambda and ONNX — PyImageSearch](https://pyimagesearch.com/2025/11/03/introduction-to-serverless-model-deployment-with-aws-lambda-and-onnx/)
