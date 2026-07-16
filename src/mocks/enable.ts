import { isMockEnabled } from '@/api/kis/config';

export async function enableMocking() {
  if (!isMockEnabled) return;
  const { worker } = await import('./browser');
  await worker.start({
    onUnhandledRequest: 'bypass',
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
}
