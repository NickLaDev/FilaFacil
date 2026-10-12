import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { formatPhone, isValidPhone, onlyDigits } from '@/lib/validation';
import { cancelReservation, reserveTable } from '@/services/reservationService';
import type { MyReservationStateDto } from '@filafacil/shared';

const MAX_PARTY = 50;

interface Props {
  restaurantId: string;
  restaurantName: string;
  state: MyReservationStateDto;
  notify: (message: string) => void;
  onClose: () => void;
}

/** Ficha 12: "Reservar" — entra na fila de espera do restaurante e acompanha a posição. */
export default function ReservationSheet({ restaurantId, restaurantName, state, notify, onClose }: Props) {
  const { run, pending } = useAsyncAction(notify);
  const [partySize, setPartySize] = useState(2);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const { reservation, hasPhone } = state;

  async function confirm() {
    if (!hasPhone && !isValidPhone(onlyDigits(phone))) {
      setPhoneError('Informe um celular válido com DDD.');
      return;
    }
    setPhoneError('');
    await run(() => reserveTable(restaurantId, { partySize, ...(hasPhone ? {} : { phone: onlyDigits(phone) }) }), 'Reserva confirmada');
  }

  async function cancel() {
    const done = await run(async () => {
      await cancelReservation(restaurantId);
      return true;
    }, 'Reserva cancelada');
    if (done) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="Reservar mesa">
      <div className="w-full max-w-[390px] bg-card rounded-t-2xl p-5 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display font-bold text-foreground">{reservation ? 'Sua reserva' : 'Reservar mesa'}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{restaurantName}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-1.5 -mr-1.5 hover:bg-muted rounded-lg">
            <X size={18} />
          </button>
        </div>

        {reservation ? (
          <>
            <div className="bg-muted rounded-xl p-4 flex flex-col gap-1" data-testid="reservation-status">
              <p className="text-sm font-medium text-foreground">
                {reservation.status === 'notified'
                  ? `Sua mesa está pronta${reservation.notifiedTableLabel ? ` (${reservation.notifiedTableLabel})` : ''}! Procure a recepção.`
                  : `Você está na fila — posição ${reservation.position}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {reservation.partySize} {reservation.partySize === 1 ? 'pessoa' : 'pessoas'}
                {reservation.status === 'waiting' && reservation.estimatedWaitMinutes !== null
                  ? reservation.estimatedWaitMinutes === 0
                    ? ' · mesa disponível'
                    : ` · espera estimada ~${reservation.estimatedWaitMinutes} min`
                  : ''}
              </p>
            </div>
            <button onClick={() => void cancel()} disabled={pending} className="w-full border border-border text-foreground font-medium py-3 rounded-xl text-sm disabled:opacity-60">
              {pending ? 'Cancelando…' : 'Cancelar reserva'}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground" id="party-label">Quantas pessoas?</span>
              <div className="flex items-center gap-3" role="group" aria-labelledby="party-label">
                <button onClick={() => setPartySize(size => Math.max(1, size - 1))} disabled={partySize <= 1} aria-label="Menos uma pessoa" className="w-9 h-9 rounded-full border border-border flex items-center justify-center disabled:opacity-40">
                  <Minus size={14} />
                </button>
                <span className="font-display font-bold w-6 text-center" data-testid="party-size">{partySize}</span>
                <button onClick={() => setPartySize(size => Math.min(MAX_PARTY, size + 1))} disabled={partySize >= MAX_PARTY} aria-label="Mais uma pessoa" className="w-9 h-9 rounded-full border border-border flex items-center justify-center disabled:opacity-40">
                  <Plus size={14} />
                </button>
              </div>
            </div>
            {!hasPhone && (
              <div>
                <label htmlFor="reservation-phone" className="text-sm text-foreground">Celular para o aviso de mesa pronta</label>
                <input
                  id="reservation-phone"
                  inputMode="tel"
                  autoComplete="tel"
                  value={formatPhone(phone)}
                  onChange={event => setPhone(event.target.value)}
                  placeholder="(11) 91234-5678"
                  className="mt-1 w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm"
                />
                {phoneError && <p role="alert" className="text-xs text-destructive mt-1">{phoneError}</p>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">Você entra na fila de espera do restaurante e é avisado quando a mesa estiver pronta.</p>
            <button onClick={() => void confirm()} disabled={pending} className="w-full bg-primary text-primary-foreground font-display font-semibold py-3.5 rounded-xl disabled:opacity-60">
              {pending ? 'Reservando…' : 'Confirmar reserva'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
