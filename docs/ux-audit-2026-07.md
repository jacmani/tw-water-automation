# TW Water Automation — UI/UX Audit v2 (July 2026)

**Date:** 3 July 2026
**Scope:** Full system — Dashboard, Upload, Log Book (view + entry form), History, Committee, Alerts, Navbar — audited from both the codebase (working tree) and the live production site.
**Skills used:** design:design-critique, design:accessibility-review, design:ux-copy, design:design-system, product-management synthesis.
**Predecessor:** `docs/ux-audit.md` (26 June 2026). This audit verifies what was fixed, then covers what's new. Read that file for the technician persona and email-template plan — both still stand.

---

## 0. Executive Summary

**Overall score: 78 / 100** (up from 71 in June).

The June-audit fixes are real and good — but most of them are **sitting uncommitted in the working tree and are not what users see in production**. The single biggest UI/UX action available today is not a design change at all: **ship the pending work**. After that, the top themes are: three pages that ignore light mode entirely, the upload flow's post-idle screens still hardcoded dark, a set of measurable WCAG contrast failures (including the primary WhatsApp CTA), zero keyboard/focus support on custom interactive elements, and a dashboard hero band that displays arithmetic that visibly doesn't add up — a data-trust problem in the most authoritative spot in the app.

---

## 1. Verification of the June 2026 Audit (what's actually fixed)

| June finding | Status in working tree | Status in production |
|---|---|---|
| C1 TowerCard label swap | ✅ Fixed (`Today` / `Yesterday` / `7-day avg`) | ✅ Live |
| C2 Brand monogram (navbar + email) | ✅ Fixed (violet drop LogoMark) | ⚠️ Mixed — see P0-1 |
| C3 Emoji nav icons → SVG | ✅ Fixed in Navbar | ❌ `/upload` still serves old emoji navbar |
| M1 Section label hierarchy | ✅ Fixed (`.section-label--primary`) | ✅ Live |
| M2 Upload drop zone light mode | ✅ Fixed (idle screen only — see P1-2) | ❌ Old drop zone live |
| M3 SummaryRow hero band | ✅ Fixed (responsive text scale) | ✅ Live |
| M4 Progress bar gradient | ✅ Fixed (solid `bg-blue-500`) | ❌ Not live |
| M5 ISTClock competing with title | ✅ Fixed (small badge under title) | ✅ Live |
| m2 Inter font import | ✅ Fixed (`next/font`) | ✅ Live |
| m3 Heatmap legend | ✅ Fixed (5-step legend + avg) | ✅ Live |
| I1 TowerCard sparklines | ✅ Built | ✅ Live |
| I2 WhatsApp share on success | ✅ Built (Web Share API + poster) | ❌ Not live |
| Phase 2 email templates | ✅ Largely built | Unverifiable from outside |

**Conclusion:** ~90% of the June plan is implemented, but `git status` shows ~30 modified files uncommitted, and the live `/upload` page (verified by fetch) still serves the **pre-audit UI** — emoji nav, "Submit Sheet", old drop-zone copy, and a different `viewport` meta than the other routes (proof that stale/mixed builds are being served). The technician — the primary user — is the one user who hasn't received any of this work.

---

## 2. Critical Findings (P0)

### P0-1 — Production is serving a stale, mixed build; a month of UX work is unshipped
**Evidence:** Live `/` and `/committee` render the new navbar and `maximum-scale=1` viewport; live `/upload` renders the old emoji navbar, old copy, and a viewport without `maximum-scale` — two different builds on one domain. `git status` shows the entire June fix batch modified-but-uncommitted.
**Why it matters:** Every finding below is secondary to this. The WhatsApp share flow — the highest-impact feature for the technician workflow — exists only on your machine.
**Fix:** Commit, push, redeploy, and hard-purge the Vercel cache for `/upload`. Then spot-check every route against the build ID.

