import 'server-only';

import type { KisRealtimeFrame, KisSocketServerMessage } from '@/api/kis/types';
import type { ServiceStock } from './stocks';
import { subscribeKisRealtime } from './realtime';

export interface KisSseDelivery {
  type: KisSocketServerMessage['type'];
  payload: Uint8Array;
}

export interface KisSseSubscription {
  unsubscribe: () => void;
  hasReceivedMarket: () => boolean;
}

type SseListener = (delivery: KisSseDelivery) => void;
type TradeSide = 'buy' | 'sell';

interface PendingMarket {
  buyFrame: KisRealtimeFrame | null;
  sellFrame: KisRealtimeFrame | null;
  buyQuantity: number;
  sellQuantity: number;
  latestSide: TradeSide;
}

interface FanoutChannel {
  listeners: Set<SseListener>;
  unsubscribeUpstream?: () => void;
  flushTimer?: ReturnType<typeof setTimeout>;
  pendingMarket: PendingMarket | null;
  marketVersion: number;
}

const MARKET_FLUSH_INTERVAL_MS = 100;
const encoder = new TextEncoder();

const globalForSseFanout = globalThis as typeof globalThis & {
  __kisSseFanoutChannels?: Map<string, FanoutChannel>;
};

const channels = globalForSseFanout.__kisSseFanoutChannels ?? new Map<string, FanoutChannel>();
globalForSseFanout.__kisSseFanoutChannels = channels;

export function encodeKisSseMessage(message: KisSocketServerMessage) {
  return encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
}

function broadcast(channel: FanoutChannel, message: KisSocketServerMessage) {
  const delivery: KisSseDelivery = {
    type: message.type,
    payload: encodeKisSseMessage(message),
  };
  for (const listener of channel.listeners) listener(delivery);
}

function broadcastSiteViewerCount() {
  const count = Array.from(channels.values()).reduce(
    (total, channel) => total + channel.listeners.size,
    0,
  );
  for (const channel of channels.values()) {
    broadcast(channel, { type: 'viewers', count });
  }
}

function flushMarket(channel: FanoutChannel) {
  channel.flushTimer = undefined;
  const pending = channel.pendingMarket;
  channel.pendingMarket = null;
  if (!pending || channel.listeners.size === 0) return;

  const sendSide = (side: TradeSide) => {
    const source = side === 'buy' ? pending.buyFrame : pending.sellFrame;
    const quantity = side === 'buy' ? pending.buyQuantity : pending.sellQuantity;
    if (!source || quantity <= 0) return;
    broadcast(channel, {
      type: 'market',
      data: {
        ...source,
        body: {
          output: {
            ...source.body.output,
            cntg_vol: String(quantity),
            ccld_dvsn: side === 'buy' ? '1' : '5',
          },
        },
      },
    });
  };

  const firstSide = pending.latestSide === 'buy' ? 'sell' : 'buy';
  sendSide(firstSide);
  sendSide(pending.latestSide);
}

function queueMarket(channel: FanoutChannel, frame: KisRealtimeFrame) {
  channel.marketVersion += 1;
  const quantity = Math.max(0, Number(frame.body.output.cntg_vol) || 0);
  const side: TradeSide = frame.body.output.ccld_dvsn === '1' ? 'buy' : 'sell';
  channel.pendingMarket ??= {
    buyFrame: null,
    sellFrame: null,
    buyQuantity: 0,
    sellQuantity: 0,
    latestSide: side,
  };
  channel.pendingMarket.latestSide = side;
  if (side === 'buy') {
    channel.pendingMarket.buyFrame = frame;
    channel.pendingMarket.buyQuantity += quantity;
  } else {
    channel.pendingMarket.sellFrame = frame;
    channel.pendingMarket.sellQuantity += quantity;
  }
  channel.flushTimer ??= setTimeout(() => flushMarket(channel), MARKET_FLUSH_INTERVAL_MS);
}

function handleUpstreamMessage(channel: FanoutChannel, message: KisSocketServerMessage) {
  if (message.type === 'market') {
    queueMarket(channel, message.data);
    return;
  }
  broadcast(channel, message);
}

function createChannel(stock: ServiceStock, listener: SseListener) {
  const channel: FanoutChannel = {
    listeners: new Set([listener]),
    pendingMarket: null,
    marketVersion: 0,
  };
  channels.set(stock.id, channel);
  try {
    channel.unsubscribeUpstream = subscribeKisRealtime(
      stock,
      (message) => handleUpstreamMessage(channel, message),
    );
    return channel;
  } catch (error) {
    channels.delete(stock.id);
    throw error;
  }
}

export function subscribeKisSse(stock: ServiceStock, listener: SseListener): KisSseSubscription {
  let channel = channels.get(stock.id);
  const initialMarketVersion = channel?.marketVersion ?? 0;
  if (channel) channel.listeners.add(listener);
  else channel = createChannel(stock, listener);
  broadcastSiteViewerCount();
  let active = true;

  return {
    hasReceivedMarket: () => channel.marketVersion > initialMarketVersion,
    unsubscribe: () => {
      if (!active) return;
      active = false;
      channel.listeners.delete(listener);
      if (channel.listeners.size > 0) {
        broadcastSiteViewerCount();
        return;
      }
      if (channel.flushTimer) clearTimeout(channel.flushTimer);
      channel.flushTimer = undefined;
      channel.pendingMarket = null;
      channel.unsubscribeUpstream?.();
      channels.delete(stock.id);
      broadcastSiteViewerCount();
    },
  };
}

export function getKisSseFanoutStatus() {
  const values = Array.from(channels.values());
  return {
    connectedClients: values.reduce((total, channel) => total + channel.listeners.size, 0),
    activeChannels: values.length,
    pendingChannels: values.filter((channel) => channel.pendingMarket !== null).length,
  };
}
