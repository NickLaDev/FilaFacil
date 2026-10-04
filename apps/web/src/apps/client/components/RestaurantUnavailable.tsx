import { isApiError } from '@/lib/api/client';
import { ErrorBlock } from '@/components/ui/QueryState';

interface Props {
  error: unknown;
  onRetry: () => void;
  onExplore: () => void;
}

/**
 * Restaurante inativo/suspenso responde 404 para o cliente (ficha 34): em vez de um erro técnico,
 * a tela explica que ele não está disponível e sugere outros.
 */
export default function RestaurantUnavailable({ error, onRetry, onExplore }: Props) {
  const unavailable = isApiError(error) && error.status === 404;
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-8 text-center">
      {unavailable ? (
        <>
          <p className="font-display font-bold text-foreground text-lg">Restaurante indisponível</p>
          <p className="text-sm text-muted-foreground">Este estabelecimento não está aceitando clientes pelo app no momento.</p>
        </>
      ) : (
        <ErrorBlock error={error} onRetry={onRetry} />
      )}
      <button onClick={onExplore} className="bg-primary text-primary-foreground font-display font-semibold px-6 py-3 rounded-xl text-sm">
        Ver outros restaurantes
      </button>
    </div>
  );
}
