import { subscribeKisRealtime } from '@/server/kis/realtime';
import { findServiceStock } from '@/server/kis/stocks';
import type { KisSocketServerMessage } from '@/api/kis/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const HEARTBEAT_INTERVAL_MS = 15_000;

function encodeMessage(message: KisSocketServerMessage) {
  return encoder.encode(`data: ${JSON.stringify(message)}\n\n`);
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get('symbol')?.trim() ?? '';
  if (!/^[0-9A-Z]{6}$/.test(symbol)) {
    return Response.json({ message: '6자리 종목코드가 필요합니다.' }, { status: 400 });
  }
  let stock;
  try {
    stock = await findServiceStock(symbol);
  } catch {
    return Response.json({ message: '종목 마스터를 불러오지 못했습니다.' }, { status: 503 });
  }
  if (!stock) {
    return Response.json({ message: '서비스 대상 상위 41개 종목이 아닙니다.' }, { status: 404 });
  }

  let cleanup = () => {};
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: KisSocketServerMessage) => {
        if (!closed) controller.enqueue(encodeMessage(message));
      };
      const stop = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      request.signal.addEventListener('abort', stop, { once: true });
      try {
        const unsubscribe = subscribeKisRealtime(symbol, stock.name, send);
        const heartbeat = setInterval(() => {
          if (!closed) controller.enqueue(encoder.encode(': keep-alive\n\n'));
        }, HEARTBEAT_INTERVAL_MS);
        cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
        };
        send({ type: 'subscribed', symbol });
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
