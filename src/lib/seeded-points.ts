export function createSeededPositions(
  count: number,
  seed: number,
  bounds: { x: number; y: number; yOffset: number; z: number },
) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };

  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * bounds.x;
    positions[index * 3 + 1] = random() * bounds.y + bounds.yOffset;
    positions[index * 3 + 2] = (random() - 0.5) * bounds.z;
  }
  return positions;
}
