export type TowerName = 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
export type MeterType = 'DO' | 'DR';
export type TankName = 'JDO' | 'JDR' | 'CT' | 'MDO' | 'MDR' | 'Fire Tank';
export type TimeSlot = '6AM' | '12PM' | '6PM' | '12AM';

export interface DailySheet {
  id: string;
  date: string;
  uploaded_by: string | null;
  image_url: string | null;
  processed_status: 'pending' | 'processed' | 'failed';
  confidence_score: number | null;
  created_at: string;
}

export interface TowerConsumption {
  id: string;
  sheet_id: string;
  tower: TowerName;
  type: MeterType;
  r_yesterday: number | null;
  r_today: number | null;
  total_ltrs: number | null;
  vol_yesterday: number | null;
  vol_today: number | null;
  diff: number | null;
  confidence: number;
}

export interface WaterSource {
  id: string;
  sheet_id: string;
  location: string;
  source_type: string | null;
  r_yesterday: number | null;
  r_today: number | null;
  yesterday_ltrs: number | null;
  today_ltrs: number | null;
  total: number | null;
}

export interface WaterLevel {
  id: string;
  sheet_id: string;
  tank: TankName;
  time_slot: TimeSlot;
  cm_reading: number | null;
  percentage: number | null;
}

export interface Amenity {
  id: string;
  sheet_id: string;
  section: string;
  meter_name: string;
  y_day: number | null;
  r_day: number | null;
  diff: number | null;
}

export interface Summary {
  id: string;
  sheet_id: string;
  v_side: number | null;
  n_side: number | null;
  jtr_tanker: number | null;
  mtr_tanker: number | null;
  input_total: number | null;
  tower_usage: number | null;
  diff: number | null;
}

// ─────────────────────────────────────────
// Extraction types (Claude Vision response)
// ─────────────────────────────────────────

export interface TowerMeterData {
  r_yesterday: number | null;
  r_today: number | null;
  total_ltrs: number | null;
  vol_yesterday: number | null;
  vol_today: number | null;
  diff: number | null;
  confidence: number;
}

export interface WaterSourceData {
  location: string;
  r_yesterday: number | null;
  r_today: number | null;
  yesterday_ltrs: number | null;
  today_ltrs: number | null;
  total: number | null;
  confidence: number;
}

export interface WaterLevelData {
  tank: TankName;
  time_slot: TimeSlot;
  cm_reading: number | null;
  percentage: number | null;
  confidence: number;
}

export interface AmenityData {
  section: string;
  meter_name: string;
  y_day: number | null;
  r_day: number | null;
  diff: number | null;
  confidence: number;
}

export interface SummaryData {
  v_side: number | null;
  n_side: number | null;
  jtr_tanker: number | null;
  mtr_tanker: number | null;
  input_total: number | null;
  tower_usage: number | null;
  diff: number | null;
  confidence: number;
}

export interface ExtractionResult {
  date: string | null;
  date_confidence: number;
  overall_confidence: number;
  tower_section: Record<TowerName, { DO: TowerMeterData; DR: TowerMeterData }>;
  water_sources: WaterSourceData[];
  water_levels: WaterLevelData[];
  amenities: AmenityData[];
  summary: SummaryData;
  flagged_fields: string[];
}

// ─────────────────────────────────────────
// Dashboard types
// ─────────────────────────────────────────

export interface TowerTrendPoint {
  date: string;
  total: number;
}

export interface TowerDashboardData {
  tower: TowerName;
  today_do: number | null;
  today_dr: number | null;
  total_today: number | null;
  total_yesterday: number | null;
  seven_day_avg: number | null;
  trend: TowerTrendPoint[];
}

export interface DashboardData {
  date: string;
  towers: TowerDashboardData[];
  total_consumption: number | null;
  input_total: number | null;
  diff: number | null;
  has_sheet: boolean;
  flagged_fields: string[];
}

export interface TrendChartPoint {
  date: string;
  Venus: number | null;
  Mercury: number | null;
  Neptune: number | null;
  Jupiter: number | null;
}
