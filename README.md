# Trinity World Water Automation

**Live:** https://tw-water-automation.vercel.app  
**Repo:** https://github.com/jacmani/tw-water-automation  
**Current version:** v2.0.0 — Multi-Engine OCR AI Architecture

A full-stack web application for Trinity World residential apartment complex that replaces the WhatsApp photo dead-end. Every morning a technician fills a handwritten A3 water meter reading sheet. Previously: photo goes to WhatsApp, vanishes. Now: photo uploads to this system, a five-engine AI pipeline extracts the data, it's stored in Supabase, and the committee gets structured dashboards, cross-validation logs, and shareable infographics.

---

## For AI Agents Reading This File

If you are an AI agent working on this codebase, read this entire file before touching any code. Key facts:

- **Live URL:** https://tw-water-automation.vercel.app — auto-deploys from `main` via Vercel
- **Push method:** Use the GitHub Contents API (PUT) with the PAT in CLAUDE.md — the local git index.lock is stale in the sandbox
- **Database:** Supabase Postgres. All migrations are in `supabase/migrations/`. Run manually in Supabase SQL editor
- **Never rename** the Vercel project, GitHub repo, or Supabase project
- **`RESEND_SANDBOX`** must stay `true` unless explicitly told otherwise
- The most critical file is `src/lib/anthropic.ts` — the five-engine extraction pipeline lives here
- Tower colors are canonical: Venus=#7C3AED, Mercury=#2563EB, Neptune=#059669, Jupiter=#EA580C
- The `superseded` column on `daily_sheets` is the deduplication invariant — always filter `.eq('superseded', false)` in queries
- `mistralVision.ts` exists but is NOT called in the main pipeline — it is legacy code kept for reference

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 14 App Router | Server components for DB reads, client for interactivity |
| Database + Storage | Supabase (Postgres + S3) | Managed, RLS permissive in v1 |
| Hosting | Vercel | Auto-deploy from main, Hobby plan |
| AI Extraction | Claude Haiku (primary) + Claude Opus (escalation) | Prompt caching enabled |
| Parallel Validator | Qwen3-VL-8B via HuggingFace Router (Novita) | Different visual encoder to Claude, $0.08/M tokens |
| Handwriting OCR | Mistral OCR 3 (mistral-ocr-2512) | 88.9% handwriting accuracy, $0.002/page |
| Word OCR | Google Vision DOCUMENT_TEXT_DETECTION | Date + number corroboration |
| Table OCR | OCR.space Engine 2 (isTable=true) | Free tier, 500 req/day |
| Charts | Recharts | SSR-compatible, works with html-to-image |
| Infographic Export | html-to-image + gif.js | PNG + animated GIF at 2× pixel ratio |
| Email Alerts | Resend | Spike alerts + weekly + monthly cron reports |

---

## Five-Engine OCR Pipeline (v2.0.0)

Every upload runs five AI engines to achieve robust extraction of handwritten data, with special focus on the recurring digit confusion problem (handwritten 7 with short crossbar reads as 1 — e.g. 1,76,000 misread as 1,16,000 = 60kL error on Mercury tower).

### Architecture

```
Phase 1 — Parallel (all fire simultaneously):
  ┌─ Qwen3-VL-8B (HuggingFace Router / Novita provider)
  │    → Reads all 8 tower totals independently
  │    → Different visual encoder to Claude (DeepStack architecture)
  │    → $0.00012/upload, 574ms latency
  │    → Env: HF_TOKEN
  │
  ├─ Mistral OCR 3 (mistral-ocr-2512)
  │    → Full sheet → structured Markdown transcript
  │    → Purpose-built for handwriting + dense tables
  │    → 88.9% handwriting accuracy benchmark
  │    → Transcript injected into Haiku's context window as hint
  │    → Env: MISTRAL_API_KEY
  │
  ├─ Google Vision (DOCUMENT_TEXT_DETECTION)
  │    → Word-level tokens for date + number corroboration
  │    → ~$0.0015/image
  │    → Env: GOOGLE_CLOUD_VISION_API_KEY
  │
  └─ OCR.space Engine 2 (isTable=true)
       → Second word list, free tier
       → Cross-validates dates
       → Env: OCR_SPACE_API_KEY

Phase 2 — Sequential:
  Claude Haiku (primary full extractor)
    → Reads image pixels + Mistral OCR transcript simultaneously
    → Extracts all 6 sections of the sheet into structured JSON
    │
    ├─ [Qwen agrees, ratio ≥0.85 on all tower rows]
    │     → Accept Haiku result. Opus NOT called. ✓
    │
    ├─ [Qwen disagrees on any row]
    │     → Claude Opus escalation (also gets Mistral OCR transcript)
    │     → Sanity check on Opus result (total_ltrs vs vol_today ratio)
    │     └─ [Opus also fails sanity] → vol_today auto-correction, confidence=0.65
    │
    ├─ [Haiku sanity violation, Qwen absent]
    │     → Claude Opus escalation → same sanity + auto-correction path
    │
    └─ [Overall confidence < 0.80]
          → Claude Opus escalation → sanity check
```

