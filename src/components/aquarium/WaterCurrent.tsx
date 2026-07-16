import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Points } from 'three';
import { useMarketStore } from '@/store/market-store';

export function WaterCurrent() {
  const points = useRef<Points>(null);
  const snapshot = useMarketStore((state) => state.snapshot);
  const positions = useMemo(() => {
    const data = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i += 1) {
      data[i * 3] = (Math.random() - 0.5) * 12.8;
      data[i * 3 + 1] = Math.random() * 6.4 - 1.9;
      data[i * 3 + 2] = (Math.random() - 0.5) * 5.3;
    }
    return data;
  }, []);

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
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#d4f4ff" size={0.03} transparent opacity={0.38} sizeAttenuation />
    </points>
  );
}
