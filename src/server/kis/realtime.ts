import 'server-only';

import WebSocket, { type RawData } from 'ws';
import { createRealtimeFrame } from '@/mocks/state';
import { getKisApprovalKey, getKisEnvironment, type KisEnvironment } from './auth';
import type { ServiceStock } from './stocks';
import type {
  KisRealtimeFrame,
  KisRealtimeOutput,
  KisSocketServerMessage,
  KisTradeDivision,
} from '@/api/kis/types';

type MarketListener = (message: KisSocketServerMessage) => void;
type SubscriptionType = '1' | '2';

interface Channel {
  stock: ServiceStock;
  trId: string;
  trKey: string;
  listeners: Set<MarketListener>;
  registered: boolean;
  mockTimer?: ReturnType<typeof setInterval>;
  releaseTimer?: ReturnType<typeof setTimeout>;
  lastPrice?: number;
  askQuantity: number;
  bidQuantity: number;
}

interface SubscriptionCommand {
  channelId: string;
  trId: string;
  trKey: string;
  type: SubscriptionType;
}

const WEBSOCKET_URLS: Record<KisEnvironment, string> = {
  prod: 'ws://ops.koreainvestment.com:21000/tryitout',
  vps: 'ws://ops.koreainvestment.com:31000/tryitout',
};

const MAX_REALTIME_SYMBOLS = 40;
const COMMAND_INTERVAL_MS = 150;
const RELEASE_GRACE_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const REALTIME_HUB_VERSION = 3;
let sequence = 0;

function createFrame(
  values: string[],
  channel: Channel,
  trId: string,
): KisRealtimeFrame | null {
  if (channel.stock.market === 'us') return createUsFrame(values, channel, trId);
  if (values.length < 40) return null;
  const { stock } = channel;
  channel.askQuantity = Number(values[36]) || channel.askQuantity;
  channel.bidQuantity = Number(values[37]) || channel.bidQuantity;
  const output: KisRealtimeOutput = {
    service_id: stock.id,
    market: stock.market,
    exchange: stock.exchange,
    currency: stock.currency,
    stck_shrn_iscd: stock.symbol,
    hts_kor_isnm: stock.name,
    stck_prpr: values[2],
    prdy_vrss: values[4],
    prdy_ctrt: values[5],
    cntg_vol: values[12],
    acml_vol: values[13],
    tday_rltv: values[18],
    ccld_dvsn: (values[21] === '1' ? '1' : '5') as KisTradeDivision,
    trht_yn: trId !== 'H0UNCNT0' && values[35] === 'Y' ? 'Y' : 'N',
    askp_rsqn1: String(channel.askQuantity),
    bidp_rsqn1: String(channel.bidQuantity),
    total_askp_rsqn: String(channel.askQuantity),
    total_bidp_rsqn: String(channel.bidQuantity),
  };

  sequence += 1;
  return {
    header: {
      tr_id: trId,
      tr_key: stock.id,
      sequence: `${values[33]}-${values[1]}-${sequence}`,
      timestamp: new Date().toISOString(),
    },
    body: { output },
  };
}

function createUsFrame(values: string[], channel: Channel, trId: string): KisRealtimeFrame | null {
  if (values.length < 25) return null;
  const { stock } = channel;
  const price = Number(values[10]) || 0;
  const bid = Number(values[14]) || 0;
  const ask = Number(values[15]) || 0;
  const previousPrice = channel.lastPrice ?? price;
  const buy = ask > 0 && price >= ask ? true : bid > 0 && price <= bid ? false : price >= previousPrice;
  channel.lastPrice = price;
  channel.bidQuantity = Number(values[16]) || channel.bidQuantity;
  channel.askQuantity = Number(values[17]) || channel.askQuantity;
  sequence += 1;
  return {
    header: {
      tr_id: trId,
      tr_key: stock.id,
      sequence: `${values[2]}-${values[4]}-${sequence}`,
      timestamp: new Date().toISOString(),
    },
    body: {
      output: {
        service_id: stock.id,
        market: stock.market,
        exchange: stock.exchange,
        currency: stock.currency,
        stck_shrn_iscd: stock.symbol,
        hts_kor_isnm: stock.name,
        stck_prpr: values[10],
        prdy_vrss: values[12],
        prdy_ctrt: values[13],
        cntg_vol: values[18],
        acml_vol: values[19],
        tday_rltv: values[23],
        ccld_dvsn: buy ? '1' : '5',
        trht_yn: 'N',
        askp_rsqn1: String(channel.askQuantity),
        bidp_rsqn1: String(channel.bidQuantity),
        total_askp_rsqn: String(channel.askQuantity),
        total_bidp_rsqn: String(channel.bidQuantity),
      },
    },
  };
}