### Why This Catches Digit Misreads

The 1 vs 7 confusion is geometric — no image preprocessing fixes it. The defence is multi-model agreement:

1. **Qwen3-VL** uses a different visual encoder (DeepStack) than Claude. When two architecturally independent models read the same digit differently, that's a signal — not noise.
2. **Mistral OCR 3** gives Claude a text transcript of the same numbers. Haiku reads both pixel and text simultaneously, resolving digit ambiguities against the transcript.
3. **`vol_today` auto-correction** — if both Haiku and Opus misread `total_ltrs`, the independent `vol_today` column (a physically separate reading on the sheet) is substituted and flagged at confidence 0.65 for human review.

### Sanity Checks

| Field | Expected Range | Violation action |
|-------|---------------|-----------------|
| Tower DO `total_ltrs` | 50,000–250,000 L | Escalate to Opus |
| Tower DR `total_ltrs` | 5,000–40,000 L | Escalate to Opus |
| `total_ltrs` / `vol_today` ratio | 0.6–1.8 | Escalate to Opus; auto-correct if Opus also fails |
| `summary.input_total` | 150,000–900,000 L | Flag in `flagged_fields` |
| `summary.tower_usage` | 300,000–800,000 L | Flag in `flagged_fields` |

### Cost Per Upload

| Engine | Cost |
|--------|------|
| Qwen3-VL-8B | ~$0.00012 |
| Mistral OCR 3 | ~$0.002 |
| Google Vision | ~$0.0015 |
| OCR.space | $0 (free) |
| Claude Haiku | ~$0.003 |
| Claude Opus (escalation ~20% of uploads) | ~$0.005 avg |
| **Total per upload** | **~$0.007** |
| **Annual (365 uploads)** | **~$2.55/year** |

### Live Log on Upload Page

The `/upload` page shows a real-time terminal-style log via Server-Sent Events (SSE) at `/api/upload/stream`. Each engine reports its result as it completes, including elapsed time and whether Opus was triggered.

---

## The Physical Sheet

Handwritten A3 sheet, 6 sections:

**Section 1 — Tower Section** (primary accountability)  
Four towers: Venus, Mercury, Neptune, Jupiter. Each has DO (Domestic/Overhead) and DR (Drinking) rows.  
Columns: R Y Day, R T Day, Total Litres, Volume Yesterday, Volume Today, Diff

**Section 2 — Source/Location Section**  
Rows: M+V DO with MTR, J+N DO with JTR, V Well 1+2+3, V Well 4+B1+B2, N Well 5, N Well 6, ON Outside Well, Kingsley  
Columns: R Y Day, R Today, Yesterday in Ltrs, Today in Ltrs, Total

**Section 3 — Water Level Section**  
Tanks: JDO, JDR, CT, MDO, MDR, Fire Tank — measured 4× daily (6AM, 12PM, 6PM, 12AM)  
Format: `CM/Percentage` e.g. `80/26` = 80cm, 26% full. 24 readings per day.

**Section 4 — Amenities**  
Car Wash: Jupiter, Mercury, Venus, Neptune | Swimming Pool: Meter 3, Meter 4, Meter 5

**Section 5 — Party Hall**  
Meters: Meter 6, Meter 7, WTP1, WTP2, VUF, JUF, Venus STP

**Section 6 — Water Consumption Summary**  
V Side Well B1+B2, N Side Well+B3, JTR Tanker, MTR Tanker, IN PUT total, Tower Usage (OUT PUT), Diff  
Key invariant: Tower Usage ≈ total from Tower Section. Large Diff = anomaly.

