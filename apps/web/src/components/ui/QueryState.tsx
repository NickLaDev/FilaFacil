import type { ReactNode } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { errorMessage } from '@/lib/api/client';

/** Carregando: spinner centralizado (mesmo visual em todos os painéis). */
export function LoadingBlock({ label = 'Carregando', className = 'py-16' }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <Loader2 size={24} className="text-primary animate-spin" aria-label={label} />
    </div>
  );
}

/** Falha ao carregar dados da API, com opção de tentar de novo. */
export function ErrorBlock({ error, onRetry, className = 'py-16' }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 px-6 text-center ${className}`}>
      <div className="w-12 h-12 rounded-2xl bg-error-bg flex items-center justify-center">
        <AlertCircle size={22} className="text-error" />
      </div>
      <p className="text-sm text-muted-foreground max-w-xs">{errorMessage(error, 'Não foi possível carregar os dados.')}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-sm font-medium text-primary hover:underline">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

interface QueryStateProps<T> {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
  className?: string;
}

/** Renderiza carregando/erro/conteúdo de uma consulta. */
export function QueryState<T>({ query, children, className }: QueryStateProps<T>) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.error) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} className={className} />;
  return <LoadingBlock className={className} />;
}
