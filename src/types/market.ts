export type TradeSide = 'buy' | 'sell';
export type StockMarket = 'domestic' | 'us';
export type StockCurrency = 'KRW' | 'USD';

export interface TradePulse {
  id: string;
  side: TradeSide;
  price: number;
  quantity: number;
  sizeScale: number;
  occurredAt: number;
}

export interface MarketSnapshot {
  id: string;
  symbol: string;
  name: string;
  market: StockMarket;
  exchange: string;
  currency: StockCurrency;
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
  id: string;
  symbol: string;
  name: string;
  market: StockMarket;
  exchange: string;
  currency: StockCurrency;
  realtimeSymbol: string;
}
