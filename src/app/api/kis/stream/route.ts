import { getKisInitialQuote } from '@/server/kis/quote';
import { acquireSseConnection } from '@/server/security/sse-limiter';
import { findServiceStock } from '@/server/kis/stocks';
import { encodeKisSseMessage, subscribeKisSse } from '@/server/kis/sse-fanout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const heartbeat = new TextEncoder().encode(': keep-alive\n\n');
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_BACKPRESSURE_DURATION_MS = 15_000;
const STREAM_HIGH_WATER_MARK = 64;

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
      const stop = () => {
        if (closed) return;
        closed = true;
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

      request.signal.addEventListener('abort', stop, { once: true });
      try {
        const subscription = subscribeKisSse(stock, (delivery) => {
          if (delivery.type === 'restart') stop();
          else enqueue(delivery.payload);
        });
        const heartbeatTimer = setInterval(() => {
          enqueue(heartbeat);
        }, HEARTBEAT_INTERVAL_MS);
        cleanup = () => {
          clearInterval(heartbeatTimer);
          subscription.unsubscribe();
          admission.release();
        };
        enqueue(encodeKisSseMessage({ type: 'subscribed', id: stock.id, symbol: stock.symbol }));
        void getKisInitialQuote(stock)
          .then((frame) => {
            if (!closed && !subscription.hasReceivedMarket() && frame) {
              enqueue(encodeKisSseMessage({ type: 'market', data: frame }));
            }
          })
          .catch(() => undefined);
        if (closed) cleanup();
      } catch (error) {
        const message = error instanceof Error ? error.message : '실시간 구독을 시작하지 못했습니다.';
        enqueue(encodeKisSseMessage({ type: 'error', message }));
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
