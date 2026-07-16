import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, OrbitControls, PerspectiveCamera, Preload, SoftShadows } from '@react-three/drei';
import { AquariumTank } from './AquariumTank';
import { Creatures } from './Creatures';
import { Storm } from './Storm';
import { WaterCurrent } from './WaterCurrent';

export function AquariumScene() {
  return (
    <Canvas dpr={[1, 1.75]} shadows gl={{ antialias: true, alpha: false }}>
      <color attach="background" args={['#14181d']} />
      <fog attach="fog" args={['#18232a', 13, 30]} />
      <PerspectiveCamera makeDefault position={[0, 0.8, 12.5]} fov={39} />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={12.5}
        maxDistance={27}
        minPolarAngle={0.5}
        maxPolarAngle={1.48}
        target={[0, 0.8, 0]}
      />
      <SoftShadows size={24} samples={10} focus={0.5} />
      <ambientLight intensity={0.85} />
      <directionalLight
        castShadow
        position={[-5, 11, 8]}
        intensity={2.8}
        color="#e9f7ff"
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight position={[5.5, 3.5, 4]} intensity={10} distance={18} color="#7ed8ef" />
      <pointLight position={[-5, 2, -3]} intensity={8} distance={15} color="#4b9fbc" />
      <Suspense fallback={null}>
        <AquariumTank />
        <Creatures />
        <WaterCurrent />
        <Storm />
        <Environment preset="warehouse" environmentIntensity={0.38} />
        <Preload all />
      </Suspense>
    </Canvas>
  );
}
