import { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { BOOKING_STATUS_LABELS, type BookingDto, type BookingStatus } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTimeIn } from '@/lib/utils';
import { cancelStaffBooking, seatStaffBooking, useStaffBookings } from '@/services/sprint4StaffService';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';

const STATUS_STYLE: Record<BookingStatus, string> = {
  confirmed: 'bg-success-bg text-success',
  seated: 'bg-muted text-muted-foreground',
  cancelled: 'bg-warning-bg text-warning',
  refused: 'bg-error-bg text-error',
};

/** Ficha 30: reservas de mesa feitas pelos clientes — confirmadas ou recusadas na hora conforme a disponibilidade. */
export default function BookingsSection({ unit, notify }: ManagerSectionProps) {
  const [date, setDate] = useState('');
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const query = useStaffBookings(unit.id, { date: date || undefined, status: status || undefined });
  const { run } = useAsyncAction(notify);
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);

  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const bookings = query.data;

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label htmlFor="bookings-date" className="text-xs text-muted-foreground font-medium block mb-1">Data</label>
          <input id="bookings-date" type="date" value={date} onChange={event => setDate(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
        <div>
          <label htmlFor="bookings-status" className="text-xs text-muted-foreground font-medium block mb-1">Status</label>
          <select id="bookings-status" value={status} onChange={event => setStatus(event.target.value as BookingStatus | '')} className="border border-border rounded-xl px-3 py-2 text-sm bg-card">
            <option value="">Todos</option>
            {(Object.keys(BOOKING_STATUS_LABELS) as BookingStatus[]).map(option => <option key={option} value={option}>{BOOKING_STATUS_LABELS[option]}</option>)}
          </select>
        </div>
        {date && <button onClick={() => setDate('')} className="text-xs text-primary font-medium pb-2.5">Ver a partir de hoje</button>}
        <p className="text-sm text-muted-foreground ml-auto pb-2">{date ? 'Reservas da data escolhida' : 'Reservas a partir de hoje'} · atualizado em tempo real</p>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState icon={CalendarCheck} title="Nenhuma reserva" description="As reservas feitas pelos clientes pelo app aparecem aqui assim que são confirmadas." />
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Horário</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Pessoas</th>
                <th className="px-4 py-3">Mesa</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(booking => (
                <tr key={booking.id} data-testid="booking-row" data-status={booking.status} className="border-t border-border">
                  <td className="px-4 py-3 text-sm text-foreground">{formatDateTimeIn(booking.startsAt, booking.timezone)}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{booking.customerName}{booking.customerPhone && <span className="block text-xs text-muted-foreground">{booking.customerPhone}</span>}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{booking.partySize}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{booking.tableLabel ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span data-testid="booking-status" className={cn('text-xs font-bold px-2.5 py-1 rounded-full', STATUS_STYLE[booking.status])}>{BOOKING_STATUS_LABELS[booking.status]}</span>
                    {booking.refusalReason && <p className="text-[11px] text-muted-foreground mt-1">{booking.refusalReason}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {booking.status === 'confirmed' && (
                      <div className="flex gap-2">
                        <button onClick={() => void run(() => seatStaffBooking(unit.id, booking.id), 'Cliente acomodado')} className="text-xs font-semibold text-success border border-success/30 rounded-lg px-2.5 py-1">Cliente chegou</button>
                        <button onClick={() => setCancelling(booking)} className="text-xs font-semibold text-error border border-error/30 rounded-lg px-2.5 py-1">Cancelar</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancelar reserva"
          message={`A reserva de ${cancelling.customerName ?? 'cliente'} (${formatDateTimeIn(cancelling.startsAt, cancelling.timezone)}) será cancelada e o cliente será avisado.`}
          confirmLabel="Cancelar reserva"
          onConfirm={() => run(() => cancelStaffBooking(unit.id, cancelling.id), 'Reserva cancelada')}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}
