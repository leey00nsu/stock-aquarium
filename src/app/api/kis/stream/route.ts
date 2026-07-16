import { subscribeKisRealtime } from '@/server/kis/realtime';
import { getKisInitialQuote } from '@/server/kis/quote';
import { acquireSseConnection } from '@/server/security/sse-limiter';
import { findServiceStock } from '@/server/kis/stocks';
import type { KisRealtimeFrame, KisSocketServerMessage } from '@/api/kis/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;
const MARKET_FLUSH_INTERVAL_MS = 100;
const MAX_BACKPRESSURE_DURATION_MS = 15_000;
const STREAM_HIGH_WATER_MARK = 64;

function encodeMessage(message: KisSocketServerMessage) {
  return encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')?.trim() ?? '';
  if (!/^(domestic:[0-9A-Z]{6}|us:[A-Z]{3}:[A-Z0-9./-]{1,16})$/.test(id)) {
    return Response.json({ message: '올바른 서비스 종목 ID가 필요합니다.' }, { status: 400 });
  }
  let stock;
  try {
    stock = await findServiceStock(id);
  } catch {
    return Response.json({ message: '종목 마스터를 불러오지 못했습니다.' }, { status: 503 });
  }
  if (!stock) {
    return Response.json({ message: '서비스 대상 국내 20개·미국 20개 종목이 아닙니다.' }, { status: 404 });
  }

  const admission = acquireSseConnection(request);
  if (!admission.allowed) {
    return Response.json(
      { message: '실시간 연결 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(admission.retryAfterSeconds),
        },
      },
    );
  }

  let cleanup = admission.release;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let backpressureSince: number | null = null;
      let marketFlushTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingMarket: {
        buyFrame: KisRealtimeFrame | null;
        sellFrame: KisRealtimeFrame | null;
        buyQuantity: number;
        sellQuantity: number;
        latestSide: 'buy' | 'sell';
      } | null = null;
      const stop = () => {
        if (closed) return;
        closed = true;
        if (marketFlushTimer) clearTimeout(marketFlushTimer);
        marketFlushTimer = null;
        pendingMarket = null;
        cleanup();
        controller.close();
      };
      const enqueue = (value: Uint8Array) => {
        if (closed) return false;
        if ((controller.desiredSize ?? 1) <= 0) {
          backpressureSince ??= Date.now();
          if (Date.now() - backpressureSince >= MAX_BACKPRESSURE_DURATION_MS) stop();
          return false;
        }
        backpressureSince = null;
        controller.enqueue(value);
        return true;
      };
      const send = (message: KisSocketServerMessage) => {
        if (message.type === 'restart') {
          stop();
          return;
        }
        enqueue(encodeMessage(message));
      };
      let receivedMarket = false;
      const flushMarket = () => {
        marketFlushTimer = null;
        const pending = pendingMarket;
        pendingMarket = null;
        if (!pending || closed) return;
        const sendSide = (side: 'buy' | 'sell') => {
          const source = side === 'buy' ? pending.buyFrame : pending.sellFrame;
          const quantity = side === 'buy' ? pending.buyQuantity : pending.sellQuantity;
          if (!source || quantity <= 0) return;
          const frame: KisRealtimeFrame = {
            ...source,
            body: {
              output: {
                ...source.body.output,
                cntg_vol: String(quantity),
                ccld_dvsn: side === 'buy' ? '1' : '5',
              },
            },
          };
          send({ type: 'market', data: frame });
        };
        const firstSide = pending.latestSide === 'buy' ? 'sell' : 'buy';
        sendSide(firstSide);
        sendSide(pending.latestSide);
      };
      const queueMarket = (frame: KisRealtimeFrame) => {
        const quantity = Math.max(0, Number(frame.body.output.cntg_vol) || 0);
        const side = frame.body.output.ccld_dvsn === '1' ? 'buy' : 'sell';
        if (!pendingMarket) {
          pendingMarket = {
            buyFrame: null,
            sellFrame: null,
            buyQuantity: 0,
            sellQuantity: 0,
            latestSide: side,
          };
        }
        pendingMarket.latestSide = side;
        if (side === 'buy') {
          pendingMarket.buyFrame = frame;
          pendingMarket.buyQuantity += quantity;
        } else {
          pendingMarket.sellFrame = frame;
          pendingMarket.sellQuantity += quantity;
        }
        marketFlushTimer ??= setTimeout(flushMarket, MARKET_FLUSH_INTERVAL_MS);
      };
      const sendMarketMessage = (message: KisSocketServerMessage) => {
        if (message.type === 'market') {
          receivedMarket = true;
          queueMarket(message.data);
          return;
        }
        send(message);
      };

      request.signal.addEventListener('abort', stop, { once: true });
      try {
        const unsubscribe = subscribeKisRealtime(stock, sendMarketMessage);
        const heartbeat = setInterval(() => {
          enqueue(encoder.encode(': keep-alive\n\n'));
        }, HEARTBEAT_INTERVAL_MS);
        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
          admission.release();
        };
        send({ type: 'subscribed', id: stock.id, symbol: stock.symbol });
        void getKisInitialQuote(stock)
          .then((frame) => {
            if (!closed && !receivedMarket && frame) send({ type: 'market', data: frame });
          })
          .catch(() => undefined);
        if (closed) cleanup();
      } catch (error) {
        const message = error instanceof Error ? error.message : '실시간 구독을 시작하지 못했습니다.';
        send({ type: 'error', message });
        stop();
      }
    },
    cancel() {
      closed = true;
      cleanup();
    },
  }, {
    highWaterMark: STREAM_HIGH_WATER_MARK,
    size: () => 1,
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
