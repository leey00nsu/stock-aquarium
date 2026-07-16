import { useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import {
  AnimationMixer,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type AnimationAction,
  type AnimationClip,
  type Object3D,
} from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  subscribeFishEvents,
  useMarketStore,
  type FishSpawn,
} from '@/store/market-store';
import type { TradeSide } from '@/types/market';

const BUY_COLOR = '#f87171';
const SELL_COLOR = '#60a5fa';
const FISH_POOL_SIZE = 80;
const MIN_FISH_SIZE = 0.6;
const MAX_FISH_SIZE = 2.5;
const FISH_FADE_IN_SECONDS = 0.45;
const FISH_FADE_OUT_DISTANCE = 1.1;
const FISH_EXIT_X = 7.0;

interface FishMaterial {
  material: Material;
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

interface FishSlot {
  root: Object3D;
  mixer: AnimationMixer;
  action: AnimationAction | null;
  bodyMaterials: MeshStandardMaterial[];
  materials: FishMaterial[];
  active: boolean;
  direction: 1 | -1;
  speed: number;
  y: number;
  phase: number;
  age: number;
}

const randomRange = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function createFishSlot(source: Object3D, animations: AnimationClip[]): FishSlot {
  const root = cloneSkeleton(source);
  const bodyMaterials: MeshStandardMaterial[] = [];
  const materials: FishMaterial[] = [];

  root.visible = false;
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.castShadow = false;
    child.receiveShadow = false;
    child.frustumCulled = false;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const copies = sourceMaterials.map((material) => {
      const copy = material.clone();
      materials.push({
        material: copy,
        opacity: copy.opacity,
        transparent: copy.transparent,
        depthWrite: copy.depthWrite,
      });
      copy.opacity = 0;
      copy.transparent = true;
      copy.depthWrite = false;
      if (copy instanceof MeshStandardMaterial && copy.name === 'Body') {
        copy.roughness = 0.48;
        bodyMaterials.push(copy);
      }
      return copy;
    });
    child.material = copies.length === 1 ? copies[0] : copies;
  });

  const mixer = new AnimationMixer(root);
  const clip = animations.find((animation) => animation.name === 'Armature|Swim') ?? animations[0];
  return {
    root,
    mixer,
    action: clip ? mixer.clipAction(clip) : null,
    bodyMaterials,
    materials,
    active: false,
    direction: 1,
    speed: 1,
    y: 0,
    phase: 0,
    age: 0,
  };
}

function setSlotOpacity(slot: FishSlot, opacity: number) {
  const fullyVisible = opacity >= 0.999;
  slot.materials.forEach((entry) => {
    const transparent = fullyVisible ? entry.transparent : true;
    const depthWrite = fullyVisible ? entry.depthWrite : false;
    if (entry.material.transparent !== transparent || entry.material.depthWrite !== depthWrite) {
      entry.material.transparent = transparent;
      entry.material.depthWrite = depthWrite;
      entry.material.needsUpdate = true;
    }
    entry.material.opacity = entry.opacity * opacity;
  });
}

function smoothstep(value: number) {
  const normalized = clamp(value, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function deactivateSlot(slot: FishSlot) {
  slot.active = false;
  slot.root.visible = false;
  setSlotOpacity(slot, 0);
  slot.action?.stop();
}

function mergePendingSpawn(current: FishSpawn | undefined, incoming: FishSpawn): FishSpawn {
  if (!current) return { ...incoming };
  const tradeCount = current.tradeCount + incoming.tradeCount;
  return {
    side: current.side,
    quantity: current.quantity + incoming.quantity,
    tradeCount,
    sizeScale: clamp(
      Math.max(current.sizeScale, incoming.sizeScale) + Math.log2(tradeCount) * 0.03,
      MIN_FISH_SIZE,
      MAX_FISH_SIZE,
    ),
  };
}

function activateSlot(slot: FishSlot, spawn: FishSpawn) {
  const direction = spawn.side === 'buy' ? 1 : -1;
  const size = clamp(spawn.sizeScale * randomRange(0.97, 1.03), MIN_FISH_SIZE, MAX_FISH_SIZE);
  const normalizedSize = (size - MIN_FISH_SIZE) / (MAX_FISH_SIZE - MIN_FISH_SIZE);
  const speed = (1.12 - normalizedSize * 0.42) * randomRange(0.92, 1.08);
  const color = spawn.side === 'buy' ? BUY_COLOR : SELL_COLOR;

  slot.bodyMaterials.forEach((material) => material.color.set(color));
  slot.active = true;
  slot.direction = direction;
  slot.speed = speed;
  slot.y = randomRange(-1.7, 4.0);
  slot.phase = randomRange(0, Math.PI * 2);
  slot.age = 0;
  slot.root.visible = true;
  slot.root.position.set(direction > 0 ? -6.35 : 6.35, slot.y, randomRange(-2.45, 2.45));
  slot.root.rotation.set(0, direction > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
  slot.root.scale.setScalar(0.16 * size);
  setSlotOpacity(slot, 0);
  slot.action?.reset().setEffectiveTimeScale(0.9 + speed * 0.45).play();
}

export function Creatures() {
  const { scene, animations } = useGLTF('/models/fish.glb');
  const pool = useMemo(
    () => Array.from({ length: FISH_POOL_SIZE }, () => createFishSlot(scene, animations)),
    [animations, scene],
  );
  const pending = useRef(new Map<TradeSide, FishSpawn>());

  useEffect(() => subscribeFishEvents((event) => {
    if (event.type === 'reset') {
      pending.current.clear();
      pool.forEach(deactivateSlot);
      return;
    }
    pending.current.set(
      event.spawn.side,
      mergePendingSpawn(pending.current.get(event.spawn.side), event.spawn),
    );
  }), [pool]);

  useFrame((state, delta) => {
    const snapshot = useMarketStore.getState().snapshot;
    if (snapshot?.halted) return;

    pending.current.forEach((spawn, side) => {
      const freeSlot = pool.find((slot) => !slot.active);
      if (!freeSlot) return;
      activateSlot(freeSlot, spawn);
      pending.current.delete(side);
    });

    const currentSpeed = Math.min(2.45, 0.72 + (snapshot?.volumeIntensity ?? 1) * 0.34);
    pool.forEach((slot) => {
      if (!slot.active) return;
      slot.mixer.update(delta);
      slot.age += delta;
      slot.root.position.x += slot.direction * slot.speed * currentSpeed * delta;
      slot.root.position.y = slot.y + Math.sin(state.clock.elapsedTime * 1.7 + slot.phase) * 0.14;
      slot.root.rotation.z = Math.sin(state.clock.elapsedTime * 2.1 + slot.phase) * 0.045;
      const distanceToExit = slot.direction > 0
        ? FISH_EXIT_X - slot.root.position.x
        : slot.root.position.x + FISH_EXIT_X;
      const fadeIn = smoothstep(slot.age / FISH_FADE_IN_SECONDS);
      const fadeOut = smoothstep(distanceToExit / FISH_FADE_OUT_DISTANCE);
      setSlotOpacity(slot, Math.min(fadeIn, fadeOut));
      if (Math.abs(slot.root.position.x) > FISH_EXIT_X) deactivateSlot(slot);
    });
  });

  return (
    <group dispose={null}>
      {pool.map((slot, index) => (
        <primitive object={slot.root} key={index} dispose={null} />
      ))}
    </group>
  );
}

useGLTF.preload('/models/fish.glb');
