'use client';

import { useEffect, useId, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import type { StockOption } from '@/types/market';

interface StockSearchResponse {
  items: StockOption[];
}

interface StockPickerProps {
  value: StockOption;
  onValueChange: (stock: StockOption) => void;
}

export function StockPicker({ value, onValueChange }: StockPickerProps) {
  const listboxId = useId();
  const selectedLabel = `${value.name} · ${value.symbol}`;
  const [inputValue, setInputValue] = useState(selectedLabel);
  const [results, setResults] = useState<StockOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/stocks?q=${encodeURIComponent(inputValue)}&limit=50`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('stock search failed');
        const body = (await response.json()) as StockSearchResponse;
        setResults(body.items);
        setActiveIndex(body.items.length > 0 ? 0 : -1);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inputValue, open]);

  const selectStock = (stock: StockOption) => {
    setInputValue(`${stock.name} · ${stock.symbol}`);
    setOpen(false);
    setActiveIndex(-1);
    onValueChange(stock);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-icon" />
        <input
          type="text"
          role="combobox"
          aria-label="종목명 또는 종목코드 검색"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          value={inputValue}
          placeholder="종목명 또는 종목코드 검색"
          className="h-9 w-full rounded-md border border-input bg-background/60 py-2 pl-9 pr-9 text-sm text-foreground shadow-sm backdrop-blur-xl outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
          onFocus={() => {
            setInputValue('');
            setOpen(true);
          }}
          onChange={(event) => {
            setInputValue(event.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setOpen(false);
              setInputValue(selectedLabel);
            }, 100);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(results.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && activeIndex >= 0) {
              event.preventDefault();
              selectStock(results[activeIndex]);
            } else if (event.key === 'Escape') {
              setOpen(false);
              setInputValue(selectedLabel);
            }
          }}
        />
        {loading && (
          <LoaderCircle className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-icon" />
        )}
      </div>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 top-[calc(100%+.375rem)] z-50 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          onMouseDown={(event) => event.preventDefault()}
        >
          {!loading && results.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">검색 결과가 없습니다.</p>
          )}
          {results.map((stock, index) => (
            <button
              id={`${listboxId}-${index}`}
              key={stock.symbol}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm outline-none hover:bg-accent aria-selected:bg-accent"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectStock(stock)}
            >
              <span className="truncate font-medium">{stock.name}</span>
              <span className="ml-3 shrink-0 tabular-nums text-muted-foreground">{stock.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
