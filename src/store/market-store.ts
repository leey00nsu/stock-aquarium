import { create } from 'zustand';
import type { CreatureEntity, MarketSnapshot } from '@/types/market';

interface MarketStore {
  snapshot: MarketSnapshot | null;
  creatures: CreatureEntity[];
  error: string | null;
  connected: boolean;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;
  ingest: (snapshot: MarketSnapshot) => void;
  removeCreature: (id: string) => void;
  resetFeed: () => void;
}

const randomRange = (min: number, max: number) => min + Math.random() * (max - min);

function createCreatures(snapshot: MarketSnapshot): CreatureEntity[] {
  const trade = snapshot.latestTrade;
  if (snapshot.halted || trade.quantity <= 0) return [];

  const count = trade.isLarge ? 1 : Math.min(3, Math.max(1, Math.round(snapshot.volumeIntensity * 0.7)));
  const size = trade.isLarge
    ? Math.min(2.8, 1.85 + Math.log10(Math.max(1, trade.quantity)) * 0.16)
    : Math.min(1.35, 0.72 + Math.log10(Math.max(1, trade.quantity)) * 0.1);

  return Array.from({ length: count }, (_, index) => ({
    id: `${trade.id}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    side: trade.side,
    size: size * randomRange(0.9, 1.08),
    speed: (trade.isLarge ? 0.7 : 1.05) * randomRange(0.86, 1.16),
    y: randomRange(-1.7, 4.0),
    z: randomRange(-2.45, 2.45),
    phase: randomRange(0, Math.PI * 2),
    bornAt: Date.now() + index * 120,
    isLarge: trade.isLarge,
  }));
}

export const useMarketStore = create<MarketStore>((set) => ({
  snapshot: null,
  creatures: [],
  error: null,
  connected: false,
  setError: (error) => set({ error }),
  setConnected: (connected) => set({ connected }),
  ingest: (snapshot) =>
    set((state) => ({
      snapshot,
      error: null,
      connected: true,
      creatures: [...state.creatures, ...createCreatures(snapshot)].slice(-32),
    })),
  removeCreature: (id) => set((state) => ({ creatures: state.creatures.filter((creature) => creature.id !== id) })),
  resetFeed: () => set({ snapshot: null, creatures: [], error: null, connected: false }),
}));
