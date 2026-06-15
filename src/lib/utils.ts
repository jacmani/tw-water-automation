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

export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

export function isPastTenAM(): boolean {
  return new Date().getHours() >= 10;
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
