import { useState } from 'react';
import { Bell } from 'lucide-react';
import { cn, formatDateTime } from '@/lib/utils';
import { markStaffNotificationsRead, useStaffNotifications } from '@/services/sprint4StaffService';

/** Avisos da casa (resposta do suporte, fatura em atraso, validade…), em tempo real; lidos ao abrir a lista. */
export default function NotificationsBell({ establishmentId, onOpen }: { establishmentId: string; onOpen?: (kind: string) => void }) {
  const query = useStaffNotifications(establishmentId);
  const [open, setOpen] = useState(false);
  const data = query.data;
  const unread = data?.unread ?? 0;

  return (
    <div className="relative">
      <button onClick={() => setOpen(value => !value)} aria-label={unread ? `Notificações (${unread} não lidas)` : 'Notificações'} aria-expanded={open} data-testid="notifications-bell" className="relative p-2.5 border border-border rounded-xl bg-muted hover:bg-muted/70">
        <Bell size={15} className="text-muted-foreground" />
        {unread > 0 && <span data-testid="notifications-unread" className="absolute -top-1.5 -right-1.5 min-w-4 h-4 px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">{unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notificações" className="absolute right-0 mt-2 w-96 max-w-[90vw] bg-card border border-border rounded-xl shadow-xl z-40 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="font-display font-semibold text-sm text-foreground">Notificações</p>
            {unread > 0 && <button onClick={() => void markStaffNotificationsRead(establishmentId)} className="text-xs text-primary font-medium">Marcar todas como lidas</button>}
          </div>
          {!data || data.items.length === 0 ? (
            <p data-testid="staff-notifications-empty" className="text-sm text-muted-foreground text-center py-8">Nenhuma notificação.</p>
          ) : (
            <ul>
              {data.items.map(notification => (
                <li key={notification.id}>
                  <button
                    data-testid="staff-notification"
                    data-kind={notification.kind}
                    onClick={() => {
                      void markStaffNotificationsRead(establishmentId, [notification.id]);
                      setOpen(false);
                      onOpen?.(notification.kind);
                    }}
                    className={cn('w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-muted/50', !notification.read && 'bg-primary/5')}
                  >
                    <p className="text-sm font-medium text-foreground">{notification.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{notification.body}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">{formatDateTime(notification.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
