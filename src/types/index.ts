export type TowerName = 'Venus' | 'Mercury' | 'Neptune' | 'Jupiter';
export type MeterType = 'DO' | 'DR';
export type TankName = 'JDO' | 'JDR' | 'CT' | 'MDO' | 'MDR' | 'Fire Tank'; // Fire Tank kept for legacy DB rows
export type TimeSlot = '6AM' | '12PM' | '6PM' | '12AM';

export type CommitteeRole =
  | 'President'
  | 'Vice President'
  | 'Secretary'
  | 'Joint Secretary'
  | 'Treasurer'
  | 'Joint Treasurer'
  | 'Technical Expert'
  | 'Financial Expert'
  | 'GC Chair'
  | 'GC Member';

export const OFFICE_BEARER_ROLES: CommitteeRole[] = [
  'President', 'Vice President', 'Secretary', 'Joint Secretary',
  'Treasurer', 'Joint Treasurer', 'Technical Expert', 'Financial Expert',
];
export const ALL_COMMITTEE_ROLES: CommitteeRole[] = [
  ...OFFICE_BEARER_ROLES, 'GC Chair', 'GC Member',
];

export interface CommitteeMember {
  id: string;
  term: string;
  name: string;
  role: CommitteeRole;
  tower: TowerName | null;
  apartment: string | null;
  phone: string | null;
  email: string | null;
  whatsapp_optin: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailySheet {
  id: string;
  date: string;
  uploaded_by: string | null;
  image_url: string | null;
  processed_status: 'pending' | 'processed' | 'failed';
  confidence_score: number | null;
  superseded: boolean;
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
  cumulative: number | null;
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
  cumulative?: number | null; // Car Wash + Swimming Pool only (template has CUMULATIVE row)
  confidence: number;
}

export interface SummaryData {
  // Sheet's bottom TOTAL INFLOW table columns (the accurate mapping):
  water_inflow: number | null;   // WATER column
  well_inflow: number | null;    // WELL column
  tanker_inflow: number | null;  // TANKER column
  input_total: number | null;    // TOTAL COLLECTION column
  tower_usage: number | null;    // TOTAL USAGE column
  diff: number | null;           // BALANCE column
  // Legacy fields — retained for backward compatibility with existing rows and
  // History flagging. No longer populated by new uploads. Do not rely on these.
  v_side?: number | null;
  n_side?: number | null;
  jtr_tanker?: number | null;
  mtr_tanker?: number | null;
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

// ─────────────────────────────────────────
// Logbook types (005_logbook_full_schema)
// ─────────────────────────────────────────

export type InputSourceName =
  | 'mercury_venus_tanker'
  | 'jupiter_neptune_tanker'
  | 'venus_side_well_123'
  | 'venus_side_well_4'
  | 'neptune_side_well_5'
  | 'neptune_side_well_6'
  | 'open_well';

export type AmenityType = 'Car Wash' | 'Swimming Pool' | 'Party Hall';
export type CarWashLocation = 'Jupiter' | 'Mercury' | 'Venus' | 'Neptune';
export type PoolLocation = 'Meter-1' | 'Meter-2' | 'Meter-3' | 'Meter 1' | 'Meter 2' | 'Meter 3' | 'Meter 4' | 'Meter 5'; // Meter-1/2/3 = template labels; others kept for legacy rows
export type AmenityLocation = CarWashLocation | PoolLocation | string;
export type WaterLevelSlot = '6AM' | '12PM' | '6PM' | '12AM';

export interface DailyLog {
  id: string;
  log_date: string;
  technician_name: string | null;
  fm_signed: boolean;
  created_at: string;
  updated_at: string;
}

export interface TowerMeterReading {
  id: string;
  log_date: string;
  tower: TowerName;
  meter_type: MeterType;
  yesterday_reading: number | null;
  today_reading: number | null;
  total_in_ltrs: number | null;
  consumption_yesterday: number | null;
  consumption_today: number | null;
  difference: number | null;
}

export interface InputSourceReading {
  id: string;
  log_date: string;
  source_name: InputSourceName;
  yesterday_reading: number | null;
  today_reading: number | null;
  consumption_yesterday: number | null;
  consumption_today: number | null;
  total: number | null;
}

export interface AmenityMeterReading {
  id: string;
  log_date: string;
  amenity_type: AmenityType;
  location: AmenityLocation;
  yesterday: number | null;
  today: number | null;
  consumption: number | null;
  cumulative: number | null;
}

export interface WaterLevelReading {
  id: string;
  log_date: string;
  time_slot: WaterLevelSlot;
  jupiter_do: number | null;
  jupiter_dr: number | null;
  collection_tank: number | null;
  mercury_do: number | null;
  mercury_dr: number | null;
  cumulative_j: number | null;
  cumulative_m: number | null;
  cumulative_v: number | null;
  cumulative_n: number | null;
  cumulative_total: number | null;
}

export interface UtilityMeterReading {
  id: string;
  log_date: string;
  p_hall_meter_1: number | null;
  p_hall_meter_2: number | null;
  wtp_1: number | null;
  wtp_2: number | null;
  venus_side_uf: number | null;
  total_tankers: number | null;
  consumption_yesterday: number | null;
  consumption_today: number | null;
  consumption_total: number | null;
}

export interface DailyInflowSummary {
  id: string;
  log_date: string;
  water_inflow: number | null;
  well_inflow: number | null;
  tanker_inflow: number | null;
  total_collection: number | null;
  total_usage: number | null;
  balance: number | null;
  cumulative_water: number | null;
  cumulative_well: number | null;
  cumulative_tanker: number | null;
  cumulative_total_collection: number | null;
  cumulative_total_usage: number | null;
  cumulative_balance: number | null;
}

export interface FullLogEntry {
  log: DailyLog;
  tower_readings: TowerMeterReading[];
  source_readings: InputSourceReading[];
  amenity_readings: AmenityMeterReading[];
  water_levels: WaterLevelReading[];
  utility_meters: UtilityMeterReading | null;
  inflow_summary: DailyInflowSummary | null;
}
