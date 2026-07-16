'use client';

import dynamic from 'next/dynamic';

const Aquarium = dynamic(() => import('@/App'), { ssr: false });

export function AquariumApp() {
  return <Aquarium />;
}