### P0-2 — Dashboard hero band displays arithmetic that doesn't add up
**Evidence (live, 2 Jul sheet):** Input `43,300 L`, Tower Usage `5,98,000 L`, Diff `+1,65,000 L`. Usage is 13× input, yet Diff is shown positive and green-adjacent framing ("Community water balance"). 598,000 − 43,300 = 554,700, not 165,000. The Inflow panel repeats it: Total In 43,300, Total Out 5,98,000, **Balance +1,65,000 in green**.
**Root cause:** `SummaryRow` and `InflowSummaryPanel` render the *extracted* diff/balance field verbatim and only color it by sign/threshold. They never cross-check it against the two numbers displayed next to it. A misread sheet produces an authoritative-looking, impossible headline.
**Why it matters:** This is the committee's #1 governance number. One screenshot of this in the WhatsApp group undermines trust in the whole AI pipeline.
**Fix:** Compute `displayedDiff = input − usage` client-side. If the extracted diff disagrees by > tolerance, show the computed value with a "doesn't match sheet — sheet says X" badge, reuse the history page's `summary_misread` flag inline, and link to `/history` for the flagged row. Never render a green positive balance when Out > In.

### P0-3 — Primary success CTA fails contrast (WhatsApp share button)
**Evidence:** White text on `#25D366` = **1.98:1** (needs 4.5:1; even large-text needs 3:1). This is the most important button in the technician's day, used outdoors in morning sunlight on a budget Android screen — the worst possible viewing conditions for low contrast.
**Fix:** Dark text on the green (`#0B3D1F` on `#25D366` ≈ 8:1), or keep white text on WhatsApp's darker `#128C7E` (≈ 4.7:1). Keep the brand green as the container, fix the text.

### P0-4 — Three pages have no light mode at all
**Evidence:** `/logbook`, `/upload/logbook`, and `/alerts` hardcode `bg-slate-950 text-white` and slate-800/900 cards with zero `dark:` variants. A committee member in light mode navigates Dashboard (light) → Log Book (suddenly black) → Committee (light).
**Why it matters:** Jarring theme whiplash reads as broken; the system-level theme toggle silently does nothing on 3 of 7 pages.
**Fix:** Convert to the same token pattern as History/Committee. The `Field` component in the logbook entry form is the main lift (one component, reused everywhere).

---

## 3. Major Findings (P1)

### P1-1 — Pinch-zoom is disabled app-wide (WCAG 1.4.4 / 1.4.10 failure)
`layout.tsx` sets `maximumScale: 1`. Committee members are largely 40+; the technician inspects photographed handwriting on the confirm screen — both need zoom. iOS ignores this; Android respects it.
**Fix:** Delete `maximumScale` (keep `width`/`initialScale`).

### P1-2 — Upload flow is light-mode-fixed only on the idle screen
The June M2/M6 fix themed the idle screen, but every subsequent state — progress, confirm, date picker, success, error, FlagCards, ProcessingLog, manual-entry gate — hardcodes `bg-slate-900/800` cards, white text, `border-slate-700`. In light mode the flow flips dark the moment the technician taps Upload. Also the idle screen's own divider is `border-slate-800` (dark hex on white page).
**Fix:** Either tokenize the rest of the flow, or make an explicit product decision that the upload pipeline screens are always-dark ("camera app" convention) — and then force `.dark` on that route so it's intentional and consistent, not half-and-half.

### P1-3 — No keyboard access or focus visibility anywhere (WCAG 2.1.1, 2.4.7, 4.1.2)
Verified: **zero** `focus-visible` styles, zero `role=` attributes, 10 `aria-*` in the whole app.
- History `DailyTable` rows expand via `onClick` on `<tr>` — no `tabIndex`, no Enter/Space handler, no `aria-expanded`. Keyboard users cannot open row detail at all.
- `CalendarHeatmap` cells are `<div>`s with mouse-only handlers — no keyboard, and the caption says "Hover / tap" but there is no touch handler; on mobile the tooltip appearing depends on emulated mouseenter, and the tooltip itself (`bg-slate-800`, white text) is dark-hardcoded inside a light-mode card.
- Default browser focus rings are visible-ish, but most buttons use `focus:outline-none` on inputs without replacement rings.
**Fix:** Add a global `:focus-visible` ring token; make table rows `<button>`-semantics (`tabIndex=0`, `onKeyDown`, `aria-expanded`); give heatmap cells `role="gridcell" tabIndex=0` + focus-triggered tooltip + an `onClick` for touch.

