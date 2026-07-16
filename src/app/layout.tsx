import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles.css';

export const metadata: Metadata = {
  title: 'KIS Stock Aquarium',
  description: '한국투자증권 실시간 체결 데이터를 3D 수조로 시각화합니다.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" className="dark">
      <body>{children}</body>
    </html>
  );
}
