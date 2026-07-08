# AGENTS.md — Trinity World Water Automation

**Hand this to any new Codex session cold. Read everything before touching code.**

---

## What This Is

A full-stack web application that replaces the WhatsApp photo dead-end at Trinity World residential apartment complex. Every morning a technician fills a handwritten water meter reading sheet. Previously: photo goes to WhatsApp, vanishes. Now: photo uploads to this system, Codex Vision extracts the data, it's stored in Supabase, and the committee gets structured dashboards and shareable infographics.

**Live URL:** https://tw-water-automation.vercel.app (Vercel, auto-deploys from main)  
**Repo:** https://github.com/jacmani/tw-water-automation  
**Supabase project:** Connect via env vars (see .env.example)

---

## Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | Next.js 14 App Router | Server components for DB reads, client components for interactivity |
| Database + Storage | Supabase (Postgres + S3-compatible) | Managed, free tier sufficient, easy RLS |
| Hosting | Vercel | Auto-deploy from GitHub, zero-config Next.js |
| AI Extraction | Anthropic Codex Vision (Codex-opus-4-7) | Best handwriting OCR + structured JSON output |
| Charts | Recharts | Works with html-to-image, SSR-compatible via 'use client' |
| Infographic Export | html-to-image | Converts DOM elements to PNG for WhatsApp sharing |

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
| Volume Today (Ltrs) | Today's volume |
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
| created_at | TIMESTAMPTZ | auto |
| superseded | BOOLEAN | `false` = canonical; `true` = older duplicate for the same date |

**Deduplication invariant:** If multiple sheets share the same `date`, the most-recently-created is canonical (`superseded = false`). All trend queries, dashboard reads, and averages filter `.eq('superseded', false)`. The migration SQL marks older duplicates on deploy. Re-uploads for the same date automatically become canonical.

### `tower_consumption`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | |
| sheet_id | UUID FK | → daily_sheets |
| tower | TEXT | `Venus` / `Mercury` / `Neptune` / `Jupiter` |
| type | TEXT | `DO` or `DR` |
| r_yesterday | DECIMAL | |
| r_today | DECIMAL | |
| total_ltrs | DECIMAL | |
| vol_yesterday | DECIMAL | |
| vol_today | DECIMAL | |
| diff | DECIMAL | |
| confidence | DECIMAL(3,2) | per-row confidence |

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
| tower_usage | DECIMAL | OUT PUT, should match Tower Section total |
| diff | DECIMAL | large value = anomaly |

### `committee_members`
| Field | Type | Notes |
|-------|------|-------|
| id | UUID PK | auto |
| term | TEXT | e.g. `2026-27`, used to group members by AGM cycle |
| name | TEXT | NOT NULL |
| role | TEXT | one of the 10 roles below |
| tower | TEXT | nullable — `Venus` / `Mercury` / `Neptune` / `Jupiter` |
| apartment | TEXT | nullable |
| phone | TEXT | nullable, stored as-entered (validated client-side) |
| email | TEXT | nullable |
| whatsapp_optin | BOOLEAN | default false |
| active | BOOLEAN | default true — false = deactivated, not deleted |
| created_at | TIMESTAMPTZ | auto |

**Roles (in display order):** `President`, `Vice President`, `Secretary`, `Joint Secretary`, `Treasurer`, `Joint Treasurer`, `Technical Expert`, `Financial Expert`, `GC Chair`, `GC Member`

**Term lifecycle:** "Start New Term" archives all current active members (`active = false`), then clones selected members into the new term label. GC Members are per-tower. RLS: anon SELECT + INSERT + UPDATE (v1 permissive — no sensitive data).

---

## Tower Colors (used everywhere — infographics, cards, charts)

| Tower | Color | Hex |
|-------|-------|-----|
| Venus | Purple | `#7C3AED` |
| Mercury | Blue | `#2563EB` |
| Neptune | Green | `#059669` |
| Jupiter | Orange | `#EA580C` |

---

## Infographic Templates

