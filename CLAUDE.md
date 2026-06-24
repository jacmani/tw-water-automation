# CLAUDE.md — Trinity World Water Automation

**Hand this to any new Claude session cold. Read everything before touching code.**

---

## What This Is

A full-stack web application that replaces the WhatsApp photo dead-end at Trinity World residential apartment complex. Every morning a technician fills a handwritten water meter reading sheet. Previously: photo goes to WhatsApp, vanishes. Now: photo uploads to this system, a five-engine AI pipeline extracts the data, it's stored in Supabase, and the committee gets structured dashboards and shareable infographics.

**Live URL:** https://tw-water-automation.vercel.app (Vercel, auto-deploys from main)  
**Repo:** https://github.com/jacmani/tw-water-automation  
**Supabase project:** Connect via env vars (see .env.example)  
**Current version:** v2.0.0 — Multi-Engine OCR AI Architecture

---

## Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 14 App Router | Server components for DB reads, client for interactivity |
| Database + Storage | Supabase (Postgres + S3-compatible) | Managed, free tier sufficient, easy RLS |
| Hosting | Vercel | Auto-deploy from GitHub, zero-config Next.js, Hobby plan |
| Primary Extractor | Claude Haiku (`claude-haiku-4-5-20251001`) | Full sheet extraction with prompt caching |
| Escalation Model | Claude Opus (`claude-opus-4-7`) | Called only when Qwen disagrees or sanity fails |
| Parallel Validator | Qwen3-VL-8B via HuggingFace Router (Novita) | Different visual encoder to Claude, OCR-optimised |
| Handwriting OCR | Mistral OCR 3 (`mistral-ocr-2512`) | 88.9% handwriting accuracy, context-injected into Haiku |
| Word OCR | Google Vision DOCUMENT_TEXT_DETECTION | Date + number corroboration |
| Table OCR | OCR.space Engine 2 (`isTable=true`) | Free tier, 500 req/day |
| Charts | Recharts | SSR-compatible via 'use client', works with html-to-image |
| Infographic Export | html-to-image + gif.js | PNG + animated GIF at 2× pixel ratio |
| Email Alerts | Resend | Spike alerts + weekly + monthly cron reports |

---

## The Physical Sheet — Understand This Before Touching Extraction Logic

The Trinity World Water Template is a handwritten A3 sheet. Handwriting varies by technician. There are 6 sections:

### Section 1: Tower Section (primary accountability data)
Four towers: **Venus, Mercury, Neptune, Jupiter**  
Each tower has two rows: **DO** (Domestic/Overhead water) and **DR** (Drinking water)

| Column | Meaning |
|--------|---------|
| R Y Day | Meter reading yesterday |
| R T Day | Meter reading today |
| Total Litres | Calculated consumption |
| Volume Yesterday (Ltrs) | Yesterday's volume |
| Volume Today (Ltrs) | Today's volume — used as sanity cross-check |
| Diff | Difference |

### Section 2: Source / Location Section
Where water enters the system.

Rows: `M+V DO with MTR`, `J+N DO with JTR`, `V Well 1+2+3`, `V Well 4+B1+B2`, `N Well 5`, `N Well 6`, `ON Outside Well`, `Kingsley`  
Columns: R Y Day, R Today, Yesterday in Ltrs, Today in Ltrs, Total

### Section 3: Water Level Section
Physical tank levels taken 4× daily. Format: `CM/Percentage` — e.g. `80/26` = 80cm occupied, 26% full.

Tanks: `JDO`, `JDR`, `CT` (Collection Tank), `MDO`, `MDR`, `Fire Tank`  
Time slots: `6AM`, `12PM`, `6PM`, `12AM`  
→ 24 readings per day (6 tanks × 4 time slots). Some may be blank.

### Section 4: Amenities Section
Car Wash meters: Jupiter, Mercury, Venus, Neptune  
Swimming Pool: Meter 3, Meter 4, Meter 5  
Columns: Y Day, R Day, Diff

### Section 5: Party Hall Section
Meters: Meter 6, Meter 7, WTP1, WTP2, VUF, JUF, Venus STP  
Columns: Y Day, T Day, Diff  
→ Stored in `amenities` table with `section = 'Party Hall'`

### Section 6: Water Consumption Summary (bottom)
Master accountability row:  
`V Side Well B1+B2`, `N Side Well+B3`, `JTR Tanker`, `MTR Tanker`, `IN PUT total`, `Tower Usage (OUT PUT)`, `Diff`

