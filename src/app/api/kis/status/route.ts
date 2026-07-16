import { getKisRealtimeStatus } from '@/server/kis/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(getKisRealtimeStatus(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
