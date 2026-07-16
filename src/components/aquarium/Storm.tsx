import { useMemo, useRef } from 'react';
import { CameraShake } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Points } from 'three';
import { useMarketStore } from '@/store/market-store';

export function Storm() {
  const snapshot = useMarketStore((state) => state.snapshot);
  const rain = useRef<Points>(null);
  const intensity = Math.max(0, Math.min(1, ((snapshot?.volatility ?? 0) - 0.45) / 0.75));
  const positions = useMemo(() => {
    const data = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i += 1) {
      data[i * 3] = (Math.random() - 0.5) * 13;
      data[i * 3 + 1] = Math.random() * 6.5 - 1.8;
      data[i * 3 + 2] = (Math.random() - 0.5) * 5.5;
    }
    return data;
  }, []);

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
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#e7f8ff" size={0.03} transparent opacity={0.36 * intensity} />
      </points>
    </>
  );
}
