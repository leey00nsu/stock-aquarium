import { getKisStreamUrl } from './config';
import type { KisRealtimeFrame, KisSocketServerMessage } from './types';
import type { MarketSnapshot, StockOption, TradeSide } from '@/types/market';

const stockNames: Record<string, string> = {
  '005930': '삼성전자',
  '000660': 'SK하이닉스',
  '035420': 'NAVER',
  '035720': '카카오',
};

interface RollingState {
  prices: number[];
  quantities: number[];
}

const rollingStates = new Map<string, RollingState>();

const toNumber = (value: string | number | undefined) => Number(value ?? 0);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function sizeScaleFromPercentile(percentile: number) {
  if (percentile <= 0.5) return 0.6 + (percentile / 0.5) * 0.4;
  if (percentile <= 0.9) return 1 + ((percentile - 0.5) / 0.4) * 0.5;
  return 1.5 + ((percentile - 0.9) / 0.1) ** 1.35;
}

function deriveMetrics(symbol: string, price: number, quantity: number) {
  const rolling = rollingStates.get(symbol) ?? { prices: [], quantities: [] };
  rolling.prices.push(price);
  rolling.quantities.push(quantity);
  rolling.prices = rolling.prices.slice(-40);
  rolling.quantities = rolling.quantities.slice(-40);
  rollingStates.set(symbol, rolling);

  const meanQuantity = rolling.quantities.reduce((sum, value) => sum + value, 0) / Math.max(1, rolling.quantities.length);
  const volumeIntensity = clamp(quantity / Math.max(1, meanQuantity), 0.45, 4.5);
  const returns = rolling.prices.slice(1).map((value, index) => {
    const previous = rolling.prices[index];
    return previous > 0 ? (value - previous) / previous : 0;
  });
  const volatility = clamp(standardDeviation(returns) * 1100, 0, 1.5);
  const sorted = [...rolling.quantities].sort((a, b) => a - b);
  const lessCount = sorted.filter((value) => value < quantity).length;
  const equalCount = sorted.filter((value) => value === quantity).length;
  const percentile = rolling.quantities.length < 5
    ? 0.5
    : (lessCount + equalCount * 0.5) / sorted.length;
  const sizeScale = clamp(sizeScaleFromPercentile(percentile), 0.6, 2.5);

  return { volumeIntensity, volatility, sizeScale };
}

function parseFrame(frame: KisRealtimeFrame): MarketSnapshot {
  const output = frame.body.output;
  const symbol = output.stck_shrn_iscd || frame.header.tr_key;
  const price = toNumber(output.stck_prpr);
  const quantity = toNumber(output.cntg_vol);
  const side: TradeSide = output.ccld_dvsn === '1' ? 'buy' : 'sell';
  const metrics = quantity > 0
    ? deriveMetrics(output.service_id, price, quantity)
    : { volumeIntensity: 0, volatility: 0, sizeScale: 1 };

  return {
    source: frame.header.tr_id === 'FHKST01010100' || frame.header.tr_id === 'HHDFS00000300'
      ? 'quote'
      : 'trade',
    id: output.service_id,
    symbol,
    name: output.hts_kor_isnm || stockNames[symbol] || symbol,
    market: output.market,
    exchange: output.exchange,
    currency: output.currency,
    price,
    change: toNumber(output.prdy_vrss),
    changeRate: toNumber(output.prdy_ctrt),
    accumulatedVolume: toNumber(output.acml_vol),
    tradeStrength: toNumber(output.tday_rltv),
    volumeIntensity: metrics.volumeIntensity,
    volatility: metrics.volatility,
    halted: output.trht_yn === 'Y',
    bidTotal: toNumber(output.bidp_rsqn1),
    askTotal: toNumber(output.askp_rsqn1),
    latestTrade: {
      id: `${output.service_id}-${frame.header.sequence}`,
      side,
      price,
      quantity,
      sizeScale: metrics.sizeScale,
      occurredAt: Date.now(),
    },
    receivedAt: Date.now(),
  };
}

interface ConnectOptions {
  stock: StockOption;
  onOpen?: () => void;
  onSnapshot: (snapshot: MarketSnapshot) => void;
  onError?: (message: string) => void;
}

export interface KisMarketConnection {
  close: () => void;
}

export function connectKisMarketStream({ stock, onOpen, onSnapshot, onError }: ConnectOptions): KisMarketConnection {
  const source = new EventSource(getKisStreamUrl(stock.id));
  let reconnectErrorTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReconnectError = () => {
    if (!reconnectErrorTimer) return;
    clearTimeout(reconnectErrorTimer);
    reconnectErrorTimer = null;
  };

  source.addEventListener('open', () => {
    clearReconnectError();
    onOpen?.();
  });
  source.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as KisSocketServerMessage;
      if (message.type === 'market') onSnapshot(parseFrame(message.data));
      if (message.type === 'error') onError?.(message.message);
    } catch {
      onError?.('실시간 시세 메시지를 해석하지 못했습니다.');
    }
  });

  source.addEventListener('error', () => {
    if (reconnectErrorTimer) return;
    reconnectErrorTimer = setTimeout(() => {
      reconnectErrorTimer = null;
      if (source.readyState !== EventSource.OPEN) {
        onError?.('실시간 시세 연결에 실패했습니다.');
      }
    }, 8_000);
  });

  return {
    close: () => {
      clearReconnectError();
      source.close();
    },
  };
}
