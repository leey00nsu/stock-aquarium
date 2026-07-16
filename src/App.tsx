import { useMemo, useState } from 'react';
import { Activity, Database, Eye, EyeOff, Fish, Snowflake, Waves } from 'lucide-react';
import { AquariumScene } from '@/components/aquarium/AquariumScene';
import { Pill } from '@/components/kibo-ui/pill';
import { Status, StatusIndicator, StatusLabel } from '@/components/kibo-ui/status';
import { Ticker, TickerChange, TickerPrice, TickerSymbol } from '@/components/kibo-ui/ticker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMarketFeed } from '@/hooks/use-market-feed';
import { formatCompact, formatNumber } from '@/lib/utils';
import { useMarketStore } from '@/store/market-store';
import type { StockOption } from '@/types/market';

const stockOptions: StockOption[] = [
  { symbol: '005930', name: '삼성전자' },
  { symbol: '000660', name: 'SK하이닉스' },
  { symbol: '035420', name: 'NAVER' },
  { symbol: '035720', name: '카카오' },
];

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-background/60 px-3 py-2.5 backdrop-blur-md">
      <span className="grid h-8 w-8 place-items-center rounded-md border text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [symbol, setSymbol] = useState('005930');
  const [uiVisible, setUiVisible] = useState(true);
  useMarketFeed(symbol);

  const snapshot = useMarketStore((state) => state.snapshot);
  const connected = useMarketStore((state) => state.connected);
  const error = useMarketStore((state) => state.error);
  const selected = useMemo(
    () => stockOptions.find((option) => option.symbol === symbol) ?? stockOptions[0],
    [symbol],
  );

  const changeTrend = !snapshot || snapshot.changeRate === 0 ? 'flat' : snapshot.changeRate > 0 ? 'up' : 'down';
  const orderBalance = snapshot
    ? snapshot.bidTotal + snapshot.askTotal > 0
      ? (snapshot.bidTotal / (snapshot.bidTotal + snapshot.askTotal)) * 100
      : 50
    : 50;
  const volatilityLevel = snapshot
    ? snapshot.volatility > 0.95
      ? '폭풍'
      : snapshot.volatility > 0.45
        ? '주의'
        : '안정'
    : '-';

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        <AquariumScene />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,transparent_0%,rgba(0,0,0,.08)_58%,rgba(0,0,0,.48)_100%)]" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 md:p-6">
        {uiVisible && <Ticker className="pointer-events-auto w-full max-w-[520px]">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
            <Fish className="h-5 w-5" />
          </div>
          <TickerSymbol>
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold">{snapshot?.name ?? selected.name}</p>
              <Pill>{symbol}</Pill>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">KIS Stock Aquarium</p>
          </TickerSymbol>
          <TickerPrice>
            <p className="text-lg font-bold tracking-tight">
              {snapshot ? `${formatNumber(snapshot.price)}원` : '—'}
            </p>
            <TickerChange trend={changeTrend}>
              {snapshot
                ? `${snapshot.change >= 0 ? '+' : ''}${formatNumber(snapshot.change)} (${snapshot.changeRate >= 0 ? '+' : ''}${snapshot.changeRate.toFixed(2)}%)`
                : '연결 중'}
            </TickerChange>
          </TickerPrice>
        </Ticker>}

        <div className="pointer-events-auto ml-auto hidden items-start gap-2 md:flex">
          <button
            type="button"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border bg-card/80 text-card-foreground shadow-sm backdrop-blur-xl transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-label={uiVisible ? 'UI 숨기기' : 'UI 보이기'}
            title={uiVisible ? 'UI 숨기기' : 'UI 보이기'}
            aria-pressed={!uiVisible}
            onClick={() => setUiVisible((visible) => !visible)}
          >
            {uiVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          {uiVisible && <Card className="w-[230px]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">종목 선택</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stockOptions.map((option) => (
                    <SelectItem key={option.symbol} value={option.symbol}>
                      {option.name} · {option.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>}
        </div>
      </header>

      {uiVisible && <aside className="pointer-events-none absolute bottom-4 left-4 z-20 w-[min(320px,calc(100%-2rem))] md:bottom-6 md:left-6">
        <Card className="pointer-events-auto animate-slide-up">
          <CardHeader className="flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-sm">현황</CardTitle>
            </div>
            <Status>
              <StatusIndicator tone={snapshot?.halted ? 'maintenance' : connected ? 'online' : error ? 'offline' : 'degraded'} />
              <StatusLabel>
                {snapshot?.halted
                  ? '거래정지'
                  : connected
                    ? '실시간'
                    : error
                      ? '오류'
                      : '연결 중'}
              </StatusLabel>
            </Status>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Metric label="거래량 해류" value={`${(snapshot?.volumeIntensity ?? 0).toFixed(2)}×`} icon={<Waves className="h-4 w-4" />} />
              <Metric label="변동성" value={volatilityLevel} icon={<Activity className="h-4 w-4" />} />
              <Metric label="누적 거래량" value={snapshot ? formatCompact(snapshot.accumulatedVolume) : '—'} icon={<Database className="h-4 w-4" />} />
              <Metric label="체결강도" value={snapshot ? snapshot.tradeStrength.toFixed(1) : '—'} icon={<Fish className="h-4 w-4" />} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                <span>매도 잔량</span>
                <span>매수 잔량</span>
              </div>
              <div className="flex h-2 overflow-hidden rounded-full bg-red-500/70">
                <div className="bg-emerald-500 transition-[width] duration-500" style={{ width: `${orderBalance}%` }} />
              </div>
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-emerald-500" />매수 체결 →</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-red-500" />← 매도 체결</span>
            </div>
          </CardContent>
        </Card>
      </aside>}

      {uiVisible && <div className="pointer-events-none absolute bottom-4 right-4 z-20 hidden text-right md:bottom-6 md:right-6 md:block">
        <Pill>드래그 회전 · 휠 확대</Pill>
      </div>}

      <div className="pointer-events-auto absolute right-4 top-[104px] z-20 flex items-center gap-2 md:hidden">
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border bg-card/80 text-card-foreground shadow-sm backdrop-blur-xl"
          aria-label={uiVisible ? 'UI 숨기기' : 'UI 보이기'}
          title={uiVisible ? 'UI 숨기기' : 'UI 보이기'}
          aria-pressed={!uiVisible}
          onClick={() => setUiVisible((visible) => !visible)}
        >
          {uiVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
        {uiVisible && <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {stockOptions.map((option) => (
              <SelectItem key={option.symbol} value={option.symbol}>
                {option.name} · {option.symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>}
      </div>

      {uiVisible && error && (
        <Card className="absolute left-1/2 top-24 z-30 -translate-x-1/2 px-4 py-2 text-xs text-destructive">
          {error}
        </Card>
      )}

      {uiVisible && snapshot?.halted && (
        <div className="ice-overlay pointer-events-none absolute inset-0 z-30 grid place-items-center">
          <Card className="px-6 py-4 text-center">
            <Snowflake className="mx-auto mb-2 h-7 w-7" />
            <p className="text-lg font-bold">거래정지</p>
            <p className="mt-1 text-xs text-muted-foreground">시장 데이터가 재개될 때까지 물고기가 멈춥니다.</p>
          </Card>
        </div>
      )}
    </main>
  );
}