Indian number format throughout: 1,76,000 = 176,000 (one lakh seventy-six thousand).

---

## Data Model

### `daily_sheets`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| date | DATE | Sheet date |
| uploaded_by | TEXT | Nullable, no auth in v1 |
| image_url | TEXT | Supabase storage public URL |
| processed_status | TEXT | `pending` / `processed` / `failed` |
| confidence_score | DECIMAL(3,2) | Overall extraction confidence 0–1 |
| date_source | TEXT | `ai` or `manual` |
| superseded | BOOLEAN | `false` = canonical; `true` = older duplicate |
| created_at | TIMESTAMPTZ | |

**Deduplication invariant:** If multiple sheets share the same `date`, newest = canonical (`superseded=false`). All trend queries, dashboard reads, and averages filter `.eq('superseded', false)`.

### `tower_consumption`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | → daily_sheets |
| tower | TEXT | Venus / Mercury / Neptune / Jupiter |
| type | TEXT | DO or DR |
| r_yesterday | DECIMAL | |
| r_today | DECIMAL | |
| total_ltrs | DECIMAL | Primary consumption figure |
| vol_yesterday | DECIMAL | |
| vol_today | DECIMAL | Independent column — used as sanity cross-check and auto-correction source |
| diff | DECIMAL | |
| confidence | DECIMAL(3,2) | Per-row confidence. 0.65 = auto-corrected, needs human review |

### `water_sources`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | |
| location | TEXT | e.g. `M+V DO with MTR` |
| r_yesterday | DECIMAL | |
| r_today | DECIMAL | |
| yesterday_ltrs | DECIMAL | |
| today_ltrs | DECIMAL | |
| total | DECIMAL | |

### `water_levels`
6 tanks × 4 time slots = 24 rows/day. Fields: tank, time_slot, cm_reading, percentage.

### `amenities`
Section field: `Car Wash`, `Swimming Pool`, or `Party Hall`. Fields: meter_name, y_day, r_day, diff.

### `summary`
Fields: v_side, n_side, jtr_tanker, mtr_tanker, input_total, tower_usage, diff.

### `committee_members`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| term | TEXT | e.g. `2026-27` |
| name | TEXT | |
| role | TEXT | One of 10 roles |
| tower | TEXT | Nullable |
| apartment | TEXT | Nullable |
| phone | TEXT | Nullable |
| email | TEXT | Nullable — used for alert emails |
| whatsapp_optin | BOOLEAN | |
| active | BOOLEAN | false = deactivated, not deleted |

**Roles (display order):** President, Vice President, Secretary, Joint Secretary, Treasurer, Joint Treasurer, Technical Expert, Financial Expert, GC Chair, GC Member

### `alert_log`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| alert_type | TEXT | `spike` / `weekly` / `monthly` |
| sheet_date | DATE | Null for aggregate reports |
| tower | TEXT | Null for community-wide |
| recipients | TEXT[] | |
| subject | TEXT | |
| sent_at | TIMESTAMPTZ | |
| status | TEXT | `sent` / `error` |
| details | JSONB | resend_id, error string, sandbox flag |

---

## Application Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Server Component | Dashboard — today's data, 7-day trend, infographic export |
| `/upload` | Client Component | Mobile-first photo upload with live SSE engine log |
| `/history` | Client Component | Daily table + heatmap, cross-check flags, CSV export |
| `/committee` | Server Component | Public committee registry grouped by role and tower |
| `/committee/admin` | Client Component | Add/edit/deactivate members, start new term with cloning |
| `/alerts` | Server Component | Email send history / sandbox verification |
| `/api/upload` | POST | Image → storage → all engines → pending response |
| `/api/upload/stream` | POST SSE | Same pipeline with live Server-Sent Events log |
| `/api/upload/confirm` | POST | Commit pending extraction to DB, trigger spike alerts |
| `/api/cron/weekly-report` | GET | Vercel cron — Monday 08:00 IST (`30 2 * * 1`) |
| `/api/cron/monthly-report` | GET | Vercel cron — 1st of month 08:00 IST (`30 2 1 * *`) |

---

## Source Files — Key

