import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

// Faster bulk swap: use a single SQL statement via rpc-less approach —
// fetch rows, then issue swap updates in parallel batches (Promise.all chunks)
// instead of one-by-one sequential awaits, to fit the sandbox's 45s call budget.
async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  let allRows: { id: string; cm_reading: number | null; percentage: number | null }[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('water_levels')
      .select('id, cm_reading, percentage')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const toSwap = allRows.filter(r => r.cm_reading != null && r.percentage != null);
  console.log('Total to swap:', toSwap.length);

  const CONCURRENCY = 40;
  let updated = 0, failed = 0;
  for (let i = 0; i < toSwap.length; i += CONCURRENCY) {
    const chunk = toSwap.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(row =>
      supabase.from('water_levels').update({ cm_reading: row.percentage, percentage: row.cm_reading }).eq('id', row.id)
    ));
    for (const r of results) { if (r.error) { failed++; console.error(r.error.message); } else updated++; }
    console.log(`progress: ${Math.min(i + CONCURRENCY, toSwap.length)}/${toSwap.length}`);
  }
  console.log('DONE. Swapped:', updated, '| Failed:', failed);
}
main().catch(e => { console.error(e); process.exit(1); });
