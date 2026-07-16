import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Points } from 'three';
import { createSeededPositions } from '@/lib/seeded-points';
import { useMarketStore } from '@/store/market-store';

const WATER_POSITIONS = createSeededPositions(220, 4205, { x: 12.8, y: 6.4, yOffset: -1.9, z: 5.3 });

export function WaterCurrent() {
  const points = useRef<Points>(null);
  const snapshot = useMarketStore((state) => state.snapshot);

  useFrame((_, delta) => {
    if (!points.current || snapshot?.halted) return;
    const speed = 0.03 + Math.min(0.16, (snapshot?.volumeIntensity ?? 1) * 0.035);
    points.current.rotation.y += delta * speed;
    points.current.position.x += delta * speed * 0.12;
    if (points.current.position.x > 0.5) points.current.position.x = -0.5;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[WATER_POSITIONS, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#d4f4ff" size={0.03} transparent opacity={0.38} sizeAttenuation />
    </points>
  );
}
