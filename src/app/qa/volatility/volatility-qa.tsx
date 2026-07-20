'use client';

import { useState } from 'react';
import { CloudLightning, RotateCcw } from 'lucide-react';
import { AquariumScene } from '@/components/aquarium/AquariumScene';
import { cn } from '@/lib/utils';

const PRESETS = [
  { label: '안정', value: 0.2 },
  { label: '주의', value: 0.7 },
  { label: '폭풍', value: 1.05 },
  { label: '극한', value: 1.5 },
] as const;

function getLevel(volatility: number) {
  if (volatility > 0.95) return '폭풍';
  if (volatility > 0.45) return '주의';
  return '안정';
}

export function VolatilityQa() {
  const [volatility, setVolatility] = useState(0.2);
  const [lightningTrigger, setLightningTrigger] = useState(0);
  const level = getLevel(volatility);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        <AquariumScene stormPreview={{ volatility, lightningTrigger }} />
      </div>

      <section className="absolute left-4 top-4 z-10 w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-white/15 bg-black/85 p-4 shadow-2xl backdrop-blur-xl sm:left-6 sm:top-6 sm:p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Development QA</p>
            <h1 className="mt-1 text-xl font-semibold text-white">변동성 효과 미리보기</h1>
          </div>
          <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm font-semibold text-white">
            {level} · {volatility.toFixed(2)}
          </span>
        </div>

        <div className="grid grid-cols-4 gap-2" aria-label="변동성 프리셋">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setVolatility(preset.value)}
              className={cn(
                'rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
                volatility === preset.value
                  ? 'border-white bg-white text-black'
                  : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <label className="mt-5 block">
          <span className="mb-2 flex items-center justify-between text-sm text-white/65">
            <span>변동성 직접 조절</span>
            <span className="font-mono text-white">{volatility.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={volatility}
            onChange={(event) => setVolatility(Number(event.target.value))}
            className="h-2 w-full cursor-pointer accent-white"
          />
          <span className="mt-1 flex justify-between text-xs text-white/35">
            <span>0.00</span>
            <span>0.45 주의</span>
            <span>0.95 폭풍</span>
            <span>1.50</span>
          </span>
        </label>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setVolatility((value) => Math.max(value, 1.05));
              setLightningTrigger((value) => value + 1);
            }}
            className="flex items-center justify-center gap-2 rounded-lg bg-sky-300 px-3 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-sky-200"
          >
            <CloudLightning className="h-4 w-4" />
            번개 실행
          </button>
          <button
            type="button"
            onClick={() => setVolatility(0.2)}
            className="flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-4 w-4" />
            초기화
          </button>
        </div>
      </section>
    </main>
  );
}
