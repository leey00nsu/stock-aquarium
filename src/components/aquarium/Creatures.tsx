import { useEffect, useMemo, useRef } from 'react';
import { useAnimations, useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Mesh, MeshStandardMaterial, type Group, type Object3D } from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useMarketStore } from '@/store/market-store';
import type { CreatureEntity, TradeSide } from '@/types/market';

const BUY_COLOR = '#2fbd75';
const SELL_COLOR = '#df4f55';

function tintFish(source: Object3D, side: TradeSide) {
  const color = side === 'buy' ? BUY_COLOR : SELL_COLOR;
  source.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = false;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const nextMaterials = materials.map((material) => {
      const next = material.clone();
      if (next instanceof MeshStandardMaterial && next.name === 'Body') {
        next.color.set(color);
        next.roughness = 0.48;
      }
      return next;
    });
    child.material = nextMaterials.length === 1 ? nextMaterials[0] : nextMaterials;
  });
  return source;
}

function FishModel({ side, animationSpeed }: { side: TradeSide; animationSpeed: number }) {
  const group = useRef<Group>(null);
  const { scene, animations } = useGLTF('/models/fish.glb');
  const fish = useMemo(() => tintFish(cloneSkeleton(scene), side), [scene, side]);
  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    const action = actions['Armature|Swim'] ?? Object.values(actions)[0];
    if (!action) return;
    action.reset();
    action.timeScale = animationSpeed;
    action.fadeIn(0.15).play();
    return () => {
      action.fadeOut(0.12);
    };
  }, [actions, animationSpeed]);

  return (
    <group ref={group} dispose={null}>
      <primitive object={fish} dispose={null} />
    </group>
  );
}

function Creature({ creature }: { creature: CreatureEntity }) {
  const ref = useRef<Group>(null);
  const removeCreature = useMarketStore((state) => state.removeCreature);
  const snapshot = useMarketStore((state) => state.snapshot);
  const direction = creature.side === 'buy' ? 1 : -1;
  const startX = direction > 0 ? -6.35 : 6.35;
  const rotationY = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
  const scale = 0.16 * creature.size;
  const initial = useMemo(() => [startX, creature.y, creature.z] as const, [creature.y, creature.z, startX]);

  useFrame((state, delta) => {
    const group = ref.current;
    if (!group || Date.now() < creature.bornAt) return;
    group.visible = true;
    if (snapshot?.halted) return;

    const currentSpeed = Math.min(2.45, 0.72 + (snapshot?.volumeIntensity ?? 1) * 0.34);
    group.position.x += direction * creature.speed * currentSpeed * delta;
    group.position.y = creature.y + Math.sin(state.clock.elapsedTime * 1.7 + creature.phase) * 0.14;
    group.rotation.z = Math.sin(state.clock.elapsedTime * 2.1 + creature.phase) * 0.045;

    if (Math.abs(group.position.x) > 7.0) removeCreature(creature.id);
  });

  return (
    <group
      ref={ref}
      visible={false}
      position={initial}
      rotation={[0, rotationY, 0]}
      scale={scale}
      dispose={null}
    >
      <FishModel side={creature.side} animationSpeed={0.9 + creature.speed * 0.45} />
    </group>
  );
}

export function Creatures() {
  const creatures = useMarketStore((state) => state.creatures);
  return (
    <group>
      {creatures.map((creature) => (
        <Creature creature={creature} key={creature.id} />
      ))}
    </group>
  );
}

useGLTF.preload('/models/fish.glb');
