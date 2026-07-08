import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

// IDEMPOTENT, swap-history-independent correction.
// Two competing backfill scripts ran concurrently earlier and left some rows single-swapped
// (correct) and some double-swapped (reverted to the original wrong values) — parity is
// unknown per-row. Instead of trying to track swap counts, use physical domain logic:
// across every confirmed-correct example (per user's ground truth + CLAUDE.md's own
// documented "80/26 = 80cm, 26%" example), cm_reading is ALWAYS the larger number and
// percentage is ALWAYS the smaller number (because every tank here is >100cm tall, so
// cm = pct/100 * height > pct whenever height > 100). This is true regardless of how the
// two values are currently mislabeled, so max(cm,pct)->cm_reading, min(cm,pct)->percentage
// is a swap-history-independent fix.
async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  let allRows: { id: string; cm_reading: number | null; percentage: number | null }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('water_levels').select('id, cm_reading, percentage').range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const needsFix = allRows.filter(r =>
    r.cm_reading != null && r.percentage != null && r.cm_reading < r.percentage
  );
  console.log('Total rows:', allRows.length, '| rows needing correction (cm < pct):', needsFix.length);

  const CONCURRENCY = 40;
  let updated = 0, failed = 0;
  for (let i = 0; i < needsFix.length; i += CONCURRENCY) {
    const chunk = needsFix.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(row =>
      supabase.from('water_levels').update({ cm_reading: row.percentage, percentage: row.cm_reading }).eq('id', row.id)
    ));
    for (const r of results) { if (r.error) { failed++; console.error(r.error.message); } else updated++; }
  }
  console.log('DONE. Corrected:', updated, '| Failed:', failed);

  // Sanity check after fix
  let after: { cm_reading: number | null; percentage: number | null }[] = [];
  from = 0;
  while (true) {
    const { data } = await supabase.from('water_levels').select('cm_reading, percentage').range(from, from + 999);
    if (!data || data.length === 0) break;
    after = after.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const stillBad = after.filter(r => r.cm_reading != null && r.percentage != null && r.cm_reading < r.percentage);
  const overHundred = after.filter(r => (r.percentage ?? 0) > 100);
  console.log('After fix — rows where cm<pct (should be 0):', stillBad.length, '| percentage>100 (should be ~0):', overHundred.length);
}
main().catch(e => { console.error(e); process.exit(1); });
