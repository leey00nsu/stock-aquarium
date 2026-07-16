import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatNumber = (value: number) => new Intl.NumberFormat('ko-KR').format(Math.round(value));

export function formatPrice(value: number, currency: 'KRW' | 'USD') {
  if (currency === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    }).format(value);
  }
  return `${formatNumber(value)}원`;
}

export function formatPriceChange(value: number, currency: 'KRW' | 'USD') {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatPrice(Math.abs(value), currency)}`;
}

export const formatCompact = (value: number) =>
  new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
