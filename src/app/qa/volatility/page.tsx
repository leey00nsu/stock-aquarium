import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { VolatilityQa } from './volatility-qa';

export const metadata: Metadata = {
  title: 'Volatility QA',
  robots: { index: false, follow: false },
};

export default function VolatilityQaPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <VolatilityQa />;
}
