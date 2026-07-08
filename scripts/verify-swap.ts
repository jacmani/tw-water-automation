import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await supabase.from('water_levels').select('*').eq('sheet_id', '4612b8fb-cab3-4bb1-b2e7-558d83b8504c').order('tank').order('time_slot');
  console.log(JSON.stringify(data, null, 2));

  // Also: full-table sanity check — how many rows NOW have percentage > 100 (should be near-zero after a correct single swap)
  let allRows: any[] = [];
  let from = 0;
  while (true) {
    const { data: page } = await supabase.from('water_levels').select('id, cm_reading, percentage').range(from, from + 999);
    if (!page || page.length === 0) break;
    allRows = allRows.concat(page);
    if (page.length < 1000) break;
    from += 1000;
  }
  const gt100 = allRows.filter(r => (r.percentage ?? 0) > 100).length;
  const cmLt10 = allRows.filter(r => r.cm_reading != null && r.cm_reading < 10).length;
  console.log('Total rows:', allRows.length, '| percentage>100:', gt100, '| cm_reading<10:', cmLt10);
}
main().catch(e => { console.error(e); process.exit(1); });