Three WhatsApp-shareable portrait PNG exports, generated via html-to-image at 2× pixel ratio.

### Template A — Daily Tower Card
- Dark navy background (`#0F172A`)
- One tower at a time (selector on dashboard)
- Tower name, today's consumption (large), yesterday, 2 days ago, 7-day average
- Tower color accent bar
- 3 water conservation tips
- Technician contact number field

### Template B — Tower Wise Pie Chart
- White/light-blue design
- All 4 towers: litres + percentage
- Recharts PieChart
- Highest and lowest tower callout
- Total community consumption
- Date

### Template C — Alert Poster
- Red/black aggressive design (`#DC2626` on `#0F0F0F`)
- **Triggers only when any tower is ≥15% above its 7-day average**
- Tower name, consumption figure, % above normal
- Actionable tips
- Tagline: "Stay Alert. Stay in Control."

---

## Application Routes

| Route | Type | Purpose |
|-------|------|---------|
| `/` | Server Component | Dashboard — today's data + 7-day trend + infographic export |
| `/upload` | Client Component | Mobile-first photo upload form |
| `/history` | Client Component | Consumption history — daily table + heatmap, flags, CSV export |
| `/committee` | Server Component | Public committee registry — Office Bearers, GC Chairs, GC Members by tower |
| `/committee/admin` | Client Component | Committee admin — add/edit/deactivate members, start new term |
| `/alerts` | Server Component | Email send history (alert_log table) |
| `/api/upload` | POST Route Handler | Receives image → Supabase storage → Codex Vision → all DB tables |

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=        # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=   # Supabase anon key (public, used client-side)
SUPABASE_SERVICE_ROLE_KEY=       # Service role key (server-only, bypasses RLS)
ANTHROPIC_API_KEY=               # Anthropic API key (server-only)
NEXT_PUBLIC_TECHNICIAN_PHONE=    # Phone number shown on Template A infographic
```

---

## What Is Built

- [x] Next.js 14 App Router project
- [x] Supabase schema migration (all 6 tables + `committee_members` + `superseded` column)
- [x] Upload page `/upload` — mobile-first, camera capture, no login
- [x] API route `/api/upload` — image → Supabase storage → Codex Vision → all tables
- [x] Dashboard `/` — tower cards, summary, 7-day trend, missing sheet alert
- [x] Infographic Template A (Daily Tower Card) — animated GIF + static PNG
- [x] Infographic Template B (Pie Chart) — animated GIF + static PNG
- [x] Infographic Template C (Alert Poster) — animated GIF + static PNG
- [x] Committee registry `/committee` — public view, grouped by role and tower
- [x] Committee admin `/committee/admin` — add/edit/deactivate, start new term with member cloning
- [x] GitHub + Vercel deployment
- [x] Alert email system (Resend) — spike alerts + weekly + monthly cron reports
- [x] `/alerts` admin page — email send history / sandbox verification

---

## What Is NOT Built Yet

- WhatsApp bot (decided against — not sustainable across committee terms)
- Technician login / auth
- Per-flat consumption tracking
- Digital form entry (photo upload is sufficient for v1)
- Mobile app

---

## What Comes Next (v2+)

1. **Association member login + GC Chair role** — Supabase Auth, role-based dashboard access
2. **Historical trend reports** — month-over-month, anomaly history, export to PDF
3. **Anomaly detection + automated alerts** — email/push when consumption spikes
4. **Integration into Trinity World resident portal** — single login for residents, consumption insights per flat
5. **Automated daily reminder** — if no upload by 9AM, ping technician via SMS/WhatsApp Business API

---

## Key Decisions and Why

**No login on upload page:** Technician doesn't need an account. The photo + date is enough accountability for v1. Adding auth would be a barrier to adoption.

**Codex Opus for extraction:** Handwriting quality varies. Opus gives the best extraction accuracy on messy handwriting. Cost per upload is negligible vs. data quality.

**RLS permissive in v1:** All tables allow anon read/write. Water consumption data is not sensitive — it's shared community data. Auth comes in v2 when committee roles need enforcement.

**html-to-image over canvas:** html-to-image lets us use real CSS and Recharts SVG. Canvas approach would require reimplementing the entire design.

**Recharts over chart.js:** Better React integration, works with html-to-image's DOM capture since it renders SVG (not canvas).

**Party Hall stored in amenities table:** The schema doesn't warrant a separate table for 7 rows. `section` column distinguishes it.

---

## Supabase Storage

Bucket: `sheet-images` (public bucket, no auth required for upload)  
Images stored as: `{date}-{timestamp}.{ext}`  
URLs are public and stored in `daily_sheets.image_url`

---

## Vision Extraction — Hardening Rules

These rules are baked into the extraction prompt in `src/lib/anthropic.ts`. Do NOT remove them.

### (a) Adjacent Row Duplication Prevention
Each source row (Section 2) must be read independently. Never copy a value from one row to the next. If two adjacent rows appear identical, re-examine before accepting. Identical consecutive totals in `water_sources` are almost always a Vision error.

### (b) Sanity Ranges (out-of-range → confidence 0.6)
| Field | Expected Range |
|-------|---------------|
| Tower DO `total_ltrs` | 50,000–250,000 L |
| Tower DR `total_ltrs` | 5,000–40,000 L |
| Source row `total` | 20,000–400,000 L |
| `summary.input_total` | 150,000–900,000 L |
| `summary.tower_usage` | 300,000–800,000 L |
| `summary.v_side` / `n_side` | 30,000–350,000 L |

Out-of-range fields get `confidence: 0.6` and are appended to `flagged_fields` as `"field: out_of_range (value)"`.

### (c) Summary Section Label Anchoring
Section 6 values must be matched to their row **label**, never by position. Known failure mode: Vision places `input_total` into `v_side` when it misreads the row alignment. The extraction prompt maps each label explicitly:
- `"V Side Well B1+B2"` → `v_side`
- `"N Side Well+B3"` → `n_side`
- `"JTR Tanker"` → `jtr_tanker`
- `"MTR Tanker"` → `mtr_tanker`
- `"IN PUT total"` → `input_total` (always larger than individual sources)
- `"Tower Usage (OUT PUT)"` → `tower_usage`
- `"Diff"` → `diff`

---

## Re-Extract Script

**File:** `scripts/re-extract.ts`  
**Purpose:** Re-run Codex Vision extraction on flagged sheets using the hardened prompt, show field-by-field diffs, and optionally commit the new data.

**Usage:**
```bash
# Dry run — shows old vs new values, does not write to DB
npx ts-node --project tsconfig.json scripts/re-extract.ts