| File | Purpose |
|------|---------|
| `src/lib/anthropic.ts` | Core pipeline — Haiku, Opus, Qwen comparison, sanity checks, vol_today auto-correction, Mistral OCR context injection |
| `src/lib/qwenVision.ts` | Qwen3-VL-8B via HuggingFace Router — parallel tower extractor |
| `src/lib/mistralOcr.ts` | Mistral OCR 3 — handwriting transcript injected into Haiku context |
| `src/lib/googleVision.ts` | Google Vision word-level OCR |
| `src/lib/ocrSpace.ts` | OCR.space Engine 2 |
| `src/lib/extractionValidator.ts` | Cross-validates Claude output against Vision/OCR word lists, confidence boost |
| `src/lib/mistralVision.ts` | Legacy — Mistral Small + Gemma-4 fallback. Not called in main pipeline. |
| `src/lib/email.ts` | Resend email templates — spike, weekly, monthly |
| `src/lib/supabase.ts` | Supabase client factory — server + client variants |
| `src/components/history/flagging.ts` | Client-side cross-check flagging (summary_misread, digit_drop, etc.) |

---

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI Extraction
ANTHROPIC_API_KEY=               # Claude Haiku + Opus
HF_TOKEN=                        # HuggingFace — enables Qwen3-VL-8B parallel extractor
MISTRAL_API_KEY=                 # Mistral — enables Mistral OCR 3 handwriting transcript

# OCR engines
GOOGLE_CLOUD_VISION_API_KEY=     # Google Vision word-level OCR
OCR_SPACE_API_KEY=               # OCR.space free key (K83177836788957)

# App
NEXT_PUBLIC_TECHNICIAN_PHONE=    # Phone number on Template A infographic

# Email alerts (Resend)
RESEND_API_KEY=
RESEND_SANDBOX=true              # Set false for production email
RESEND_DOMAIN=                   # Your verified Resend domain (production only)
CRON_SECRET=                     # Vercel cron Authorization header
```

All set in Vercel dashboard → Settings → Environment Variables.

---

## Tower Colors

| Tower | Color | Hex |
|-------|-------|-----|
| Venus | Purple | `#7C3AED` |
| Mercury | Blue | `#2563EB` |
| Neptune | Green | `#059669` |
| Jupiter | Orange | `#EA580C` |

Used in infographics, dashboard cards, charts, and history heatmap. Do not change these.

---

## Infographic Templates

Three WhatsApp-shareable portrait PNG + animated GIF exports via html-to-image at 2× pixel ratio. Generated client-side.

**Template A — Daily Tower Card:** Dark navy (`#0F172A`), one tower, today + yesterday + 7-day avg, 3 conservation tips, technician contact. Background: `public/branding/tw-3.jpg`.

**Template B — Tower Wise Pie Chart:** White/light-blue, all 4 towers, Recharts PieChart, highest/lowest callout. Background: `public/branding/tw-2.jpg`.

**Template C — Alert Poster:** Red/black (`#DC2626` on `#0F0F0F`), triggers when any tower ≥15% above 7-day average. Background: `public/branding/tw-4.jpg`.

GIF export: 22 frames + 5 hold frames, looping, via `gif.js` Web Worker. Worker file at `public/gif.worker.js`.

---

## Alert Email System

| Type | Trigger | Recipients (production) |
|------|---------|------------------------|
| `spike` | Every upload — fires per tower if >15% above 7-day avg | President, Secretary, VP, GC Chairs |
| `weekly` | Monday 08:00 IST | All active committee members |
| `monthly` | 1st of month 08:00 IST | All active committee members |

**Sandbox → Production switch:** Set `RESEND_SANDBOX=false` in Vercel. Production prerequisites: verify domain in Resend, set `RESEND_DOMAIN`, add emails to `committee_members.email`.

Every send (success or error) logged in `alert_log` regardless of sandbox/production mode.

---

## History Page Flagging Logic

`src/components/history/flagging.ts` — computed live, not stored. Each processed sheet gets one flag:

| Priority | Flag | Trigger |
|----------|------|---------|
| 1 | `summary_misread` | `input_total` or `tower_usage` null, OR `input_total > WS_sum × 1.5` |
| 2 | `digit_drop` | Any DO < 50,000 L or DR < 5,000 L when other rows of same type are normal |
| 3 | `source_duplication` | Duplicate non-zero values in `water_sources.total` AND `WS_sum > input_total × 1.1` |
| 4 | `unexplained_gap` | `abs(TC_sum − tower_usage) > 10,000 L` or `abs(WS_sum − input_total) > 10,000 L` |
| 5 | `ok` | All sums within ±10 kL tolerance |

