import type { TowerName } from '@/types';

export type FlagType = 'ok' | 'source_duplication' | 'digit_drop' | 'summary_misread' | 'unexplained_gap';

export interface Flag {
  type: FlagType;
  label: string;
  detail: string;
}

export interface HTowerRow {
  tower: TowerName;
  type: 'DO' | 'DR';
  total_ltrs: number | null;
  r_yesterday: number | null;
  r_today: number | null;
  vol_yesterday: number | null;
  vol_today: number | null;
  diff: number | null;
  confidence: number | null;
}

export interface HSourceRow {
  location: string;
  source_type: string | null;
  r_yesterday: number | null;
  r_today: number | null;
  yesterday_ltrs: number | null;
  today_ltrs: number | null;
  total: number | null;
}

export interface HSummary {
  input_total: number | null;
  tower_usage: number | null;
  diff: number | null;
  v_side: number | null;
  n_side: number | null;
  jtr_tanker: number | null;
  mtr_tanker: number | null;
}

export interface SheetRecord {
  id: string;
  date: string;
  date_source: 'ai' | 'manual' | null;
  confidence_score: number | null;
  summary: HSummary | null;
  tower_consumption: HTowerRow[];
  water_sources: HSourceRow[];
  flag: Flag;
}
