import 'server-only';

import WebSocket, { type RawData } from 'ws';
import { createRealtimeFrame } from '@/mocks/state';
import type {
  KisRealtimeFrame,
  KisRealtimeOutput,
  KisSocketServerMessage,
  KisTradeDivision,
} from '@/api/kis/types';

type KisEnvironment = 'prod' | 'vps';
type MarketListener = (message: KisSocketServerMessage) => void;
type SubscriptionType = '1' | '2';

interface Channel {
  name: string;
  listeners: Set<MarketListener>;
  registered: boolean;
  mockTimer?: ReturnType<typeof setInterval>;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

interface SubscriptionCommand {
  symbol: string;
  type: SubscriptionType;
}

const REST_URLS: Record<KisEnvironment, string> = {
  prod: 'https://openapi.koreainvestment.com:9443',
  vps: 'https://openapivts.koreainvestment.com:29443',
};

const WEBSOCKET_URLS: Record<KisEnvironment, string> = {
  prod: 'ws://ops.koreainvestment.com:21000/tryitout',
  vps: 'ws://ops.koreainvestment.com:31000/tryitout',
};

const MAX_REALTIME_SYMBOLS = 41;
const COMMAND_INTERVAL_MS = 150;
const RELEASE_GRACE_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

let approvalKeyCache: { key: string; expiresAt: number } | null = null;
let approvalKeyRequest: Promise<string> | null = null;
let sequence = 0;

function getEnvironment(): KisEnvironment {
  return process.env.KIS_ENV === 'vps' ? 'vps' : 'prod';
}

function getCredentials() {
  const appkey = process.env.KIS_APP_KEY?.trim();
  const appsecret = process.env.KIS_APP_SECRET?.trim();
  if (!appkey || !appsecret) {
    throw new Error('KIS_APP_KEY와 KIS_APP_SECRET을 서버 환경변수에 설정해 주세요.');
  }
  return { appkey, appsecret };
}

async function requestApprovalKey() {
  const { appkey, appsecret } = getCredentials();
  const response = await fetch(`${REST_URLS[getEnvironment()]}/oauth2/Approval`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/plain',
      charset: 'UTF-8',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey,
      secretkey: appsecret,
    }),
    cache: 'no-store',
  });

  const responseText = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const errorBody = JSON.parse(responseText) as {
        error_description?: string;
        message?: string;
        msg1?: string;
      };
      detail = errorBody.msg1 || errorBody.message || errorBody.error_description || '';
    } catch {
      detail = '';
    }
    throw new Error(
      `KIS WebSocket 접속키 발급에 실패했습니다. (${response.status}${detail ? `: ${detail}` : ''})`,
    );
  }

  const body = JSON.parse(responseText) as { approval_key?: string };
  if (!body.approval_key) throw new Error('KIS 응답에 WebSocket 접속키가 없습니다.');
  approvalKeyCache = { key: body.approval_key, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return body.approval_key;
}

async function getApprovalKey() {
  if (approvalKeyCache && approvalKeyCache.expiresAt > Date.now()) return approvalKeyCache.key;
  approvalKeyRequest ??= requestApprovalKey().finally(() => {
    approvalKeyRequest = null;
  });
  return approvalKeyRequest;
}

function toFrame(values: string[], name?: string): KisRealtimeFrame | null {
  if (values.length < 40) return null;
  const symbol = values[0];
  const output: KisRealtimeOutput = {
    stck_shrn_iscd: symbol,
    hts_kor_isnm: name,
    stck_prpr: values[2],
    prdy_vrss: values[4],
    prdy_ctrt: values[5],
    cntg_vol: values[12],
    acml_vol: values[13],
    tday_rltv: values[18],
    ccld_dvsn: (values[21] === '1' ? '1' : '5') as KisTradeDivision,
    trht_yn: values[35] === 'Y' ? 'Y' : 'N',
    askp_rsqn1: values[36],
    bidp_rsqn1: values[37],
    total_askp_rsqn: values[38],
    total_bidp_rsqn: values[39],
  };

  sequence += 1;
  return {
    header: {
      tr_id: 'H0STCNT0',
      tr_key: symbol,
      sequence: `${values[33]}-${values[1]}-${sequence}`,
      timestamp: new Date().toISOString(),
    },
    body: { output },
  };
}

