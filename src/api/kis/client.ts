import { getKisWebSocketUrl } from './config';
import type { KisRealtimeFrame, KisSocketClientMessage, KisSocketServerMessage } from './types';
import type { MarketSnapshot, TradeSide } from '@/types/market';

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
  const p90 = sorted[Math.floor((sorted.length - 1) * 0.9)] ?? quantity;
  const isLarge = rolling.quantities.length >= 5 && quantity >= Math.max(900, p90 * 1.65);

  return { volumeIntensity, volatility, isLarge };
}

function parseFrame(frame: KisRealtimeFrame): MarketSnapshot {
  const output = frame.body.output;
  const symbol = output.stck_shrn_iscd || frame.header.tr_key;
  const price = toNumber(output.stck_prpr);
  const quantity = toNumber(output.cntg_vol);
  const side: TradeSide = output.ccld_dvsn === '1' ? 'buy' : 'sell';
  const metrics = deriveMetrics(symbol, price, quantity);

  return {
    symbol,
    name: output.hts_kor_isnm || stockNames[symbol] || symbol,
    price,
    change: toNumber(output.prdy_vrss),
    changeRate: toNumber(output.prdy_ctrt),
    accumulatedVolume: toNumber(output.acml_vol),
    tradeStrength: toNumber(output.tday_rltv),
    volumeIntensity: metrics.volumeIntensity,
    volatility: metrics.volatility,
    halted: output.trht_yn === 'Y',
    bidTotal: toNumber(output.total_bidp_rsqn),
    askTotal: toNumber(output.total_askp_rsqn),
    latestTrade: {
      id: `${symbol}-${frame.header.sequence}`,
      side,
      price,
      quantity,
      isLarge: metrics.isLarge,
      occurredAt: Date.now(),
    },
    receivedAt: Date.now(),
  };
}

interface ConnectOptions {
  symbol: string;
  onOpen?: () => void;
  onSnapshot: (snapshot: MarketSnapshot) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

export interface KisMarketSocket {
  close: () => void;
}

function send(socket: WebSocket, message: KisSocketClientMessage) {
  socket.send(JSON.stringify(message));
}

export function connectKisMarketSocket({ symbol, onOpen, onSnapshot, onError, onClose }: ConnectOptions): KisMarketSocket {
  const socket = new WebSocket(getKisWebSocketUrl());

  socket.addEventListener('open', () => {
    send(socket, { type: 'subscribe', symbol });
    onOpen?.();
  });

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as KisSocketServerMessage;
      if (message.type === 'market') onSnapshot(parseFrame(message.data));
      if (message.type === 'error') onError?.(message.message);
    } catch {
      onError?.('실시간 시세 메시지를 해석하지 못했습니다.');
    }
  });

  socket.addEventListener('error', () => {
    onError?.('실시간 시세 연결에 실패했습니다.');
  });

  socket.addEventListener('close', () => {
    onClose?.();
  });

  return {
    close: () => {
      if (socket.readyState === WebSocket.OPEN) send(socket, { type: 'unsubscribe', symbol });
      socket.close(1000, 'client cleanup');
    },
  };
}
