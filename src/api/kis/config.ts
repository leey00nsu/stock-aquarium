export const KIS_STREAM_PATH = '/api/kis/stream';

export function getKisStreamUrl(symbol: string) {
  const configured = process.env.NEXT_PUBLIC_KIS_STREAM_URL?.trim() || KIS_STREAM_PATH;
  const separator = configured.includes('?') ? '&' : '?';
  return `${configured}${separator}symbol=${encodeURIComponent(symbol)}`;
}
