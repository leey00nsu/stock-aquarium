import { ws } from 'msw';
import { KIS_WS_PATH } from '@/api/kis/config';
import type { KisSocketClientMessage, KisSocketServerMessage } from '@/api/kis/types';
import { createRealtimeFrame } from './state';

const kisRealtime = ws.link(`*${KIS_WS_PATH}`);

const realtimeHandler = kisRealtime.addEventListener('connection', ({ client }) => {
  let symbol = client.url.searchParams.get('symbol') ?? '005930';
  let timer: ReturnType<typeof setInterval> | undefined;

  const send = (message: KisSocketServerMessage) => client.send(JSON.stringify(message));
  const sendMarket = () => send({ type: 'market', data: createRealtimeFrame(symbol) });

  const start = () => {
    if (timer) clearInterval(timer);
    send({ type: 'subscribed', symbol });
    sendMarket();
    timer = setInterval(sendMarket, 1000);
  };

  client.addEventListener('message', (event) => {
    event.preventDefault();
    try {
      const message = JSON.parse(String(event.data)) as KisSocketClientMessage;
      if (message.type === 'subscribe') {
        symbol = message.symbol;
        start();
      }
      if (message.type === 'unsubscribe' && timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (message.type === 'ping') send({ type: 'pong' });
    } catch {
      send({ type: 'error', message: '구독 메시지 형식이 올바르지 않습니다.' });
    }
  });

  client.addEventListener('close', () => {
    if (timer) clearInterval(timer);
  });
});

export const handlers = [realtimeHandler];
