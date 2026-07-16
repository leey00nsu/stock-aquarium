import { useRef } from 'react';
import { CameraShake } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Points } from 'three';
import { createSeededPositions } from '@/lib/seeded-points';
import { useMarketStore } from '@/store/market-store';

const STORM_POSITIONS = createSeededPositions(150, 7301, { x: 13, y: 6.5, yOffset: -1.8, z: 5.5 });

export function Storm() {
  const snapshot = useMarketStore((state) => state.snapshot);
  const rain = useRef<Points>(null);
  const intensity = Math.max(0, Math.min(1, ((snapshot?.volatility ?? 0) - 0.45) / 0.75));

  useFrame((_, delta) => {
    if (!rain.current || snapshot?.halted || intensity <= 0) return;
    rain.current.position.y -= delta * (2.5 + intensity * 5);
    if (rain.current.position.y < -3) rain.current.position.y = 3.5;
  });

  if (intensity <= 0.02) return null;

  return (
    <>
      <CameraShake
        maxYaw={0.014 * intensity}
        maxPitch={0.01 * intensity}
        maxRoll={0.008 * intensity}
        yawFrequency={0.65}
        pitchFrequency={0.55}
        rollFrequency={0.45}
        intensity={intensity}
      />
      <points ref={rain} visible={intensity > 0.12}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[STORM_POSITIONS, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#e7f8ff" size={0.03} transparent opacity={0.36 * intensity} />
      </points>
    </>
  );
}
