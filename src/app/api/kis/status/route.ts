import { timingSafeEqual } from 'node:crypto';
import { getKisRealtimeStatus } from '@/server/kis/realtime';
import { getSseLimitStatus } from '@/server/security/sse-limiter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function hasValidStatusToken(request: Request) {
  const expected = process.env.KIS_STATUS_TOKEN?.trim();
  const authorization = request.headers.get('authorization');
  const provided = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!expected || !provided) return false;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function GET(request: Request) {
  if (!hasValidStatusToken(request)) {
    return Response.json(
      { message: 'Not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json({ ...getKisRealtimeStatus(), sse: getSseLimitStatus() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
