import { create } from 'zustand';
import type { MarketSnapshot, TradeSide } from '@/types/market';

interface MarketStore {
  snapshot: MarketSnapshot | null;
  tradeFlow: TradeFlow;
  feedSession: number;
  error: string | null;
  connected: boolean;
  viewerCount: number;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;
  setViewerCount: (count: number) => void;
  ingest: (snapshot: MarketSnapshot) => void;
  resetFeed: () => void;
}

interface TradeFlow {
  buyQuantity: number;
  sellQuantity: number;
  buyPercent: number;
  sellPercent: number;
}

export interface FishSpawn {
  side: TradeSide;
  quantity: number;
  tradeCount: number;
  sizeScale: number;
}

type FishEvent =
  | { type: 'spawn'; spawn: FishSpawn }
  | { type: 'reset' };

type TradeAggregate = FishSpawn;

const AGGREGATION_WINDOW_MS = 250;
const MAX_SPAWNS_PER_SECOND = 10;
const TRADE_FLOW_WINDOW_MS = 60_000;
const fishListeners = new Set<(event: FishEvent) => void>();
const aggregates = new Map<TradeSide, TradeAggregate>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let emittedAt: number[] = [];
let tradeFlowEvents: Array<{ occurredAt: number; side: TradeSide; quantity: number }> = [];
let tradeFlowTimer: ReturnType<typeof setTimeout> | null = null;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function calculateTradeFlow(now = Date.now()): TradeFlow {
  tradeFlowEvents = tradeFlowEvents.filter((event) => now - event.occurredAt < TRADE_FLOW_WINDOW_MS);
  const buyQuantity = tradeFlowEvents.reduce(
    (total, event) => total + (event.side === 'buy' ? event.quantity : 0),
    0,
  );
  const sellQuantity = tradeFlowEvents.reduce(
    (total, event) => total + (event.side === 'sell' ? event.quantity : 0),
    0,
  );
  const total = buyQuantity + sellQuantity;
  const buyPercent = total > 0 ? (buyQuantity / total) * 100 : 50;
  return { buyQuantity, sellQuantity, buyPercent, sellPercent: 100 - buyPercent };
}

function scheduleTradeFlowExpiry() {
  if (tradeFlowTimer) clearTimeout(tradeFlowTimer);
  const oldest = tradeFlowEvents[0];
  if (!oldest) {
    tradeFlowTimer = null;
    return;
  }
  tradeFlowTimer = setTimeout(() => {
    tradeFlowTimer = null;
    useMarketStore.setState({ tradeFlow: calculateTradeFlow() });
    scheduleTradeFlowExpiry();
  }, Math.max(50, oldest.occurredAt + TRADE_FLOW_WINDOW_MS - Date.now() + 1));
}

function updateTradeFlow(snapshot: MarketSnapshot) {
  const trade = snapshot.latestTrade;
  if (snapshot.source === 'trade' && !snapshot.halted && trade.quantity > 0) {
    tradeFlowEvents.push({ occurredAt: trade.occurredAt, side: trade.side, quantity: trade.quantity });
  }
  const flow = calculateTradeFlow();
  scheduleTradeFlowExpiry();
  return flow;
}

function publishFishEvent(event: FishEvent) {
  fishListeners.forEach((listener) => listener(event));
}

function mergeAggregate(current: TradeAggregate | undefined, incoming: FishSpawn): TradeAggregate {
  if (!current) return { ...incoming };
  const tradeCount = current.tradeCount + incoming.tradeCount;
  return {
    side: current.side,
    quantity: current.quantity + incoming.quantity,
    tradeCount,
    sizeScale: clamp(
      Math.max(current.sizeScale, incoming.sizeScale) + Math.log2(tradeCount) * 0.035,
      0.6,
      2.5,
    ),
  };
}

function scheduleFlush(delay = AGGREGATION_WINDOW_MS) {
  if (flushTimer) return;
  flushTimer = setTimeout(flushAggregates, delay);
}

function flushAggregates() {
  flushTimer = null;
  const now = Date.now();
  emittedAt = emittedAt.filter((timestamp) => now - timestamp < 1000);
  const available = Math.max(0, MAX_SPAWNS_PER_SECOND - emittedAt.length);
  const candidates = Array.from(aggregates.values()).sort(
    (left, right) => right.quantity - left.quantity,
  );
  aggregates.clear();

  candidates.forEach((spawn, index) => {
    if (index < available) {
      emittedAt.push(now);
      publishFishEvent({ type: 'spawn', spawn });
      return;
    }
    aggregates.set(spawn.side, mergeAggregate(aggregates.get(spawn.side), spawn));
  });

  if (aggregates.size > 0) {
    const oldest = emittedAt[0] ?? now;
    scheduleFlush(Math.max(50, 1000 - (now - oldest)));
  }
}

function aggregateSnapshot(snapshot: MarketSnapshot) {
  const trade = snapshot.latestTrade;
  if (snapshot.halted || trade.quantity <= 0) return;
  const incoming: FishSpawn = {
    side: trade.side,
    quantity: trade.quantity,
    tradeCount: 1,
    sizeScale: trade.sizeScale,
  };
  aggregates.set(trade.side, mergeAggregate(aggregates.get(trade.side), incoming));
  scheduleFlush();
}

function resetFishPipeline() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  aggregates.clear();
  emittedAt = [];
  tradeFlowEvents = [];
  if (tradeFlowTimer) clearTimeout(tradeFlowTimer);
  tradeFlowTimer = null;
  publishFishEvent({ type: 'reset' });
}

export function subscribeFishEvents(listener: (event: FishEvent) => void) {
  fishListeners.add(listener);
  return () => {
    fishListeners.delete(listener);
  };
}

export const useMarketStore = create<MarketStore>((set) => ({
  snapshot: null,
  tradeFlow: { buyQuantity: 0, sellQuantity: 0, buyPercent: 50, sellPercent: 50 },
  feedSession: 0,
  error: null,
  connected: false,
  viewerCount: 0,
  setError: (error) => set({ error }),
  setConnected: (connected) => set({ connected }),
  setViewerCount: (viewerCount) => set({ viewerCount }),
  ingest: (snapshot) => {
    aggregateSnapshot(snapshot);
    set({ snapshot, tradeFlow: updateTradeFlow(snapshot), error: null, connected: true });
  },
  resetFeed: () => {
    resetFishPipeline();
    set((state) => ({
      snapshot: null,
      tradeFlow: { buyQuantity: 0, sellQuantity: 0, buyPercent: 50, sellPercent: 50 },
      feedSession: state.feedSession + 1,
      error: null,
      connected: false,
      viewerCount: 0,
    }));
  },
}));
