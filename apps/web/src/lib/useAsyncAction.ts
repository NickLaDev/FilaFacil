import { useCallback, useState } from 'react';
import { errorMessage } from './api/client';

/**
 * Executa uma ação da API com estado de envio e feedback: sucesso e erro viram toast.
 * Devolve `undefined` quando a ação falha (a tela decide se mantém o formulário aberto).
 */
export function useAsyncAction(notify: (message: string) => void) {
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string | ((result: T) => string)): Promise<T | undefined> => {
      setPending(true);
      try {
        const result = await action();
        if (success) notify(typeof success === 'function' ? success(result) : success);
        return result;
      } catch (error) {
        notify(errorMessage(error));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [notify],
  );

  return { run, pending };
}