function parseRealtimeFrames(raw: string, findChannel: (trId: string, key: string) => Channel | undefined) {
  const parts = raw.split('|');
  if (parts.length < 4) return [];
  const trId = parts[1];
  if (!['H0STCNT0', 'H0NXCNT0', 'H0UNCNT0', 'H0STOUP0', 'HDFSCNT0'].includes(trId)) return [];
  const recordCount = Math.max(1, Number(parts[2]) || 1);
  const values = parts.slice(3).join('|').split('^');
  const fieldCount = Math.floor(values.length / recordCount);
  const frames: KisRealtimeFrame[] = [];

  for (let index = 0; index < recordCount; index += 1) {
    const record = values.slice(index * fieldCount, (index + 1) * fieldCount);
    const channel = findChannel(trId, record[0]);
    const frame = channel ? createFrame(record, channel, trId) : null;
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

  subscribe(stock: ServiceStock, listener: MarketListener) {
    const channelId = stock.id;
    let channel = this.channels.get(channelId);
    if (!channel) {
      if (this.channels.size >= MAX_REALTIME_SYMBOLS) {
        throw new Error(`KIS 실시간 구독은 최대 ${MAX_REALTIME_SYMBOLS}종목까지 가능합니다.`);
      }
      channel = {
        stock,
        trId: stock.market === 'us' ? 'HDFSCNT0' : 'H0UNCNT0',
        trKey: stock.realtimeSymbol,
        listeners: new Set(),
        registered: false,
        askQuantity: 10_000,
        bidQuantity: 10_000,
      };
      this.channels.set(channelId, channel);
    }

    if (channel.releaseTimer) {
      clearTimeout(channel.releaseTimer);
      channel.releaseTimer = undefined;
    }
    channel.stock = stock;
    channel.listeners.add(listener);

    if (this.mock) this.startMock(channelId, channel);
    else if (!channel.registered) void this.ensureConnected();

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.release(channelId, listener);
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

  shutdown() {
    this.broadcastAll({ type: 'restart' });
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.commandTimer) clearTimeout(this.commandTimer);
    this.reconnectTimer = null;
    this.commandTimer = null;
    this.commandQueue = [];
    for (const channel of this.channels.values()) {
      if (channel.mockTimer) clearInterval(channel.mockTimer);
      if (channel.releaseTimer) clearTimeout(channel.releaseTimer);
    }
    this.channels.clear();
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.close();
  }

  private startMock(channelId: string, channel: Channel) {
    if (channel.mockTimer) return;
    const publish = () => {
      this.broadcast(channelId, {
        type: 'market',
        data: createRealtimeFrame(channel.stock),
      });
    };
    publish();
    channel.mockTimer = setInterval(publish, 1000);
    channel.registered = true;
  }

  private release(channelId: string, listener: MarketListener) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    channel.listeners.delete(listener);
    if (channel.listeners.size > 0 || channel.releaseTimer) return;

    channel.releaseTimer = setTimeout(() => {
      const current = this.channels.get(channelId);
      if (!current || current.listeners.size > 0) return;
      if (current.mockTimer) clearInterval(current.mockTimer);
      if (!this.mock && current.registered) this.enqueueCommand(channelId, '2');
      this.channels.delete(channelId);
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
      this.approvalKey = await getKisApprovalKey();
      if (!this.hasListeners()) return;
      const socket = new WebSocket(WEBSOCKET_URLS[getKisEnvironment()]);
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
    for (const [channelId, channel] of this.channels) {
      if (channel.listeners.size > 0 && !channel.registered) this.enqueueCommand(channelId, '1');
    }
  }

  private enqueueCommand(channelId: string, type: SubscriptionType) {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    this.commandQueue = this.commandQueue.filter((command) => (
      command.channelId !== channelId || command.type !== type
    ));
    this.commandQueue.push({ channelId, trId: channel.trId, trKey: channel.trKey, type });
    this.flushCommandQueue();
  }

  private flushCommandQueue() {
    if (this.commandTimer || this.socket?.readyState !== WebSocket.OPEN) return;
    const command = this.commandQueue.shift();
    if (!command) return;
    const channel = this.channels.get(command.channelId);
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
      body: { input: { tr_id: command.trId, tr_key: command.trKey } },
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
      for (const frame of parseRealtimeFrames(raw, (trId, key) => (
        Array.from(this.channels.values()).find((channel) => (
          channel.trId === trId && (channel.trKey === key || channel.stock.symbol === key)
        ))
      ))) {
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
        const key = message.header?.tr_key || message.body.output?.tr_key;
        const channelId = key
          ? Array.from(this.channels.entries()).find(([, channel]) => channel.trKey === key)?.[0]
          : undefined;
        if (channelId) this.broadcast(channelId, error);
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

interface RealtimeHubState {
  version: number;
  hub: KisRealtimeHub;
}

interface LegacyRealtimeHub {
  socket?: WebSocket | null;
  channels?: Map<string, Channel>;
  reconnectTimer?: ReturnType<typeof setTimeout> | null;
  commandTimer?: ReturnType<typeof setTimeout> | null;
  broadcastAll?: (message: KisSocketServerMessage) => void;
}

const globalForKis = globalThis as typeof globalThis & {
  __kisRealtimeHub?: RealtimeHubState | KisRealtimeHub;
};

function isRealtimeHubState(value: RealtimeHubState | KisRealtimeHub): value is RealtimeHubState {
  return 'version' in value && 'hub' in value;
}

function shutdownLegacyHub(hub: LegacyRealtimeHub) {
  hub.broadcastAll?.({ type: 'restart' });
  if (hub.reconnectTimer) clearTimeout(hub.reconnectTimer);
  if (hub.commandTimer) clearTimeout(hub.commandTimer);
  for (const channel of hub.channels?.values() ?? []) {
    if (channel.mockTimer) clearInterval(channel.mockTimer);
    if (channel.releaseTimer) clearTimeout(channel.releaseTimer);
  }
  hub.channels?.clear();
  hub.socket?.removeAllListeners();
  hub.socket?.close();
}

const previousHubState = globalForKis.__kisRealtimeHub;
let realtimeHub: KisRealtimeHub;
if (previousHubState && isRealtimeHubState(previousHubState) && previousHubState.version === REALTIME_HUB_VERSION) {
  realtimeHub = previousHubState.hub;
} else {
  if (previousHubState) {
    if (isRealtimeHubState(previousHubState)) previousHubState.hub.shutdown();
    else shutdownLegacyHub(previousHubState as unknown as LegacyRealtimeHub);
  }
  realtimeHub = new KisRealtimeHub();
  globalForKis.__kisRealtimeHub = { version: REALTIME_HUB_VERSION, hub: realtimeHub };
}

export function subscribeKisRealtime(stock: ServiceStock, listener: MarketListener) {
  return realtimeHub.subscribe(stock, listener);
}

export function getKisRealtimeStatus() {
  return realtimeHub.status();
}