**Key invariant:** `Tower Usage` here should approximately match total from Tower Section. A large `Diff` flags an anomaly.

### Indian Number Format
All numbers on the sheet use Indian comma convention: `1,76,000 = 176,000` (one lakh seventy-six thousand). Always output as plain integers: `176000`.

---

## Five-Engine OCR Pipeline — Core Architecture

This is the most important section. The pipeline in `src/lib/anthropic.ts` is the heart of the system.

### The Digit Confusion Problem
The recurring failure mode: handwritten 7 with a short crossbar is indistinguishable from 1 in photos. Example: `1,76,000` (176,000 L) is read as `1,16,000` (116,000 L) — a 60,000 L error. Neither Haiku nor Opus reliably catch this from pixel-reading alone. The solution is multi-engine cross-validation.

### Pipeline Flow

```
Phase 1 — Parallel (called by upload route before extractSheetData):
  ┌─ Qwen3-VL-8B (HuggingFace Router / Novita)    [src/lib/qwenVision.ts]
  │    Reads all 8 tower totals independently. Different visual encoder (DeepStack).
  │    When two architecturally different models agree on a digit, the reading is reliable.
  │    Env: HF_TOKEN
  │
  ├─ Mistral OCR 3 (mistral-ocr-2512)              [src/lib/mistralOcr.ts]
  │    Extracts full sheet as structured Markdown. Purpose-built for handwriting + tables.
  │    Output is injected into Haiku's context window — Haiku reads image + transcript.
  │    Env: MISTRAL_API_KEY
  │
  ├─ Google Vision (DOCUMENT_TEXT_DETECTION)        [src/lib/googleVision.ts]
  │    Word-level tokens for date + number corroboration in extractionValidator.
  │    Env: GOOGLE_CLOUD_VISION_API_KEY
  │
  └─ OCR.space Engine 2 (isTable=true)             [src/lib/ocrSpace.ts]
       Second word list. Free. Env: OCR_SPACE_API_KEY

Phase 2 — Sequential (inside extractSheetData):
  Claude Haiku  →  reads image + Mistral OCR transcript simultaneously
    │
    ├─ findQwenDisagreements(): ratio < 0.85 on any tower row = disagreement
    │    → Claude Opus (also gets transcript)
    │    → checkSanity(opusResult): total_ltrs/vol_today ratio < 0.6 or > 1.8
    │    → applyCorrections() if Opus also fails: substitute vol_today → confidence 0.65
    │
    ├─ checkSanity(haikuResult) violated (Qwen absent):
    │    → Claude Opus → checkSanity → applyCorrections if needed
    │
    └─ overall_confidence < 0.80:
         → Claude Opus → checkSanity → applyCorrections if needed
```

### Sanity Check Rules (`checkSanity` in anthropic.ts)

| Check | Condition | Action |
|-------|-----------|--------|
| DR range | `total_ltrs > 80,000` | `violated = true` |
| DO range | `total_ltrs > 300,000` | `violated = true` |
| DO cross-check | `total_ltrs / vol_today < 0.6` or `> 1.8` | `violated = true` + add correction |

When `violated = true` and `corrections` exist, `applyCorrections()` substitutes `vol_today` for `total_ltrs`, sets per-row `confidence = 0.65`, and adds `flagged_fields` entry. This is the last-resort safety net when both Haiku and Opus share the same digit misread.

### Key Functions in anthropic.ts

- `runExtraction(base64, mediaType, model, ocrTranscript?)` — calls Claude with optional Mistral OCR hint
- `checkSanity(result)` → `SanityReport { violated, corrections[] }`
- `applyCorrections(result, corrections)` — mutates result in place, lowers confidence
- `findQwenDisagreements(haiku, qwen)` → `string[]` of disagreeing fields
- `extractSheetData(base64, mediaType, qwenResult?, mistralOcr?)` — main entry point

### Cost Per Upload

| Engine | Cost |
|--------|------|
| Qwen3-VL-8B | ~$0.00012 |
| Mistral OCR 3 | ~$0.002 |
| Google Vision | ~$0.0015 |
| OCR.space | $0 |
| Claude Haiku | ~$0.003 |
| Claude Opus (escalation ~20%) | ~$0.005 avg |
| **Total** | **~$0.007/upload · ~$2.55/year** |

---

## Data Model

