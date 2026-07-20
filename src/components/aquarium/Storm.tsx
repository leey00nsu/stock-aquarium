import { useRef } from 'react';
import { CameraShake, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Group, LineSegments, MeshBasicMaterial, PointLight } from 'three';
import { createSeededPositions } from '@/lib/seeded-points';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function createRainStreaks(count: number, seed: number, length: number) {
  const drops = createSeededPositions(count, seed, { x: 15, y: 9, yOffset: -4.5, z: 7 });
  const streaks = new Float32Array(count * 6);

  for (let index = 0; index < count; index += 1) {
    const sourceIndex = index * 3;
    const targetIndex = index * 6;
    const x = drops[sourceIndex];
    const y = drops[sourceIndex + 1];
    const z = drops[sourceIndex + 2];
    streaks.set([x, y, z, x - length * 0.3, y + length, z], targetIndex);
  }

  return streaks;
}

const RAIN_LAYERS = [
  { positions: createRainStreaks(140, 7301, 0.24), threshold: 0.04, speed: 7, opacity: 0.24 },
  { positions: createRainStreaks(190, 8123, 0.34), threshold: 0.28, speed: 9.5, opacity: 0.36 },
  { positions: createRainStreaks(240, 9643, 0.46), threshold: 0.58, speed: 12, opacity: 0.5 },
];

const LIGHTNING_POINTS: [number, number, number][] = [
  [0, 4.9, 0],
  [-0.28, 3.9, 0],
  [0.12, 3.25, 0],
  [-0.36, 2.4, 0],
  [-0.04, 1.82, 0],
  [-0.58, 0.9, 0],
];

interface StormProps {
  volatility: number;
  halted: boolean;
  lightningTrigger?: number;
}

export function Storm({ volatility, halted, lightningTrigger = 0 }: StormProps) {
  const rain = useRef<Array<LineSegments | null>>([]);
  const lightning = useRef<Group>(null);
  const lightningLight = useRef<PointLight>(null);
  const skyFlash = useRef<MeshBasicMaterial>(null);
  const flashEnergy = useRef(0);
  const forcedLightning = useRef(false);
  const lastLightningTrigger = useRef(lightningTrigger);
  const nextLightningAt = useRef(0);
  // Preserve headroom across the full metric range (0–1.5), so an extreme
  // market is visibly more violent than the moment it first enters "폭풍".
  const intensity = clamp((volatility - 0.35) / 1.15, 0, 1);
  const stormPower = intensity ** 1.45;

  useFrame(({ clock }, delta) => {
    if (lastLightningTrigger.current !== lightningTrigger) {
      lastLightningTrigger.current = lightningTrigger;
      forcedLightning.current = true;
      flashEnergy.current = 1;
      if (lightning.current) {
        lightning.current.position.x = (Math.random() - 0.5) * 8;
        lightning.current.scale.x = Math.random() > 0.5 ? 1 : -1;
      }
    }

    if (!halted && stormPower > 0) {
      rain.current.forEach((layer, index) => {
        if (!layer || stormPower < RAIN_LAYERS[index].threshold) return;
        const speed = RAIN_LAYERS[index].speed * (0.55 + stormPower * 0.85);
        layer.position.y -= delta * speed;
        layer.position.x -= delta * speed * (0.08 + stormPower * 0.07);
        if (layer.position.y < -9) {
          layer.position.y += 18;
          layer.position.x = 0;
        }
      });
    }

    const now = clock.elapsedTime;
    const lightningEnabled = !halted && (intensity > 0.52 || forcedLightning.current);
    if (!lightningEnabled) {
      nextLightningAt.current = 0;
      flashEnergy.current = 0;
    } else if (nextLightningAt.current === 0) {
      nextLightningAt.current = now + 1.2 + Math.random() * 2.8;
    } else if (now >= nextLightningAt.current) {
      flashEnergy.current = 1;
      nextLightningAt.current = now + 2.2 + Math.random() * (7.5 - intensity * 4.5);
      if (lightning.current) {
        lightning.current.position.x = (Math.random() - 0.5) * 8;
        lightning.current.scale.x = Math.random() > 0.5 ? 1 : -1;
      }
    }

    flashEnergy.current *= Math.exp(-delta * 13);
    if (flashEnergy.current < 0.01) forcedLightning.current = false;
    const flash = flashEnergy.current * (0.78 + Math.abs(Math.sin(now * 72)) * 0.22);
    if (lightning.current) lightning.current.visible = flash > 0.16;
    if (lightningLight.current) lightningLight.current.intensity = flash * (34 + intensity * 38);
    if (skyFlash.current) skyFlash.current.opacity = flash * 0.22;
  });

  if (halted || intensity <= 0.02) return null;

  return (
    <>
      <CameraShake
        maxYaw={0.028 * stormPower}
        maxPitch={0.022 * stormPower}
        maxRoll={0.016 * stormPower}
        yawFrequency={0.9 + stormPower * 1.4}
        pitchFrequency={0.75 + stormPower * 1.2}
        rollFrequency={0.65 + stormPower}
        intensity={stormPower}
      />

      <mesh position={[0, 2.8, -5.8]} scale={[17, 8, 1]} renderOrder={-1}>
        <planeGeometry />
        <meshBasicMaterial
          color="#07131d"
          transparent
          opacity={0.1 + stormPower * 0.42}
          depthWrite={false}
        />
      </mesh>

      {RAIN_LAYERS.map((layer, index) => (
        <lineSegments
          key={index}
          ref={(element) => { rain.current[index] = element; }}
          visible={!halted && stormPower >= layer.threshold}
          rotation={[0, 0, -0.025 - stormPower * 0.055]}
        >
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[layer.positions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color="#d9f4ff"
            transparent
            opacity={layer.opacity * (0.4 + stormPower * 0.9)}
            depthWrite={false}
          />
        </lineSegments>
      ))}

      <mesh position={[0, 1, 5.5]} scale={[22, 13, 1]} renderOrder={20}>
        <planeGeometry />
        <meshBasicMaterial
          ref={skyFlash}
          color="#dff7ff"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>

      <pointLight
        ref={lightningLight}
        position={[0, 5, 4]}
        color="#dff8ff"
        intensity={0}
        distance={28}
        decay={1.4}
      />
      <group ref={lightning} position={[0, 0.4, -2.2]} visible={false} renderOrder={21}>
        <Line
          points={LIGHTNING_POINTS}
          color="#ffffff"
          lineWidth={2.2}
          transparent
          opacity={0.98}
          depthTest={false}
        />
        <Line
          points={LIGHTNING_POINTS}
          color="#83dfff"
          lineWidth={7}
          transparent
          opacity={0.28}
          depthTest={false}
        />
      </group>
    </>
  );
}
