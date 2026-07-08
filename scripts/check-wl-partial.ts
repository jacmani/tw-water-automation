import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: all } = await supabase.from('water_levels').select('sheet_id, cm_reading, percentage');
  const total = all?.length ?? 0;
  const bothNull = (all ?? []).filter(r => r.cm_reading == null && r.percentage == null).length;
  const onlyPct = (all ?? []).filter(r => r.cm_reading == null && r.percentage != null).length;
  const onlyCm = (all ?? []).filter(r => r.cm_reading != null && r.percentage == null).length;
  const both = (all ?? []).filter(r => r.cm_reading != null && r.percentage != null).length;
  console.log({ total, bothNull, onlyPct, onlyCm, both });
}
main().catch(e => { console.error(e); process.exit(1); });
