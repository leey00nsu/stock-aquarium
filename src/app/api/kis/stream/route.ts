import { subscribeKisRealtime } from '@/server/kis/realtime';
import { acquireSseConnection } from '@/server/security/sse-limiter';
import { findServiceStock } from '@/server/kis/stocks';
import type { KisSocketServerMessage } from '@/api/kis/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_BACKPRESSURE_DROPS = 20;

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
      let backpressureDrops = 0;
      const stop = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };
      const enqueue = (value: Uint8Array) => {
        if (closed) return false;
        if ((controller.desiredSize ?? 1) <= 0) {
          backpressureDrops += 1;
          if (backpressureDrops >= MAX_BACKPRESSURE_DROPS) stop();
          return false;
        }
        backpressureDrops = 0;
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

      request.signal.addEventListener('abort', stop, { once: true });
      try {
        const unsubscribe = subscribeKisRealtime(stock, send);
        const heartbeat = setInterval(() => {
          enqueue(encoder.encode(': keep-alive\n\n'));
        }, HEARTBEAT_INTERVAL_MS);
        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
          admission.release();
        };
        send({ type: 'subscribed', id: stock.id, symbol: stock.symbol });
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
