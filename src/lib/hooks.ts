import { useEffect, useState } from 'react';

/** Relógio reativo — re-renderiza a cada `intervalMs` (status de pedido, contadores). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Contagem regressiva em segundos; `restart` reinicia (ex.: reenviar código). */
export function useCountdown(initialSeconds: number) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);
  return { secondsLeft, restart: () => setSecondsLeft(initialSeconds) };
}