Low-confidence rows (`confidence < 0.8`) shown italic/dimmed with ⚠ superscript in history table.

---

## Supabase Storage

Bucket: `sheet-images` (public bucket). Images stored as `{date}-{timestamp}.{ext}`. URLs stored in `daily_sheets.image_url`.

---

## Supabase Migrations (run in order in SQL editor)

| File | Contents |
|------|---------|
| `001_initial_schema.sql` | Initial 6 tables |
| `002_committee_and_dedup.sql` | `superseded` column, dedup CTE, `committee_members`, seeds 2026-27 term |
| `003_alert_log.sql` | `alert_log` table |

Migration 002 must be applied before deploying code referencing `superseded` or `committee_members`. Migration 003 before email alerts work.

---

## Re-Extract Script

Re-run extraction on flagged sheets using the current hardened prompt.

```bash
# Dry run — shows old vs new values, does not write to DB
npx ts-node --project tsconfig.json scripts/re-extract.ts

# Commit — deletes child records and re-inserts fresh extraction
npx ts-node --project tsconfig.json scripts/re-extract.ts --commit
```

Requires `.env.local` with Supabase + Anthropic keys. Does NOT use `@/*` path aliases.

---

## Deployment

Push to `main` → Vercel auto-deploys. Environment variables in Vercel dashboard.

**When git index.lock blocks CLI pushes** (common in sandbox), use the GitHub Contents API:
```bash
git remote set-url origin https://<PAT>@github.com/jacmani/tw-water-automation.git && git push origin main
```

---

## Version History

### v2.0.0 — Multi-Engine OCR AI Architecture (June 2026)
- **Five-engine parallel pipeline:** Qwen3-VL-8B + Mistral OCR 3 + Google Vision + OCR.space + Claude Haiku/Opus
- **Mistral OCR 3 context injection:** Haiku reads image + structured handwriting transcript simultaneously
- **Qwen3-VL cross-validation:** Architecturally different visual encoder; disagreement triggers Opus
- **Sanity checks on Opus escalation path:** Both Haiku AND Opus run sanity — if both fail, `vol_today` auto-corrects `total_ltrs` at confidence 0.65
- **Live SSE log on upload page:** Real-time per-engine status, elapsed ms, confidence
- **Verified result:** Mercury DO 1,76,000 (recurring digit confusion bug) correctly extracted on first upload without any manual DB patch

### v1.3.0 — Haiku + Prompt Caching + Google Vision
- Switched primary extractor from Opus to Haiku (cost: ~10× cheaper per upload)
- Prompt caching on system prompt via Anthropic beta
- Google Vision DOCUMENT_TEXT_DETECTION for word-level corroboration
- `extractionValidator.ts` cross-validation layer
- Raised Haiku→Opus confidence threshold from 0.70 to 0.80

### v1.2.0 — OCR.space + Mistral Small (legacy)
- OCR.space Engine 2 integration (free tier)
- Mistral Small as tower-totals validator (replaced by Qwen3-VL in v2.0.0)
- Sanity ranges and violation detection

### v1.1.0 — History, Committee, Alerts, Infographics
- `/history` page: heatmap, cross-check flags, CSV export, dark/light mode
- Committee registry + admin: `/committee`, `/committee/admin`, term lifecycle
- Three infographic templates (A/B/C) with animated GIF export
- Alert email system (Resend): spike, weekly, monthly cron reports
- `/alerts` admin page for send history

### v1.0.0 — Initial Release
- Upload page + Claude Vision extraction
- Supabase schema (6 tables)
- Dashboard: tower cards, 7-day trend, missing sheet alert
- Vercel deployment, GitHub Actions

---

## What Is NOT Built (v3 Backlog)

- WhatsApp bot
- Technician login / auth (no auth in v1 by design — reduces adoption friction)
- Per-flat consumption tracking
- Digital form entry
- Mobile app
- Association member login + GC Chair dashboard role
- Historical trend reports (month-over-month, PDF export)
- Anomaly detection + push alerts
- Automated daily reminder if no upload by 9AM (SMS/WhatsApp Business API)
