import 'server-only';

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import iconv from 'iconv-lite';
import type { StockOption } from '@/types/market';

export type DomesticMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX';

export interface DomesticStock extends StockOption {
  market: DomesticMarket;
  marketCap: number;
  securityGroup: string;
}

interface StockCatalog {
  version: 2;
  stocks: DomesticStock[];
  fetchedAt: number;
  stale: boolean;
}

interface MasterSource {
  market: DomesticMarket;
  url: string;
  filename: string;
  trailerLength: number;
  marketCapSlice: readonly [number, number];
}

const MASTER_SOURCES: MasterSource[] = [
  {
    market: 'KOSPI',
    url: 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip',
    filename: 'kospi_code.mst',
    trailerLength: 227,
    marketCapSlice: [-15, -6],
  },
  {
    market: 'KOSDAQ',
    url: 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip',
    filename: 'kosdaq_code.mst',
    trailerLength: 221,
    marketCapSlice: [-15, -6],
  },
  {
    market: 'KONEX',
    url: 'https://new.real.download.dws.co.kr/common/master/konex_code.mst.zip',
    filename: 'konex_code.mst',
    trailerLength: 184,
    marketCapSlice: [-12, -3],
  },
];

const CACHE_TTL = 24 * 60 * 60 * 1000;
const STALE_RETRY_TTL = 5 * 60 * 1000;
const CACHE_DIRECTORY = path.join(process.cwd(), '.cache');
const CACHE_PATH = path.join(CACHE_DIRECTORY, 'kis-stocks.json');
const SERVICE_STOCK_LIMIT = 41;

let memoryCache: StockCatalog | null = null;
let memoryExpiresAt = 0;
let refreshRequest: Promise<StockCatalog> | null = null;

function parseMasterFile(content: Uint8Array, source: MasterSource) {
  const text = iconv.decode(Buffer.from(content), 'cp949');
  return text
    .split(/\r?\n/)
    .map((line): DomesticStock | null => {
      if (line.length <= source.trailerLength + 21) return null;
      const identity = line.slice(0, line.length - source.trailerLength);
      const trailer = line.slice(line.length - source.trailerLength);
      const symbol = identity.slice(0, 9).trim();
      const name = identity.slice(21).trim();
      const marketCap = Number(trailer.slice(...source.marketCapSlice).trim());
      const securityGroup = trailer.slice(0, 2);
      if (!/^[0-9A-Z]{6}$/.test(symbol) || !name) return null;
      return { symbol, name, market: source.market, marketCap, securityGroup };
    })
    .filter((stock): stock is DomesticStock => stock !== null);
}

async function downloadMaster(source: MasterSource) {
  const response = await fetch(source.url, {
    cache: 'no-store',
    headers: { 'User-Agent': 'KIS-Stock-Aquarium/1.0' },
  });
  if (!response.ok) throw new Error(`${source.market} 종목 마스터 다운로드 실패 (${response.status})`);

  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entry = Object.entries(archive).find(([name]) => name.endsWith(source.filename))?.[1];
  if (!entry) throw new Error(`${source.market} 종목 마스터 파일을 찾지 못했습니다.`);
  return parseMasterFile(entry, source);
}

async function readDiskCache() {
  try {
    const value = JSON.parse(await readFile(CACHE_PATH, 'utf8')) as StockCatalog;
    if (value.version !== 2 || !Array.isArray(value.stocks) || typeof value.fetchedAt !== 'number') {
      return null;
    }
    return value;
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
    const groups = await Promise.all(MASTER_SOURCES.map(downloadMaster));
    const stocks = Array.from(
      new Map(groups.flat().map((stock) => [stock.symbol, stock])).values(),
    ).sort((left, right) => left.name.localeCompare(right.name, 'ko'));
    const catalog: StockCatalog = { version: 2, stocks, fetchedAt: Date.now(), stale: false };
    memoryCache = catalog;
    memoryExpiresAt = catalog.fetchedAt + CACHE_TTL;
    await writeDiskCache(catalog).catch(() => undefined);
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

export async function getDomesticStockCatalog() {
  if (memoryCache && memoryExpiresAt > Date.now()) return memoryCache;
  refreshRequest ??= refreshCatalog().finally(() => {
    refreshRequest = null;
  });
  return refreshRequest;
}

export async function findDomesticStock(symbol: string) {
  const catalog = await getDomesticStockCatalog();
  return catalog.stocks.find((stock) => stock.symbol === symbol) ?? null;
}

function isPreferredShare(stock: DomesticStock) {
  return /우(?:B|C)?$/.test(stock.name);
}

export async function getServiceStocks() {
  const catalog = await getDomesticStockCatalog();
  const stocks = catalog.stocks
    .filter((stock) => stock.securityGroup === 'ST' && stock.marketCap > 0 && !isPreferredShare(stock))
    .sort((left, right) => right.marketCap - left.marketCap || left.symbol.localeCompare(right.symbol))
    .slice(0, SERVICE_STOCK_LIMIT);

  return { ...catalog, stocks };
}

export async function findServiceStock(symbol: string) {
  const catalog = await getServiceStocks();
  return catalog.stocks.find((stock) => stock.symbol === symbol) ?? null;
}

export async function searchDomesticStocks(query: string, limit = 50) {
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
    const leftStarts = left.symbol.startsWith(keyword) || left.name.toUpperCase().startsWith(keyword);
    const rightStarts = right.symbol.startsWith(keyword) || right.name.toUpperCase().startsWith(keyword);
    if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
    return keyword
      ? left.name.localeCompare(right.name, 'ko')
      : right.marketCap - left.marketCap;
  });

  return {
    items: stocks.slice(0, Math.min(100, Math.max(1, limit))),
    total: catalog.stocks.length,
    fetchedAt: catalog.fetchedAt,
    stale: catalog.stale,
  };
}