function parseRealtimeFrames(raw: string, getName: (symbol: string) => string | undefined) {
  const parts = raw.split('|');
  if (parts.length < 4 || parts[1] !== 'H0STCNT0') return [];
  const recordCount = Math.max(1, Number(parts[2]) || 1);
  const values = parts.slice(3).join('|').split('^');
  const fieldCount = Math.floor(values.length / recordCount);
  const frames: KisRealtimeFrame[] = [];

  for (let index = 0; index < recordCount; index += 1) {
    const record = values.slice(index * fieldCount, (index + 1) * fieldCount);
    const frame = toFrame(record, getName(record[0]));
    if (frame) frames.push(frame);
  }
  return frames;
}

class KisRealtimeHub {
  private readonly channels = new Map<string, Channel>();
  private readonly mock = process.env.KIS_ENABLE_MOCK !== 'false';
  private socket: WebSocket | null = null;
  private approvalKey = '';
  private connecting = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  private commandQueue: SubscriptionCommand[] = [];

  subscribe(symbol: string, name: string, listener: MarketListener) {
    let channel = this.channels.get(symbol);
    if (!channel) {
      if (this.channels.size >= MAX_REALTIME_SYMBOLS) {
        throw new Error(`KIS 실시간 구독은 최대 ${MAX_REALTIME_SYMBOLS}종목까지 가능합니다.`);
      }
      channel = { name, listeners: new Set(), registered: false };
      this.channels.set(symbol, channel);
    }

    if (channel.releaseTimer) {
      clearTimeout(channel.releaseTimer);
      channel.releaseTimer = undefined;
    }
    channel.name = name;
    channel.listeners.add(listener);

    if (this.mock) this.startMock(symbol, channel);
    else if (!channel.registered) void this.ensureConnected();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.release(symbol, listener);
    };
  }

  status() {
    return {
      mode: this.mock ? 'mock' : 'kis',
      socketState: this.mock
        ? 'mock'
        : this.connecting
          ? 'connecting'
          : this.socketState(),
      connectedClients: Array.from(this.channels.values()).reduce(
        (total, channel) => total + channel.listeners.size,
        0,
      ),
      activeSymbols: Array.from(this.channels.entries())
        .filter(([, channel]) => channel.listeners.size > 0)
        .map(([symbol]) => symbol),
      registeredSymbols: Array.from(this.channels.entries())
        .filter(([, channel]) => channel.registered)
        .map(([symbol]) => symbol),
      maxSymbols: MAX_REALTIME_SYMBOLS,
    };
  }

  private startMock(symbol: string, channel: Channel) {
    if (channel.mockTimer) return;
    const publish = () => {
      this.broadcast(symbol, {
        type: 'market',
        data: createRealtimeFrame(symbol, channel.name),
      });
    };
    publish();
    channel.mockTimer = setInterval(publish, 1000);
    channel.registered = true;
  }

  private release(symbol: string, listener: MarketListener) {
    const channel = this.channels.get(symbol);
    if (!channel) return;
    channel.listeners.delete(listener);
    if (channel.listeners.size > 0 || channel.releaseTimer) return;

    channel.releaseTimer = setTimeout(() => {
      const current = this.channels.get(symbol);
      if (!current || current.listeners.size > 0) return;
      if (current.mockTimer) clearInterval(current.mockTimer);
      if (!this.mock && current.registered) this.enqueueCommand(symbol, '2');
      this.channels.delete(symbol);
    }, RELEASE_GRACE_MS);
  }

  private async ensureConnected() {
    if (this.mock || this.connecting || this.socket?.readyState === WebSocket.OPEN) {
      if (this.socket?.readyState === WebSocket.OPEN) this.subscribePendingChannels();
      return;
    }
    this.connecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      this.approvalKey = await getApprovalKey();
      if (!this.hasListeners()) return;
      const socket = new WebSocket(WEBSOCKET_URLS[getEnvironment()]);
      this.socket = socket;
      socket.on('open', () => {
        this.reconnectAttempt = 0;
        this.commandQueue = [];
        this.subscribePendingChannels();
      });
      socket.on('message', (data: RawData) => this.handleMessage(socket, data));
      socket.on('error', () => {
        this.broadcastAll({ type: 'error', message: 'KIS 실시간 시세 서버 연결에 실패했습니다.' });
      });
      socket.on('close', () => this.handleClose(socket));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'KIS 서버 연결에 실패했습니다.';
      this.broadcastAll({ type: 'error', message });
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private subscribePendingChannels() {
    for (const [symbol, channel] of this.channels) {
      if (channel.listeners.size > 0 && !channel.registered) this.enqueueCommand(symbol, '1');
    }
  }

  private enqueueCommand(symbol: string, type: SubscriptionType) {
    this.commandQueue = this.commandQueue.filter((command) => command.symbol !== symbol);
    this.commandQueue.push({ symbol, type });
    this.flushCommandQueue();
  }

  private flushCommandQueue() {
    if (this.commandTimer || this.socket?.readyState !== WebSocket.OPEN) return;
    const command = this.commandQueue.shift();
    if (!command) return;
    const channel = this.channels.get(command.symbol);
    if (command.type === '1' && (!channel || channel.listeners.size === 0)) {
      this.flushCommandQueue();
      return;
    }

    this.socket.send(JSON.stringify({
      header: {
        approval_key: this.approvalKey,
        custtype: 'P',
        tr_type: command.type,
        'content-type': 'utf-8',
      },
      body: { input: { tr_id: 'H0STCNT0', tr_key: command.symbol } },
    }));
    if (channel) channel.registered = command.type === '1';
    this.commandTimer = setTimeout(() => {
      this.commandTimer = null;
      this.flushCommandQueue();
    }, COMMAND_INTERVAL_MS);
  }

  private handleMessage(socket: WebSocket, data: RawData) {
    const raw = data.toString();
    if (raw.startsWith('0|') || raw.startsWith('1|')) {
      for (const frame of parseRealtimeFrames(raw, (symbol) => this.channels.get(symbol)?.name)) {
        this.broadcast(frame.header.tr_key, { type: 'market', data: frame });
      }
      return;
    }

    try {
      const message = JSON.parse(raw) as {
        header?: { tr_id?: string; tr_key?: string };
        body?: { rt_cd?: string; msg1?: string; output?: { tr_key?: string } };
      };
      if (message.header?.tr_id === 'PINGPONG') {
        socket.pong(raw);
        return;
      }
      if (message.body?.rt_cd && message.body.rt_cd !== '0') {
        const error = {
          type: 'error' as const,
          message: message.body.msg1 || 'KIS 실시간 구독 요청이 거절되었습니다.',
        };
        const symbol = message.header?.tr_key || message.body.output?.tr_key;
        if (symbol) this.broadcast(symbol, error);
        else this.broadcastAll(error);
      }
    } catch {
      this.broadcastAll({ type: 'error', message: 'KIS 제어 메시지를 해석하지 못했습니다.' });
    }
  }

  private handleClose(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.commandQueue = [];
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.commandTimer = null;
    for (const channel of this.channels.values()) channel.registered = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.mock || this.reconnectTimer || !this.hasListeners()) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected();
    }, delay);
  }

  private hasListeners() {
    return Array.from(this.channels.values()).some((channel) => channel.listeners.size > 0);
  }

  private broadcast(symbol: string, message: KisSocketServerMessage) {
    for (const listener of this.channels.get(symbol)?.listeners ?? []) listener(message);
  }

  private broadcastAll(message: KisSocketServerMessage) {
    for (const channel of this.channels.values()) {
      for (const listener of channel.listeners) listener(message);
    }
  }

  private socketState() {
    if (!this.socket) return 'disconnected';
    return ['connecting', 'open', 'closing', 'closed'][this.socket.readyState] ?? 'unknown';
  }
}

const globalForKis = globalThis as typeof globalThis & {
  __kisRealtimeHub?: KisRealtimeHub;
};

const realtimeHub = globalForKis.__kisRealtimeHub ?? new KisRealtimeHub();
globalForKis.__kisRealtimeHub = realtimeHub;

export function subscribeKisRealtime(symbol: string, name: string, listener: MarketListener) {
  return realtimeHub.subscribe(symbol, name, listener);
}

export function getKisRealtimeStatus() {
  return realtimeHub.status();
}