### `daily_sheets`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | auto |
| date | DATE | sheet date |
| uploaded_by | TEXT | nullable, no auth in v1 |
| image_url | TEXT | Supabase storage public URL |
| processed_status | TEXT | `pending` / `processed` / `failed` |
| confidence_score | DECIMAL(3,2) | overall extraction confidence 0–1 |
| date_source | TEXT | `ai` or `manual` |
| created_at | TIMESTAMPTZ | auto |
| superseded | BOOLEAN | `false` = canonical; `true` = older duplicate for the same date |

**Deduplication invariant:** If multiple sheets share the same `date`, the most-recently-created is canonical (`superseded = false`). All trend queries, dashboard reads, and averages filter `.eq('superseded', false)`. Never omit this filter.

### `tower_consumption`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | → daily_sheets |
| tower | TEXT | `Venus` / `Mercury` / `Neptune` / `Jupiter` |
| type | TEXT | `DO` or `DR` |
| r_yesterday | DECIMAL | |
| r_today | DECIMAL | |
| total_ltrs | DECIMAL | Primary consumption figure |
| vol_yesterday | DECIMAL | |
| vol_today | DECIMAL | Independent column — sanity cross-check + auto-correction source |
| diff | DECIMAL | |
| confidence | DECIMAL(3,2) | 0.65 = auto-corrected, needs human review |

### `water_sources`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | |
| location | TEXT | e.g. `M+V DO with MTR` |
| source_type | TEXT | nullable |
| r_yesterday | DECIMAL | |
| r_today | DECIMAL | |
| yesterday_ltrs | DECIMAL | |
| today_ltrs | DECIMAL | |
| total | DECIMAL | |

### `water_levels`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | |
| tank | TEXT | `JDO` / `JDR` / `CT` / `MDO` / `MDR` / `Fire Tank` |
| time_slot | TEXT | `6AM` / `12PM` / `6PM` / `12AM` |
| cm_reading | DECIMAL | |
| percentage | DECIMAL | |

### `amenities`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | |
| section | TEXT | `Car Wash` / `Swimming Pool` / `Party Hall` |
| meter_name | TEXT | e.g. `Jupiter`, `Meter 3`, `WTP1` |
| y_day | DECIMAL | |
| r_day | DECIMAL | |
| diff | DECIMAL | |

### `summary`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | |
| v_side | DECIMAL | V Side Well B1+B2 |
| n_side | DECIMAL | N Side Well+B3 |
| jtr_tanker | DECIMAL | |
| mtr_tanker | DECIMAL | |
| input_total | DECIMAL | IN PUT total |
| tower_usage | DECIMAL | OUT PUT — should match Tower Section total |
| diff | DECIMAL | large value = anomaly |

### `committee_members`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | auto |
| term | TEXT | e.g. `2026-27`, groups members by AGM cycle |
| name | TEXT | NOT NULL |
| role | TEXT | one of the 10 roles below |
| tower | TEXT | nullable — `Venus` / `Mercury` / `Neptune` / `Jupiter` |
| apartment | TEXT | nullable |
| phone | TEXT | nullable, stored as-entered (validated client-side) |
| email | TEXT | nullable — used for alert routing in production |
| whatsapp_optin | BOOLEAN | default false |
| active | BOOLEAN | default true — false = deactivated, not deleted |
| created_at | TIMESTAMPTZ | auto |

**Roles (in display order):** `President`, `Vice President`, `Secretary`, `Joint Secretary`, `Treasurer`, `Joint Treasurer`, `Technical Expert`, `Financial Expert`, `GC Chair`, `GC Member`

**Term lifecycle:** "Start New Term" archives all current active members (`active = false`), then clones selected members into the new term label. GC Members are per-tower. RLS: anon SELECT + INSERT + UPDATE (v1 permissive — no sensitive data).

---

## Tower Colors (used everywhere — do not change)

| Tower | Color | Hex |
|-------|-------|-----|
| Venus | Purple | `#7C3AED` |
| Mercury | Blue | `#2563EB` |
| Neptune | Green | `#059669` |
| Jupiter | Orange | `#EA580C` |

---

