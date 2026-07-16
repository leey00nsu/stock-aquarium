import 'server-only';

import { createRealtimeFrame } from '@/mocks/state';
import type { KisRealtimeFrame, KisRealtimeOutput } from '@/api/kis/types';
import { getKisAccessToken, getKisCredentials, getKisRestUrl } from './auth';
import type { ServiceStock } from './stocks';

const QUOTE_CACHE_TTL_MS = 15_000;
const REST_REQUEST_INTERVAL_MS = 75;

interface QuoteCacheEntry {
  frame: KisRealtimeFrame;
  expiresAt: number;
}

interface QuoteState {
  cache: Map<string, QuoteCacheEntry>;
  pending: Map<string, Promise<KisRealtimeFrame | null>>;
  queue: Promise<void>;
  nextRequestAt: number;
  sequence: number;
}

const globalForQuote = globalThis as typeof globalThis & {
  __kisQuoteState?: QuoteState;
};

const quoteState = globalForQuote.__kisQuoteState ?? {
  cache: new Map(),
  pending: new Map(),
  queue: Promise.resolve(),
  nextRequestAt: 0,
  sequence: 0,
};
globalForQuote.__kisQuoteState = quoteState;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function scheduleRestRequest<T>(request: () => Promise<T>) {
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  quoteState.queue = quoteState.queue.then(async () => {
    const wait = Math.max(0, quoteState.nextRequestAt - Date.now());
    if (wait > 0) await delay(wait);
    quoteState.nextRequestAt = Date.now() + REST_REQUEST_INTERVAL_MS;
    try {
      resolveResult(await request());
    } catch (error) {
      rejectResult(error);
    }
  });
  return result;
}

function createQuoteFrame(stock: ServiceStock, output: KisRealtimeOutput): KisRealtimeFrame {
  quoteState.sequence += 1;
  return {
    header: {
      tr_id: stock.market === 'us' ? 'HHDFS00000300' : 'FHKST01010100',
      tr_key: stock.id,
      sequence: `quote-${quoteState.sequence}`,
      timestamp: new Date().toISOString(),
    },
    body: { output },
  };
}

async function requestDomesticQuote(stock: ServiceStock): Promise<KisRealtimeFrame | null> {
  const [{ appkey, appsecret }, token] = await Promise.all([getKisCredentials(), getKisAccessToken()]);
  const url = new URL('/uapi/domestic-stock/v1/quotations/inquire-price', getKisRestUrl());
  url.search = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'UN',
    FID_INPUT_ISCD: stock.symbol,
  }).toString();
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: 'FHKST01010100',
      custtype: 'P',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json() as {
    rt_cd?: string;
    msg1?: string;
    output?: Record<string, string>;
  };
  if (!response.ok || (body.rt_cd && body.rt_cd !== '0') || !body.output) {
    throw new Error(body.msg1 || `국내 현재가 조회 실패 (${response.status})`);
  }
  const value = body.output;
  if (!(Number(value.stck_prpr) > 0)) return null;
  return createQuoteFrame(stock, {
    service_id: stock.id,
    market: stock.market,
    exchange: stock.exchange,
    currency: stock.currency,
    stck_shrn_iscd: stock.symbol,
    hts_kor_isnm: stock.name,
    stck_prpr: value.stck_prpr,
    prdy_vrss: value.prdy_vrss || '0',
    prdy_ctrt: value.prdy_ctrt || '0',
    cntg_vol: '0',
    acml_vol: value.acml_vol || '0',
    tday_rltv: value.tday_rltv || '0',
    ccld_dvsn: '1',
    trht_yn: value.trht_yn === 'Y' ? 'Y' : 'N',
    askp_rsqn1: value.askp_rsqn1 || '0',
    bidp_rsqn1: value.bidp_rsqn1 || '0',
    total_askp_rsqn: value.total_askp_rsqn || '0',
    total_bidp_rsqn: value.total_bidp_rsqn || '0',
  });
}

async function requestUsQuote(stock: ServiceStock): Promise<KisRealtimeFrame | null> {
  const [{ appkey, appsecret }, token] = await Promise.all([getKisCredentials(), getKisAccessToken()]);
  const url = new URL('/uapi/overseas-price/v1/quotations/price', getKisRestUrl());
  url.search = new URLSearchParams({ AUTH: '', EXCD: stock.exchange, SYMB: stock.symbol }).toString();
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: 'HHDFS00000300',
      custtype: 'P',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json() as {
    rt_cd?: string;
    msg1?: string;
    output?: Record<string, string>;
  };
  if (!response.ok || (body.rt_cd && body.rt_cd !== '0') || !body.output) {
    throw new Error(body.msg1 || `미국 현재가 조회 실패 (${response.status})`);
  }
  const value = body.output;
  if (!(Number(value.last) > 0)) return null;
  return createQuoteFrame(stock, {
    service_id: stock.id,
    market: stock.market,
    exchange: stock.exchange,
    currency: stock.currency,
    stck_shrn_iscd: stock.symbol,
    hts_kor_isnm: stock.name,
    stck_prpr: value.last,
    prdy_vrss: value.diff || '0',
    prdy_ctrt: value.rate || '0',
    cntg_vol: '0',
    acml_vol: value.tvol || '0',
    tday_rltv: '0',
    ccld_dvsn: '1',
    trht_yn: 'N',
    askp_rsqn1: '0',
    bidp_rsqn1: '0',
    total_askp_rsqn: '0',
    total_bidp_rsqn: '0',
  });
}

async function requestQuote(stock: ServiceStock): Promise<KisRealtimeFrame | null> {
  if (process.env.KIS_ENABLE_MOCK !== 'false') {
    const frame = createRealtimeFrame(stock);
    frame.body.output.cntg_vol = '0';
    return frame;
  }
  return scheduleRestRequest(() => (
    stock.market === 'us' ? requestUsQuote(stock) : requestDomesticQuote(stock)
  ));
}

export function getKisInitialQuote(stock: ServiceStock): Promise<KisRealtimeFrame | null> {
  const cached = quoteState.cache.get(stock.id);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.frame);

  const existing = quoteState.pending.get(stock.id);
  if (existing) return existing;

  const pending = requestQuote(stock)
    .then((frame) => {
      if (frame) quoteState.cache.set(stock.id, { frame, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS });
      return frame;
    })
    .finally(() => quoteState.pending.delete(stock.id));
  quoteState.pending.set(stock.id, pending);
  return pending;
}
