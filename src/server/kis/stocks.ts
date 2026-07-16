import 'server-only';

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';
import { getKisAccessToken, getKisCredentials, getKisRestUrl } from './auth';
import type { StockOption } from '@/types/market';

export interface ServiceStock extends StockOption {
  marketCap: number;
  securityGroup: string;
}

interface StockCatalog {
  version: 5;
  stocks: ServiceStock[];
  fetchedAt: number;
  stale: boolean;
}

interface MasterSource {
  exchange: string;
  url: string;
  filename: string;
  trailerLength: number;
  marketCapSlice: readonly [number, number];
}

const MASTER_SOURCES: MasterSource[] = [
  { exchange: 'KOSPI', url: 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip', filename: 'kospi_code.mst', trailerLength: 227, marketCapSlice: [-15, -6] },
  { exchange: 'KOSDAQ', url: 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip', filename: 'kosdaq_code.mst', trailerLength: 221, marketCapSlice: [-15, -6] },
  { exchange: 'KONEX', url: 'https://new.real.download.dws.co.kr/common/master/konex_code.mst.zip', filename: 'konex_code.mst', trailerLength: 184, marketCapSlice: [-12, -3] },
];

const US_EXCHANGES = ['NAS', 'NYS', 'AMS'] as const;
const DOMESTIC_LIMIT = 20;
const US_LIMIT = 20;
const CACHE_TTL = 24 * 60 * 60 * 1_000;
const STALE_RETRY_TTL = 5 * 60 * 1_000;
const CACHE_DIRECTORY = path.join(process.cwd(), '.cache');
const CACHE_PATH = path.join(
  CACHE_DIRECTORY,
  process.env.KIS_ENABLE_MOCK === 'false' ? 'kis-stocks.json' : 'kis-stocks.mock.json',
);

const FALLBACK_US: Array<[string, string, string]> = [
  ['NVDA', 'NVIDIA', 'NAS'], ['MSFT', 'Microsoft', 'NAS'], ['AAPL', 'Apple', 'NAS'],
  ['AMZN', 'Amazon', 'NAS'], ['GOOGL', 'Alphabet A', 'NAS'], ['META', 'Meta Platforms', 'NAS'],
  ['AVGO', 'Broadcom', 'NAS'], ['TSLA', 'Tesla', 'NAS'], ['GOOG', 'Alphabet C', 'NAS'],
  ['LLY', 'Eli Lilly', 'NYS'], ['JPM', 'JPMorgan Chase', 'NYS'], ['WMT', 'Walmart', 'NYS'],
  ['V', 'Visa', 'NYS'], ['ORCL', 'Oracle', 'NYS'], ['MA', 'Mastercard', 'NYS'],
  ['XOM', 'Exxon Mobil', 'NYS'], ['NFLX', 'Netflix', 'NAS'], ['COST', 'Costco', 'NAS'],
  ['JNJ', 'Johnson & Johnson', 'NYS'], ['PLTR', 'Palantir', 'NAS'],
];

let memoryCache: StockCatalog | null = null;
let memoryExpiresAt = 0;
let refreshRequest: Promise<StockCatalog> | null = null;

function parseDomesticMaster(content: Uint8Array, source: MasterSource) {
  return iconv.decode(Buffer.from(content), 'cp949').split(/\r?\n/).map((line): ServiceStock | null => {
    if (line.length <= source.trailerLength + 21) return null;
    const identity = line.slice(0, line.length - source.trailerLength);
    const trailer = line.slice(line.length - source.trailerLength);
    const symbol = identity.slice(0, 9).trim();
    const name = identity.slice(21).trim();
    if (!/^[0-9A-Z]{6}$/.test(symbol) || !name) return null;
    return {
      id: `domestic:${symbol}`,
      symbol,
      name,
      market: 'domestic',
      exchange: source.exchange,
      currency: 'KRW',
      realtimeSymbol: symbol,
      marketCap: Number(trailer.slice(...source.marketCapSlice).trim()),
      securityGroup: trailer.slice(0, 2),
    };
  }).filter((stock): stock is ServiceStock => stock !== null);
}

async function downloadDomesticMaster(source: MasterSource) {
  const response = await fetch(source.url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${source.exchange} 종목 마스터 다운로드 실패 (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('종목 마스터 파일이 너무 큽니다.');
  const archive = unzipSync(bytes);
  const entry = Object.entries(archive).find(([name]) => name.endsWith(source.filename))?.[1];
  if (!entry) throw new Error(`${source.exchange} 종목 마스터 파일을 찾지 못했습니다.`);
  return parseDomesticMaster(entry, source);
}

function isPreferredShare(stock: ServiceStock) {
  return /우(?:B|C)?$/.test(stock.name);
}

async function loadDomesticTopStocks() {
  const groups = await Promise.all(MASTER_SOURCES.map(downloadDomesticMaster));
  return Array.from(new Map(groups.flat().map((stock) => [stock.symbol, stock])).values())
    .filter((stock) => stock.securityGroup === 'ST' && stock.marketCap > 0 && !isPreferredShare(stock))
    .sort((left, right) => right.marketCap - left.marketCap || left.symbol.localeCompare(right.symbol))
    .slice(0, DOMESTIC_LIMIT);
}

function fallbackUsStocks(): ServiceStock[] {
  return FALLBACK_US.map(([symbol, name, exchange], index) => ({
    id: `us:${exchange}:${symbol}`,
    symbol,
    name,
    market: 'us',
    exchange,
    currency: 'USD',
    realtimeSymbol: `D${exchange}${symbol}`,
    marketCap: FALLBACK_US.length - index,
    securityGroup: 'ST',
  }));
}

async function fetchUsMarketCap(exchange: typeof US_EXCHANGES[number]) {
  const [{ appkey, appsecret }, token] = await Promise.all([getKisCredentials(), getKisAccessToken()]);
  const url = new URL('/uapi/overseas-stock/v1/ranking/market-cap', getKisRestUrl());
  url.search = new URLSearchParams({ EXCD: exchange, VOL_RANG: '0', KEYB: '', AUTH: '' }).toString();
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      appkey,
      appsecret,
      tr_id: 'HHDFS76350100',
      custtype: 'P',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`미국 ${exchange} 시가총액 순위 조회 실패 (${response.status})`);
  const body = await response.json() as {
    rt_cd?: string;
    output2?: Array<Record<string, string>>;
  };
  if (body.rt_cd && body.rt_cd !== '0') throw new Error(`미국 ${exchange} 시가총액 순위 조회 거절`);
  return (body.output2 ?? []).map((item): ServiceStock | null => {
    const symbol = item.symb?.trim();
    const name = item.name?.trim() || item.ename?.trim() || symbol;
    if (!symbol || !/^[A-Z0-9./-]{1,16}$/.test(symbol)) return null;
    return {
      id: `us:${exchange}:${symbol}`,
      symbol,
      name,
      market: 'us',
      exchange,
      currency: 'USD',
      realtimeSymbol: item.rsym?.trim() || `D${exchange}${symbol}`,
      marketCap: Number(item.mcap || item.tomv || 0),
      securityGroup: 'ST',
    };
  }).filter((stock): stock is ServiceStock => stock !== null);
}

async function loadUsTopStocks() {
  if (process.env.KIS_ENABLE_MOCK !== 'false') {
    return { stocks: fallbackUsStocks(), stale: false };
  }
  try {
    const groups = await Promise.all(US_EXCHANGES.map(fetchUsMarketCap));
    const stocks = Array.from(new Map(groups.flat().map((stock) => [stock.id, stock])).values())
      .sort((left, right) => right.marketCap - left.marketCap)
      .slice(0, US_LIMIT);
    return stocks.length >= US_LIMIT
      ? { stocks, stale: false }
      : { stocks: fallbackUsStocks(), stale: true };
  } catch {
    return { stocks: fallbackUsStocks(), stale: true };
  }
}

async function readDiskCache() {
  try {
    const value = JSON.parse(await readFile(CACHE_PATH, 'utf8')) as StockCatalog;
    return value.version === 5 && Array.isArray(value.stocks) && typeof value.fetchedAt === 'number'
      ? value
      : null;
  } catch {
    return null;
  }
}

async function writeDiskCache(catalog: StockCatalog) {
  await mkdir(CACHE_DIRECTORY, { recursive: true });
  const temporaryPath = `${CACHE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(catalog), 'utf8');
  await rename(temporaryPath, CACHE_PATH);
}

async function refreshCatalog() {
  const diskCache = await readDiskCache();
  if (diskCache && Date.now() - diskCache.fetchedAt < CACHE_TTL) {
    const catalog = { ...diskCache, stale: false };
    memoryCache = catalog;
    memoryExpiresAt = diskCache.fetchedAt + CACHE_TTL;
    return catalog;
  }
  try {
    const [domestic, us] = await Promise.all([loadDomesticTopStocks(), loadUsTopStocks()]);
    if (us.stale && diskCache) {
      const catalog = { ...diskCache, stale: true };
      memoryCache = catalog;
      memoryExpiresAt = Date.now() + STALE_RETRY_TTL;
      return catalog;
    }
    const catalog: StockCatalog = {
      version: 5,
      stocks: [...domestic, ...us.stocks],
      fetchedAt: Date.now(),
      stale: us.stale,
    };
    memoryCache = catalog;
    memoryExpiresAt = us.stale ? Date.now() + STALE_RETRY_TTL : catalog.fetchedAt + CACHE_TTL;
    if (!us.stale) await writeDiskCache(catalog).catch(() => undefined);
    return catalog;
  } catch (error) {
    if (diskCache) {
      const catalog = { ...diskCache, stale: true };
      memoryCache = catalog;
      memoryExpiresAt = Date.now() + STALE_RETRY_TTL;
      return catalog;
    }
    throw error;
  }
}

export async function getServiceStocks() {
  if (memoryCache && memoryExpiresAt > Date.now()) return memoryCache;
  refreshRequest ??= refreshCatalog().finally(() => {
    refreshRequest = null;
  });
  return refreshRequest;
}

export async function findServiceStock(id: string) {
  const catalog = await getServiceStocks();
  return catalog.stocks.find((stock) => stock.id === id) ?? null;
}

export async function searchServiceStocks(query: string, limit = 50) {
  const catalog = await getServiceStocks();
  const keyword = query.trim().replaceAll(' ', '').toUpperCase();
  const stocks = keyword
    ? catalog.stocks.filter((stock) => {
        const normalizedName = stock.name.replaceAll(' ', '').toUpperCase();
        return stock.symbol.includes(keyword) || normalizedName.includes(keyword);
      })
    : [...catalog.stocks];
  stocks.sort((left, right) => {
    const leftExact = left.symbol === keyword || left.name.toUpperCase() === keyword;
    const rightExact = right.symbol === keyword || right.name.toUpperCase() === keyword;
    if (leftExact !== rightExact) return leftExact ? -1 : 1;
    if (left.market !== right.market) return left.market === 'domestic' ? -1 : 1;
    return right.marketCap - left.marketCap;
  });
  return {
    items: stocks.slice(0, Math.min(100, Math.max(1, limit))),
    total: catalog.stocks.length,
    domesticTotal: catalog.stocks.filter((stock) => stock.market === 'domestic').length,
    usTotal: catalog.stocks.filter((stock) => stock.market === 'us').length,
    fetchedAt: catalog.fetchedAt,
    stale: catalog.stale,
  };
}