## Application Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Server Component | Dashboard — today's data + 7-day trend + infographic export |
| `/upload` | Client Component | Mobile-first photo upload with live SSE engine log |
| `/history` | Client Component | Consumption history — daily table + heatmap, flags, CSV export |
| `/committee` | Server Component | Public committee registry — Office Bearers, GC Chairs, GC Members by tower |
| `/committee/admin` | Client Component | Committee admin — add/edit/deactivate members, start new term |
| `/alerts` | Server Component | Email send history (`alert_log` table) |
| `/api/upload` | POST | Image → storage → all parallel engines → pending response |
| `/api/upload/stream` | POST SSE | Same pipeline with live Server-Sent Events log per engine |
| `/api/upload/confirm` | POST | Commit pending extraction to DB, trigger spike alert |
| `/api/cron/weekly-report` | GET | Vercel cron — Monday 08:00 IST (`30 2 * * 1`) |
| `/api/cron/monthly-report` | GET | Vercel cron — 1st of month 08:00 IST (`30 2 1 * *`) |

---

## Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=        # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Supabase anon key (public, used client-side)
SUPABASE_SERVICE_ROLE_KEY=       # Service role key (server-only, bypasses RLS)

# AI Extraction
ANTHROPIC_API_KEY=               # Claude Haiku + Opus (server-only)
HF_TOKEN=                        # HuggingFace token — enables Qwen3-VL-8B parallel extractor
MISTRAL_API_KEY=                 # Mistral — enables Mistral OCR 3 handwriting transcript

# OCR Engines
GOOGLE_CLOUD_VISION_API_KEY=     # Google Vision word-level OCR
OCR_SPACE_API_KEY=               # OCR.space free key (K83177836788957)

# App
NEXT_PUBLIC_TECHNICIAN_PHONE=    # Phone number shown on Template A infographic

