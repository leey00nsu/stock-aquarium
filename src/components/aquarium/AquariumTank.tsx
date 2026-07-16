import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { Mesh, MeshPhysicalMaterial, type Object3D } from 'three';

export function AquariumTank() {
  const { scene } = useGLTF('/models/fish-tank.glb');
  const tank = useMemo(() => {
    const clone = scene.clone(true) as Object3D;
    clone.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;

      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const nextMaterials = materials.map((material) => {
        const next = material.clone();
        if (next instanceof MeshPhysicalMaterial || 'opacity' in next) {
          const named = next.name.toLowerCase();
          if (named.includes('glass') || named.includes('water')) {
            next.transparent = true;
            next.depthWrite = false;
          }
        }
        return next;
      });
      child.material = nextMaterials.length === 1 ? nextMaterials[0] : nextMaterials;
    });
    return clone;
  }, [scene]);

  return (
    <primitive
      object={tank}
      position={[0, -3, 0]}
      rotation={[0, Math.PI / 2, 0]}
      scale={5.8}
      dispose={null}
    />
  );
}

useGLTF.preload('/models/fish-tank.glb');
