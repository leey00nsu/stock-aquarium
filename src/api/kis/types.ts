export type KisTradeDivision = '1' | '5';

export interface KisRealtimeHeader {
  tr_id: 'H0STCNT0';
  tr_key: string;
  sequence: string;
  timestamp: string;
}

export interface KisRealtimeOutput {
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
  total_askp_rsqn: string;
  total_bidp_rsqn: string;
}

export interface KisRealtimeFrame {
  header: KisRealtimeHeader;
  body: {
    output: KisRealtimeOutput;
  };
}

export type KisSocketClientMessage =
  | { type: 'subscribe'; symbol: string }
  | { type: 'unsubscribe'; symbol: string }
  | { type: 'ping' };

export type KisSocketServerMessage =
  | { type: 'subscribed'; symbol: string }
  | { type: 'pong' }
  | { type: 'market'; data: KisRealtimeFrame }
  | { type: 'error'; message: string };
