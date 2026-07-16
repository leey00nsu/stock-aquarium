import { searchDomesticStocks } from '@/server/kis/stocks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 50);

  try {
    const result = await searchDomesticStocks(query, Number.isFinite(limit) ? limit : 50);
    return Response.json(result, {
      headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' },
    });
  } catch {
    return Response.json(
      { message: '종목 목록을 불러오지 못했습니다.' },
      { status: 503 },
    );
  }
}
