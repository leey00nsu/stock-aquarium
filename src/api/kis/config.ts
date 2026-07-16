export const KIS_WS_PATH = '/ws/kis/domestic-stock';

export const isMockEnabled = import.meta.env.VITE_ENABLE_MSW !== 'false';

export function getKisWebSocketUrl() {
  const configured = import.meta.env.VITE_KIS_WS_URL?.trim();
  if (configured) return configured;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${KIS_WS_PATH}`;
}