### P1-4 — Light-mode secondary text fails contrast on every card
`text-slate-400` (#94A3B8) on white = **2.56:1**, used for: TowerCard "Today" label, page subtitles, ISTClock, history hint text, committee apt/phone lines. `text-slate-600` on `bg-slate-950` (alerts empty state) = 2.66:1.
**Fix:** Floor light-mode secondary text at `slate-500` (4.76:1) and dark-mode muted at `slate-400`. One pass over `text-slate-400`/`text-muted` usages; the tokens already exist in `globals.css`.

### P1-5 — Tooltip-only information is unreachable on touch devices
Three places put essential info exclusively in `title=` attributes: history flag badges (`title={flag.detail}`), low-confidence values (`title="Confidence: X%"`), alerts recipients (`title={row.recipients.join(', ')}`). `title` never fires on mobile — and this is a mobile-first user base.
**Fix:** Tap-to-toggle popover (or the expanded row area) for flag detail and recipients; put confidence into the expanded row.

### P1-6 — Log Book entry form: 100+ field grind with no progress state, no draft persistence, and a destructive back link
The 8-section wizard is well-structured, but: (a) section tabs don't show completion (which sections have data? which are untouched?); (b) all state is in-memory — one accidental back-swipe after 10 minutes of number entry loses everything (the header back-arrow to `/upload` does exactly this with no confirmation); (c) "Save Draft" writes to the server but the form doesn't *load* an existing draft — `?date=` edit deep-link from `/logbook` renders an empty form (data loss trap: re-submitting blanks an existing entry); (d) no per-field validation (a cumulative lower than yesterday's passes silently).
**Fix:** Autosave to `localStorage` keyed by date; hydrate the form from `/api/logbook?date=` when editing; add per-tab dot indicators (empty / partial / done); confirm-before-leave when dirty.

### P1-7 — Manual-totals rescue screen inputs have no accessible labels
The `input` in the missing-tower-totals gate and the logbook `Field` labels are visually adjacent but not programmatically associated (no `htmlFor`/`id`), and DatePickerScreen's label is likewise unassociated (WCAG 3.3.2 / 1.3.1). Screen readers announce "edit text, blank."
**Fix:** `useId()` + `htmlFor` in `Field` and the two upload-flow inputs. ~15 minutes of work.

---

## 4. Moderate Findings (P2)

**P2-1 — `/alerts` is an internal debug view in public navigation.** Cron syntax (`30 2 * * 1`), migration file names, env-var instructions, and the sandbox recipient email are shown to any resident who taps "Alerts" in the navbar. Either reframe as a human-readable "Notifications" page (what was sent, to whom, when — no ops jargon), or drop it from the navbar and reach it via `/committee/admin`.

**P2-2 — Two parallel data models are shown side-by-side with no explanation.** The dashboard mixes sheet-derived panels ("Tower Consumption — 2 Jul") and logbook-derived panels ("Inflow / Usage — 2 Jul") that can disagree for the same date (and on the live site, they do). Nothing tells the committee which source is authoritative. Add a small source chip on each panel ("from photo extract" / "from manual log book") and reconcile dates visibly when they differ.

**P2-3 — History "6m" preset default fetch loads everything unpaginated.** The Supabase query has no `.limit()`; a 180-day range with nested `tower_consumption` + `water_sources` rows is a heavy payload on mobile data. Add `.limit()` + range pagination server-side, not just client-side slicing.

**P2-4 — Heatmap is dark-theme-only inside a themed page.** Cell palette (`#0A0F1E` empty, `#05080F` out-of-range), day/month label hex colors, and the tooltip are all hardcoded dark inside a `bg-white dark:bg-slate-900` card. In light mode it looks like a rendering bug.

**P2-5 — Committee page has no contact affordance.** Phone numbers render as plain text — on the phones where this is used, they should be `tel:` links (and optionally a `wa.me` link since WhatsApp is the community's medium). Also there's no empty-state guard for a member with neither apartment nor phone; cards collapse to name+role with uneven heights.

**P2-6 — `/committee/admin` and `/upload/logbook` are one tap away from public with zero guard.** Consistent with the v1 no-auth decision, but there's not even a soft gate (confirm dialog, shared PIN, or `noindex`). A bored resident can archive the entire committee via "Start New Term". At minimum add a "This changes public data" confirm + `robots` noindex on admin routes until v3 auth.

**P2-7 — Emoji still carry meaning in the upload flow.** June C3 replaced navbar emoji, but the upload flow still uses ⏳✅⚠️❌🔍📍💡📅📷 as status/semantic icons (ProcessingLog levels, FlagCards, drop zone). Inconsistent with the new SVG system and unreadable to screen readers (announced as "hourglass", "round pushpin"…). Swap for the same inline SVG set with `aria-hidden` + text labels.

**P2-8 — ProcessingLog is engineering-voiced for a non-technical user.** Engine names ("Qwen agreement gate", "Mistral OCR"), token costs ("💰 Total this scan"), and per-engine timings are surfaced to the technician. It's genuinely impressive — to us. To him it's noise between "I tapped upload" and "did it work?". Keep the full log behind the collapsed "Processing details" (already built), but make the *live* view 3 plain-language stages ("Reading your photo… Checking the numbers… Almost done") with the detailed log opt-in.

---

## 5. UX Copy (targeted fixes)

| Location | Current | Recommended | Why |
|---|---|---|---|
| SummaryRow section label | "Community water balance" | keep, but add "from yesterday's sheet" suffix when sheet date ≠ today | Committee repeatedly reads stale data as today's |
| Upload error | "Upload failed — please try again on WiFi." | "Upload didn't go through. Your photo is still here — tap Try Again (WiFi helps)." | Reassure: no data lost, photo not gone |
| Date picker banner | "The AI couldn't read the date from this sheet with enough confidence." | "We couldn't read the date on this sheet. Pick the date — everything else is done." | Shorter; removes "confidence" jargon |
| Manual totals gate | "…couldn't be read — please copy them from your sheet" | keep — this is good | Row-exact instructions are best-in-class |
| Logbook empty state | "No log entry found for {date}." | "No log for {date} yet. + Add this day's log" (button, not text link) | Empty state should carry the primary action |
| Alerts sandbox banner | env-var instructions | Move instructions to README; banner just says "Test mode — emails go only to the administrator" | Public page, non-technical audience |
| MissingSheetAlert body | 2-sentence explanation | Good as-is; consider adding technician's `tel:` link | The reader's next action is calling him |
| History low-confidence ⚠ superscript | tooltip only | "⚠ AI unsure" text in expanded row | Touch users never see the tooltip |

Terminology consistency: the app currently uses "sheet", "log", "log book", and "entry" for overlapping concepts across routes. Pick two: **Sheet** = photographed page; **Log Book** = manual entry; use them everywhere (nav, buttons, empty states).

---

## 6. Design System Audit

**Score: 62/100.** Tokens exist (`globals.css`) but adoption is ~50%.

| Category | State |
|---|---|
| Color tokens | Defined in `:root`/`.dark`, but 3 whole pages + upload sub-screens bypass them; `email.ts` has **64 hardcoded hex values** (June's `EMAIL_TOKENS` extraction never happened) |
| Icon system | 3 systems coexist: inline SVG set (Navbar/ThemeToggle), emoji (upload flow, badges: ✓ ⚠ ✋ ▶ ✕), hand-drawn SVGs (infographics). Consolidate on the inline SVG set — no library needed, the pattern is already established |
| Typography | Inter + Playfair + DM Sans all loaded; Playfair/DM Sans appear only in infographic templates. Fine, but document it — otherwise the next session "cleans up" the unused-looking fonts and breaks the posters |
| Radius/spacing | `rounded-xl` largely consistent; stray `rounded-lg` on inputs is fine as an input convention if declared |
| Components | No shared Button/Card/Badge primitives — every screen re-writes `px-3 py-1.5 rounded-lg text-xs …`. At current app size this is the right moment to extract `<Btn>`, `<Card>`, `<Badge>` (one file, ~60 lines) before drift gets worse |
| Focus states | Absent (see P1-3) — add `--ring` token |

---

## 7. Product Recommendations

1. **Ship, then instrument.** (P0-1) After deploying, add the simplest possible telemetry — even a Supabase `page_views` insert — so the next audit can say "committee members actually use History" instead of guessing.
2. **Trust indicators are the product.** The system's value proposition is "numbers you can trust without finding the paper sheet." Every surface that shows a number should be able to answer "where did this come from and how sure are we?" — the history page does this well (flags, confidence, manual-date badges); the dashboard does it worst (P0-2). Unify: one `DataProvenance` chip component used on dashboard panels, posters, and emails.
3. **Close the technician loop end-to-end.** The success-screen share poster (built, unshipped) completes the June JTBD analysis. After shipping, the remaining gap is the *reminder* side: the v3 roadmap's "no upload by 9 AM → ping technician" is now the highest-leverage unbuilt feature, and cheap (one Vercel cron + `wa.me` is impossible server-side, so use email-to-SMS or keep it as a committee-facing nudge in the existing MissingSheetAlert with a `tel:` link).
4. **Reconcile the two data models** (P2-2) before building more on top. Sheet-extract vs. logbook-manual is now a schema-level fork (`daily_sheets` vs `daily_logs` families). Decide: is the logbook the future canonical source with photo-extract as a fallback, or vice versa? Every new feature (trends, reports, alerts) currently has to choose a side silently.
5. **Committee page as directory, not registry** (P2-5): `tel:`/WhatsApp links turn a static list into the thing people actually need mid-incident.
6. **Defer** dark-mode emails, per-flat tracking, and the resident-portal integration — nothing in this audit raises their priority.

---

## 8. Prioritized Implementation Plan

### Phase 0 — Ship it (½ day)
1. Commit + push the working tree, redeploy, purge Vercel cache, verify `/upload` serves the new build.

### Phase 1 — Trust & safety quick wins (1 day)
2. SummaryRow/Inflow computed-diff cross-check + mismatch badge (P0-2)
3. WhatsApp CTA contrast fix (P0-3)
4. Remove `maximumScale: 1` (P1-1)
5. Light-mode secondary-text contrast pass (P1-4)
6. `htmlFor`/`id` on all form fields (P1-7)

### Phase 2 — Theming completion (1–2 days)
7. `/logbook`, `/upload/logbook`, `/alerts` light mode (P0-4)
8. Upload flow post-idle screens: tokenize or declared always-dark (P1-2)
9. Heatmap + tooltip theming (P2-4)

### Phase 3 — Interaction depth (2 days)
10. Focus-visible token + keyboard support for table rows and heatmap (P1-3)
11. Touch-accessible flag/recipient/confidence details (P1-5)
12. Logbook form: autosave, edit-hydration, dirty-guard, tab completion dots (P1-6)

### Phase 4 — Coherence (1–2 days)
13. Alerts page reframe or demotion (P2-1)
14. Data-source provenance chips on dashboard panels (P2-2)
15. Emoji → SVG in upload flow; extract `<Btn>/<Card>/<Badge>`; `EMAIL_TOKENS` (P2-7, §6)
16. ProcessingLog plain-language live view (P2-8)
17. Committee `tel:` links + admin soft-gate (P2-5, P2-6)

---

## 9. What's Working Well (don't touch)

- The annotated-canvas flag review with section bands and per-row cards — still best-in-class error UX.
- The manual-totals rescue gate: exact row/column names from the physical sheet, human-entered = confidence 1. Exemplary.
- Review vs. auto-fixed flag severity split with calm summary copy — exactly what the June audit asked for.
- Sparklines, section-label hierarchy, IST-anchored dates, superseded-sheet dedup discipline.
- History page's flag taxonomy and manual-date badges — the trust model to copy elsewhere.
- The share-poster pre-generation trick (File cached before the tap so `navigator.share` stays in the gesture window) — subtle and correct.

---

*Audit completed 3 July 2026. Next session: Phase 0 (ship), then Phase 1.*