# Email (Resend)
RESEND_API_KEY=
RESEND_SANDBOX=true              # Keep true — set false only when user explicitly asks
RESEND_DOMAIN=                   # Verified Resend domain (production only)
CRON_SECRET=                     # Vercel cron Authorization: Bearer header
```

All four OCR engine keys are optional — a missing key causes that engine to silently skip. The pipeline degrades gracefully but loses cross-validation benefit.

---

## What Is Built

- [x] Next.js 14 App Router project
- [x] Supabase schema migration (all tables incl. `committee_members`, `alert_log`, `superseded`, `date_source`)
- [x] Upload page `/upload` — mobile-first, camera capture, no login, live SSE engine log
- [x] API route `/api/upload` + `/api/upload/stream` (SSE) — five-engine parallel pipeline
- [x] API route `/api/upload/confirm` — commits to DB, fires spike alert
- [x] Dashboard `/` — tower cards, summary, 7-day trend, missing sheet alert, IST clock
- [x] Infographic Template A (Daily Tower Card) — animated GIF + static PNG
- [x] Infographic Template B (Pie Chart) — animated GIF + static PNG
- [x] Infographic Template C (Alert Poster) — animated GIF + static PNG
- [x] Committee registry `/committee` — public view, grouped by role and tower
- [x] Committee admin `/committee/admin` — add/edit/deactivate, start new term with member cloning
- [x] GitHub + Vercel deployment
- [x] Alert email system (Resend) — spike alerts + weekly + monthly cron reports
- [x] `/alerts` admin page — email send history / sandbox verification
- [x] `/history` — daily table + heatmap + cross-check flags + CSV export + dark/light mode
- [x] Date source badge (AI/Manual) in history table
- [x] Qwen3-VL-8B parallel extractor
- [x] Mistral OCR 3 context injection
- [x] Sanity checks on Opus escalation path + vol_today auto-correction

---

## What Is NOT Built Yet

- WhatsApp bot (decided against — not sustainable across committee terms)
- Technician login / auth (by design — reduces adoption friction)
- Per-flat consumption tracking
- Digital form entry (photo upload is sufficient for v1)
- Mobile app

---

## What Comes Next (v3+)

1. **Association member login + GC Chair role** — Supabase Auth, role-based dashboard access
2. **Historical trend reports** — month-over-month, anomaly history, export to PDF
3. **Anomaly detection + automated alerts** — email/push when consumption spikes
4. **Integration into Trinity World resident portal** — single login, consumption insights per flat
5. **Automated daily reminder** — if no upload by 9AM, ping technician via SMS/WhatsApp Business API

---

## Key Decisions and Why

**No login on upload page:** Technician doesn't need an account. The photo + date is enough accountability for v1. Adding auth would be a barrier to adoption.

**Haiku as primary (not Opus):** Opus is ~10× more expensive per upload. Haiku with the five-engine cross-validation architecture achieves equal or better accuracy for this use case. Opus is reserved as an escalation model.

**Qwen3-VL over Mistral Small/Pixtral-12B:** Mistral Small and Pixtral-12B were evaluated and dropped. Pixtral-12B is deprecated (no updates since Sep 2024, fine-text handwriting accuracy poor). Qwen3-VL-8B uses a different visual encoder (DeepStack) — architectural diversity is what makes the cross-validation meaningful.

**Mistral OCR 3 over preprocessing:** Image preprocessing (grayscale, contrast boost) helps with blur/tilt but not with the 1-vs-7 digit confusion, which is geometric. Mistral OCR 3 provides a structured text transcript that Haiku reads alongside the image — more effective for the actual failure mode.

**RLS permissive in v1:** All tables allow anon read/write. Water consumption data is not sensitive — it's shared community data. Auth comes in v3 when committee roles need enforcement.

**html-to-image over canvas:** html-to-image lets us use real CSS and Recharts SVG. Canvas approach would require reimplementing the entire design.

**Recharts over chart.js:** Better React integration, works with html-to-image's DOM capture since it renders SVG (not canvas).

**Party Hall stored in amenities table:** The schema doesn't warrant a separate table for 7 rows. `section` column distinguishes it.

---

## Supabase Storage

Bucket: `sheet-images` (public bucket, no auth required for upload)  
Images stored as: `pending-{timestamp}.{ext}`  
URLs are public and stored in `daily_sheets.image_url`

---

## Vision Extraction — Hardening Rules

These rules are baked into the extraction prompt in `src/lib/anthropic.ts`. Do NOT remove them.

### (a) Adjacent Row Duplication Prevention
Each source row (Section 2) must be read independently. Never copy a value from one row to the next. If two adjacent rows appear identical, re-examine before accepting.

### (b) Sanity Ranges (out-of-range → confidence 0.6)
| Field | Expected Range |
|-------|---------------|
| Tower DO `total_ltrs` | 50,000–250,000 L |
| Tower DR `total_ltrs` | 5,000–40,000 L |
| Source row `total` | 20,000–400,000 L |
| `summary.input_total` | 150,000–900,000 L |
| `summary.tower_usage` | 300,000–800,000 L |
| `summary.v_side` / `n_side` | 30,000–350,000 L |

### (c) Summary Section Label Anchoring
Section 6 values must be matched to their row **label**, never by position:
- `"V Side Well B1+B2"` → `v_side`
- `"N Side Well+B3"` → `n_side`
- `"JTR Tanker"` → `jtr_tanker`
- `"MTR Tanker"` → `mtr_tanker`
- `"IN PUT total"` → `input_total` (always larger than individual sources)
- `"Tower Usage (OUT PUT)"` → `tower_usage`
- `"Diff"` → `diff`

### (d) Mistral OCR Transcript Hint
When `ocrTranscript` is provided to `runExtraction`, it is appended to the user message after the image. Haiku is instructed to use it as a reference for digit ambiguities but to always verify against the image (transcript may have table alignment errors). Do not remove this injection.

---

## Re-Extract Script

**File:** `scripts/re-extract.ts`  
**Purpose:** Re-run Claude Vision extraction on flagged sheets using the hardened prompt, show field-by-field diffs, and optionally commit the new data.

```bash
# Dry run — shows old vs new values, does not write to DB
npx ts-node --project tsconfig.json scripts/re-extract.ts

# Commit — deletes child records and re-inserts with new extraction
npx ts-node --project tsconfig.json scripts/re-extract.ts --commit
```

- Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`
- Does NOT use `@/*` path aliases — imports SDK directly (ts-node limitation)
- `--commit` deletes from `tower_consumption`, `water_sources`, `water_levels`, `amenities`, `summary`, then re-inserts

---

## Deployment

- Push to `main` → Vercel auto-deploys
- Environment variables set in Vercel dashboard (same as .env.example keys)
- Supabase migrations run manually in Supabase SQL editor:
  - `supabase/migrations/001_initial_schema.sql` — initial 6 tables
  - `supabase/migrations/002_committee_and_dedup.sql` — `superseded` column, dedup CTE, `committee_members`, seeds 2026-27 term
  - `supabase/migrations/003_alert_log.sql` — `alert_log` table for email send history
- **IMPORTANT:** Migration 002 must be applied BEFORE deploying code that references `superseded` or `committee_members`
- **IMPORTANT:** Migration 003 must be applied BEFORE the email alert system will work

---

## Infographic GIF Pipeline

All three infographic templates support static PNG and animated GIF export.

