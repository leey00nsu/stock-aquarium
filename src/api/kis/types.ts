export type KisTradeDivision = '1' | '5';

import type { StockCurrency, StockMarket } from '@/types/market';

export interface KisRealtimeHeader {
  tr_id: string;
  tr_key: string;
  sequence: string;
  timestamp: string;
}

export interface KisRealtimeOutput {
  service_id: string;
  market: StockMarket;
  exchange: string;
  currency: StockCurrency;
  stck_shrn_iscd: string;
  hts_kor_isnm?: string;
  stck_prpr: string;
  prdy_vrss: string;
  prdy_ctrt: string;
  acml_vol: string;
  cntg_vol: string;
  tday_rltv: string;
  trht_yn: 'Y' | 'N';
  ccld_dvsn: KisTradeDivision;
  askp_rsqn1: string;
  bidp_rsqn1: string;
  total_askp_rsqn: string;
  total_bidp_rsqn: string;
}

export interface KisRealtimeFrame {
  header: KisRealtimeHeader;
  body: {
    output: KisRealtimeOutput;
  };
}

export type KisSocketServerMessage =
  | { type: 'subscribed'; id: string; symbol: string }
  | { type: 'viewers'; count: number }
  | { type: 'restart' }
  | { type: 'pong' }
  | { type: 'market'; data: KisRealtimeFrame }
  | { type: 'error'; message: string };
