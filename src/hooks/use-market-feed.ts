import { useEffect } from 'react';
import { connectKisMarketSocket, type KisMarketSocket } from '@/api/kis/client';
import { useMarketStore } from '@/store/market-store';

export function useMarketFeed(symbol: string) {
  const ingest = useMarketStore((state) => state.ingest);
  const setError = useMarketStore((state) => state.setError);
  const setConnected = useMarketStore((state) => state.setConnected);
  const resetFeed = useMarketStore((state) => state.resetFeed);

  useEffect(() => {
    let active = true;
    let reconnectTimer: number | undefined;
    let connection: KisMarketSocket | undefined;

    resetFeed();

    const connect = () => {
      if (!active) return;
      connection = connectKisMarketSocket({
        symbol,
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
        onClose: () => {
          if (!active) return;
          setConnected(false);
          reconnectTimer = window.setTimeout(connect, 1500);
        },
      });
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      connection?.close();
    };
  }, [ingest, resetFeed, setConnected, setError, symbol]);
}