**GIF export flow (client-side):**
1. User clicks "↓ GIF" in InfographicPanel
2. `animProgress` state resets to 0
3. A loop captures 22 frames (+ 5 hold frames) via `html-to-image` toPng at 2× pixel ratio
4. Each frame loaded as `HTMLImageElement`
5. All frames encoded into looping GIF via `gif.js` (Web Worker)
6. GIF blob downloaded to device

**Template animation props:** Each template accepts `animProgress?: number` (0–1, default 1 = static).
- **TemplateA:** Ken Burns zoom-out + number count-up + badge fade-in
- **TemplateB:** Pie draws in from top + total count-up + Ken Burns zoom-in
- **TemplateC:** Background zoom-in + count-up + alert icon pulse + tower color flash

**Background photos:** `public/branding/tw-1.jpg` through `tw-8.jpg`. Templates use tw-3 (A), tw-2 (B), tw-4 (C). 78–84% dark overlay for readability.

---

## Alert Email System (Resend)

### Architecture

| Component | Path |
|-----------|------|
| Email sender + HTML templates | `src/lib/email.ts` |
| Spike alert trigger | `src/app/api/upload/confirm/route.ts` |
| Weekly report cron | `src/app/api/cron/weekly-report/route.ts` |
| Monthly report cron | `src/app/api/cron/monthly-report/route.ts` |
| Alert history UI | `src/app/alerts/page.tsx` |
| DB migration | `supabase/migrations/003_alert_log.sql` |
| Cron schedule | `vercel.json` |

### Sandbox → Production Switch

**One-line change:** set `RESEND_SANDBOX=false` in Vercel environment variables.

| Variable | Sandbox (default) | Production |
|----------|-------------------|------------|
| `RESEND_SANDBOX` | `true` (or unset) | `false` |
| From address | `onboarding@resend.dev` | `alerts@RESEND_DOMAIN` |
| To address | `jacmani@gmail.com` | Active committee members from DB |

**Production prerequisites:**
1. Verify a domain in Resend dashboard
2. Set `RESEND_DOMAIN=yourdomain.com` in Vercel
3. Add email addresses to `committee_members.email` column
4. Set `RESEND_SANDBOX=false`

### Alert Types

| Type | Trigger | Recipients (prod) |
|------|---------|-------------------|
| `spike` | Every sheet upload — fires per tower if >15% above 7-day avg | President, Secretary, VP, GC Chairs |
| `weekly` | Vercel Cron: Monday 08:00 IST (`30 2 * * 1`) | All active committee members |
| `monthly` | Vercel Cron: 1st of month 08:00 IST (`30 2 1 * *`) | All active committee members |

Vercel Hobby plan: max cron frequency once per day. Weekly + monthly both qualify.

---

## History Page — Data Cross-Check Flagging Logic

**File:** `src/components/history/flagging.ts`  
**Used by:** `/history` daily table and heatmap (computed live, not stored).

Each processed sheet is assigned one flag in priority order:

| Priority | Flag | Trigger |
|----------|------|---------|
| 1 | `summary_misread` | `input_total` or `tower_usage` is null, OR `input_total > WS_sum × 1.5` |
| 2 | `digit_drop` | Any DO row < 50,000 L or DR row < 5,000 L **when other rows of the same type are normal** |
| 3 | `source_duplication` | Duplicate non-zero values in `water_sources.total` AND `WS_sum > input_total × 1.1` |
| 4 | `unexplained_gap` | `abs(TC_sum − tower_usage) > 10,000 L` or `abs(WS_sum − input_total) > 10,000 L` |
| 5 | `ok` | All sums within ±10 kL tolerance |

`TC_sum` = sum of all `tower_consumption.total_ltrs` for the sheet  
`WS_sum` = sum of all `water_sources.total` for the sheet  
`TOLERANCE` = 10,000 L

Low-confidence values (`confidence < 0.8`) shown italic/dimmed with ⚠ superscript in history table.

---

## Credentials & Tokens

**GitHub PAT** (jacmani): `<redacted — stored in Vercel env as GITHUB_PAT>`  
Valid 90 days from ~2026-06-18. Use for git push when index.lock blocks the sandbox.  
Usage: `git remote set-url origin https://<PAT>@github.com/jacmani/tw-water-automation.git && git push origin main`

**Git push method for sandbox sessions:** The local git index.lock is stale. Always use the GitHub Contents API (PUT) to push file changes. Fetch the current SHA for each file before pushing — pushing with a stale SHA will fail.
