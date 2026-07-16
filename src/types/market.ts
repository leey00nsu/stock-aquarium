export type TradeSide = 'buy' | 'sell';

export interface TradePulse {
  id: string;
  side: TradeSide;
  price: number;
  quantity: number;
  isLarge: boolean;
  occurredAt: number;
}

export interface MarketSnapshot {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
  accumulatedVolume: number;
  tradeStrength: number;
  volumeIntensity: number;
  volatility: number;
  halted: boolean;
  bidTotal: number;
  askTotal: number;
  latestTrade: TradePulse;
  receivedAt: number;
}

export interface StockOption {
  symbol: string;
  name: string;
}

export interface CreatureEntity {
  id: string;
  side: TradeSide;
  size: number;
  speed: number;
  y: number;
  z: number;
  phase: number;
  bornAt: number;
  isLarge: boolean;
}
