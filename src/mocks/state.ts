import type { KisRealtimeFrame, KisRealtimeOutput, KisTradeDivision } from '@/api/kis/types';
import type { StockOption } from '@/types/market';

interface MockStockSeed {
  symbol: string;
  name: string;
  basePrice: number;
  tickSize: number;
  baseVolume: number;
}

interface MockStockState extends MockStockSeed {
  price: number;
  previousClose: number;
  accumulatedVolume: number;
  sequence: number;
  volatility: number;
  volumeIntensity: number;
  haltedUntil: number;
  lastSide: KisTradeDivision;
  lastQuantity: number;
  askTotal: number;
  bidTotal: number;
}

const seeds: MockStockSeed[] = [
  { symbol: '005930', name: '삼성전자', basePrice: 73400, tickSize: 100, baseVolume: 12_000_000 },
  { symbol: '000660', name: 'SK하이닉스', basePrice: 218500, tickSize: 500, baseVolume: 4_100_000 },
  { symbol: '035420', name: 'NAVER', basePrice: 196800, tickSize: 100, baseVolume: 1_200_000 },
  { symbol: '035720', name: '카카오', basePrice: 46850, tickSize: 50, baseVolume: 2_800_000 },
];

const states = new Map<string, MockStockState>(
  seeds.map((seed) => [
    seed.symbol,
    {
      ...seed,
      price: seed.basePrice,
      previousClose: seed.basePrice * 0.992,
      accumulatedVolume: seed.baseVolume,
      sequence: 0,
      volatility: 0.2,
      volumeIntensity: 1,
      haltedUntil: 0,
      lastSide: '1',
      lastQuantity: 100,
      askTotal: 48_000,
      bidTotal: 51_000,
    },
  ]),
);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

function stateFor(id: string, name = id): MockStockState {
  const existing = states.get(id);
  if (existing) return existing;

  const symbol = id.split(':').at(-1) ?? id;
  const seed = seeds.find((candidate) => candidate.symbol === symbol);
  const numericCode = Number(symbol) || Array.from(symbol).reduce((sum, value) => sum + value.charCodeAt(0), 1);
  const basePrice = seed?.basePrice ?? (id.startsWith('us:') ? 50 + (numericCode % 500) : 10_000 + (numericCode % 2000) * 50);
  const state: MockStockState = {
    symbol: id,
    name,
    basePrice,
    tickSize: seed?.tickSize ?? (id.startsWith('us:') ? 0.01 : basePrice >= 100_000 ? 500 : basePrice >= 50_000 ? 100 : 50),
    baseVolume: seed?.baseVolume ?? 1_000_000 + (numericCode % 500) * 10_000,
    price: basePrice,
    previousClose: basePrice * 0.992,
    accumulatedVolume: 1_000_000 + (numericCode % 500) * 10_000,
    sequence: 0,
    volatility: 0.2,
    volumeIntensity: 1,
    haltedUntil: 0,
    lastSide: '1',
    lastQuantity: 100,
    askTotal: 48_000,
    bidTotal: 51_000,
  };
  states.set(id, state);
  return state;
}

function advanceStock(symbol: string, name?: string): MockStockState {
  const state = stateFor(symbol, name);
  state.sequence += 1;

  const burst = Math.random() > 0.9;
  state.volumeIntensity = clamp(
    state.volumeIntensity * 0.68 + randomBetween(0.55, burst ? 3.7 : 1.65) * 0.32,
    0.55,
    4.2,
  );
  state.volatility = clamp(
    state.volatility * 0.72 + randomBetween(0.08, burst ? 1.25 : 0.55) * 0.28,
    0.05,
    1.5,
  );

  if (Math.random() < 0.002) state.haltedUntil = Date.now() + 8000;

  const halted = state.haltedUntil > Date.now();
  const direction = Math.random() > 0.49 ? 1 : -1;
  state.lastSide = direction > 0 ? '1' : '5';

  const largeTrade = Math.random() < 0.075 * state.volumeIntensity;
  state.lastQuantity = largeTrade
    ? Math.round(randomBetween(1600, 7500) * state.volumeIntensity)
    : Math.round(randomBetween(20, 420) * state.volumeIntensity);

  if (!halted) {
    const stepCount = Math.max(
      0,
      Math.round(Math.abs(randomBetween(-1.1, 1.1)) + state.volatility * randomBetween(0, 2.2)),
    );
    state.price = Math.max(state.tickSize, state.price + direction * stepCount * state.tickSize);
    state.accumulatedVolume += state.lastQuantity;
  }

  state.askTotal = Math.round(randomBetween(32_000, 78_000) * (0.8 + state.volumeIntensity * 0.16));
  state.bidTotal = Math.round(randomBetween(32_000, 78_000) * (0.8 + state.volumeIntensity * 0.16));
  return state;
}

function getOutput(stock: StockOption): KisRealtimeOutput {
  const state = advanceStock(stock.id, stock.name);
  const change = state.price - state.previousClose;
  const changeRate = (change / state.previousClose) * 100;
  const tradeStrength = 100 + (state.lastSide === '1' ? 1 : -1) * clamp(state.volumeIntensity * 12 + Math.random() * 16, 2, 55);

  return {
    service_id: stock.id,
    market: stock.market,
    exchange: stock.exchange,
    currency: stock.currency,
    stck_shrn_iscd: stock.symbol,
    hts_kor_isnm: stock.name,
    stck_prpr: stock.currency === 'USD' ? state.price.toFixed(2) : String(Math.round(state.price)),
    prdy_vrss: stock.currency === 'USD' ? change.toFixed(2) : String(Math.round(change)),
    prdy_ctrt: changeRate.toFixed(2),
    acml_vol: String(Math.round(state.accumulatedVolume)),
    cntg_vol: String(Math.round(state.lastQuantity)),
    tday_rltv: tradeStrength.toFixed(2),
    trht_yn: state.haltedUntil > Date.now() ? 'Y' : 'N',
    ccld_dvsn: state.lastSide,
    askp_rsqn1: String(Math.round(state.askTotal * randomBetween(0.08, 0.22))),
    bidp_rsqn1: String(Math.round(state.bidTotal * randomBetween(0.08, 0.22))),
    total_askp_rsqn: String(state.askTotal),
    total_bidp_rsqn: String(state.bidTotal),
  };
}

export function createRealtimeFrame(stock: StockOption): KisRealtimeFrame {
  const state = stateFor(stock.id, stock.name);
  const output = getOutput(stock);
  return {
    header: {
      tr_id: stock.market === 'us' ? 'HDFSCNT0' : 'H0UNCNT0',
      tr_key: stock.id,
      sequence: String(state.sequence),
      timestamp: new Date().toISOString(),
    },
    body: { output },
  };
}