# Commit — deletes child records and re-inserts with new extraction
npx ts-node --project tsconfig.json scripts/re-extract.ts --commit
```

**Notes:**
- Requires `.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`
- Does NOT use `@/*` path aliases — imports Anthropic SDK and supabase-js directly (ts-node limitation)
- `--commit` deletes from `tower_consumption`, `water_sources`, `water_levels`, `amenities`, `summary`, then re-inserts fresh extraction and updates `confidence_score`

---

## Deployment

- Push to `main` → Vercel auto-deploys
- Environment variables set in Vercel dashboard (same as .env.example keys)
- Supabase migrations run manually in Supabase SQL editor:
  - `supabase/migrations/001_initial_schema.sql` — initial 6 tables
  - `supabase/migrations/002_committee_and_dedup.sql` — adds `superseded` column, dedup CTE, creates `committee_members` table, seeds 24 members for term `2026-27`
  - `supabase/migrations/003_alert_log.sql` — `alert_log` table for email send history
- **IMPORTANT:** Migration 002 must be applied BEFORE deploying code that references `superseded` or `committee_members`
- **IMPORTANT:** Migration 003 must be applied BEFORE the email alert system will work

---

## Infographic GIF Pipeline

All three infographic templates support both static PNG export and animated GIF export.

**GIF export flow (client-side):**
1. User clicks "↓ GIF" in InfographicPanel
2. `animProgress` state for that template resets to 0
3. A loop captures 22 frames (+ 5 hold frames at the end) via `html-to-image` toPng at 2× pixel ratio
4. Each frame is loaded as an `HTMLImageElement`
5. All frames are encoded into a looping GIF via `gif.js` (Web Worker based)
6. GIF blob is downloaded to the user's device

**gif.js setup:**
- Package: `gif.js` (npm)
- Worker file copied to `public/gif.worker.js` at install time
- Dynamically imported at click time — never loaded server-side

**Template animation props:**
Each template accepts `animProgress?: number` (0–1, default 1 = static).
- **TemplateA:** Ken Burns zoom-out on background + number count-up + badge fade-in
- **TemplateB:** Pie draws in from top (recharts `startAngle=90, endAngle=90-360*p`) + total count-up + Ken Burns zoom-in
- **TemplateC:** Background zoom-in + number count-up + alert icon pulse + tower color flash

**Background photos:** 8 Trinity World photos in `public/branding/tw-1.jpg` through `tw-8.jpg`. Templates use tw-3 (A), tw-2 (B), tw-4 (C). All have 78–84% dark overlay for readability.

**PNG export still works:** `toPng` called directly on the ref at `animProgress=1`.

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

### Vercel Cron — Hobby Plan Compatibility

Vercel Hobby plan allows cron jobs with a **maximum frequency of once per day**. Both schedules (weekly on Monday, monthly on 1st) run less frequently than daily — they are compatible. The cron auth header `Authorization: Bearer <CRON_SECRET>` must be set in Vercel env vars.

### alert_log Schema

```
id          uuid pk
alert_type  text          -- 'spike' | 'weekly' | 'monthly'
sheet_date  date          -- null for aggregate reports
tower       text          -- null for community-wide reports
recipients  text[]
subject     text
sent_at     timestamptz
status      text          -- 'sent' | 'error'
details     jsonb         -- resend_id, error string, sandbox flag
```

Every send (success or error) is logged regardless of sandbox/production mode. Verify sends at `/alerts`.

---

## History Page — Data Cross-Check Flagging Logic

**File:** `src/components/history/flagging.ts`  
**Used by:** `/history` daily table and heatmap (computed live, not stored).

Each processed sheet is assigned one flag in priority order:

| Priority | Flag | Trigger |
|----------|------|---------|
| 1 | `summary_misread` | `input_total` or `tower_usage` is null, OR `input_total > WS_sum × 1.5` |
| 2 | `digit_drop` | Any DO row < 50,000 L or DR row < 5,000 L **when other rows of the same type are normal** |
| 3 | `source_duplication` | Duplicate non-zero values exist in `water_sources.total` AND `WS_sum > input_total × 1.1` |
| 4 | `unexplained_gap` | `abs(TC_sum − tower_usage) > 10,000 L` or `abs(WS_sum − input_total) > 10,000 L` |
| 5 | `ok` | All sums within ±10 kL tolerance |

**Abbreviations:**  
`TC_sum` = sum of all `tower_consumption.total_ltrs` for the sheet  
`WS_sum` = sum of all `water_sources.total` for the sheet  
`TOLERANCE` = 10,000 L (±10 kL)

The flag `detail` string contains specific numbers for the tooltip/expanded row explanation (e.g. "Output Δ +85.5 kL (TC 660.5 kL vs recorded 575.0 kL)").

Low-confidence extraction values (`confidence < 0.8`) are rendered italic/dimmed in the history table with a `⚠` superscript — they're visually flagged without interrupting the layout.

---

## Credentials & Tokens

**GitHub PAT** (jacmani): `<redacted — stored in Vercel env as GITHUB_PAT>`  
Valid 90 days from ~2026-06-18. Use for git push when index.lock blocks the sandbox.  
Usage: `git remote set-url origin https://<PAT>@github.com/jacmani/tw-water-automation.git && git push origin main`
