import { useEffect } from 'react';
import { connectKisMarketStream } from '@/api/kis/client';
import { useMarketStore } from '@/store/market-store';
import type { StockOption } from '@/types/market';

export function useMarketFeed(stock: StockOption) {
  const ingest = useMarketStore((state) => state.ingest);
  const setError = useMarketStore((state) => state.setError);
  const setConnected = useMarketStore((state) => state.setConnected);
  const resetFeed = useMarketStore((state) => state.resetFeed);

  useEffect(() => {
    let active = true;

    resetFeed();

    const connection = connectKisMarketStream({
      stock,
      onOpen: () => {
        if (!active) return;
        setConnected(true);
        setError(null);
      },
      onSnapshot: (snapshot) => {
        if (active) ingest(snapshot);
      },
      onError: (message) => {
        if (!active) return;
        setConnected(false);
        setError(message);
      },
    });

    return () => {
      active = false;
      connection.close();
    };
  }, [ingest, resetFeed, setConnected, setError, stock]);
}
