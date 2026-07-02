import type { TowerName } from '@/types';

export const TOWERS: TowerName[] = ['Venus', 'Mercury', 'Neptune', 'Jupiter'];

export const TOWER_COLORS: Record<TowerName, string> = {
  Venus: '#7C3AED',
  Mercury: '#2563EB',
  Neptune: '#059669',
  Jupiter: '#EA580C',
};

export const TOWER_COLORS_LIGHT: Record<TowerName, string> = {
  Venus: '#A78BFA',
  Mercury: '#60A5FA',
  Neptune: '#34D399',
  Jupiter: '#FB923C',
};

export const TOWER_BG_CLASSES: Record<TowerName, string> = {
  Venus: 'bg-violet-600',
  Mercury: 'bg-blue-600',
  Neptune: 'bg-emerald-600',
  Jupiter: 'bg-orange-600',
};

export const TOWER_TEXT_CLASSES: Record<TowerName, string> = {
  Venus: 'text-violet-400',
  Mercury: 'text-blue-400',
  Neptune: 'text-emerald-400',
  Jupiter: 'text-orange-400',
};

export const TOWER_BORDER_CLASSES: Record<TowerName, string> = {
  Venus: 'border-violet-500',
  Mercury: 'border-blue-500',
  Neptune: 'border-emerald-500',
  Jupiter: 'border-orange-500',
};

export function formatLitres(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}kL`;
  }
  return `${value.toLocaleString('en-IN')}L`;
}

export function formatLitresFull(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toLocaleString('en-IN')} L`;
}

// Formats a UTC timestamp as Asia/Kolkata (IST) time, always 24-hour.
// includeDate=true → "16 Jun, 14:32 IST"   includeDate=false → "14:32 IST"
export function formatIST(date: Date | string, includeDate = false): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const timePart = d.toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  if (!includeDate) return `${timePart} IST`;
  const datePart = d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
  });
  return `${datePart}, ${timePart} IST`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatMediumDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Returns "today" as YYYY-MM-DD in IST (UTC+5:30), NOT the server/browser's local
// calendar date. This app is IST-anchored (technician's daily 6-9 AM upload window,
// committee's 10 AM deadline) — using raw `new Date()` here is the same bug that has
// already been fixed multiple times elsewhere in this codebase (wasSheetUploadedToday,
// MissingSheetAlert, upload/logbook default date): between IST 00:00-05:29, the UTC
// calendar date is still "yesterday", so anything keying off local/UTC time reports
// the wrong day. Use this helper (both server AND client side) instead of ad-hoc
// `new Date().toISOString().split('T')[0]`.
export function getISTDateString(): string {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().split('T')[0];
}

export function getTodayString(): string {
  return getISTDateString();
}

export function isPastTenAM(): boolean {
  const istHour = new Date(Date.now() + 5.5 * 3600000).getUTCHours();
  return istHour >= 10;
}

export function percentageDiff(current: number, reference: number): number {
  if (reference === 0) return 0;
  return ((current - reference) / reference) * 100;
}

export function isAboveThreshold(
  current: number | null,
  average: number | null,
  thresholdPercent = 15
): boolean {
  if (current == null || average == null || average === 0) return false;
  return percentageDiff(current, average) >= thresholdPercent;
}
