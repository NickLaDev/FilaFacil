import { AlertTriangle, X } from 'lucide-react';
import type { StaffAlertDto } from '@filafacil/shared';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { dismissAlert, retryTabRefund, useAlerts } from '@/services/operationsService';

/** Alertas in-app (impressora offline, estoque baixo) em tempo real; sem SMS nem e-mail (fichas 26 e 50). */
export default function AlertsBanner({ establishmentId, notify, canManageTabs = true }: { establishmentId: string; notify: (message: string) => void; canManageTabs?: boolean }) {
  const { data } = useAlerts(establishmentId);
  const { run, pending } = useAsyncAction(notify);
  if (!data || data.length === 0) return null;
  return (
    <div role="region" aria-label="Alertas" className="px-6 py-2 flex flex-col gap-1.5 border-b border-border bg-warning-bg flex-shrink-0">
      {data.map((alert: StaffAlertDto) => (
        <div key={alert.id} role="alert" data-alert-kind={alert.kind} className="flex items-center gap-2 text-sm text-warning font-medium">
          <AlertTriangle size={14} />
          <span className="flex-1">{alert.message}</span>
          {alert.kind === 'tab_refund_pending' && alert.tabId && canManageTabs && (
            <button
              disabled={pending}
              onClick={() => void run(() => retryTabRefund(establishmentId, alert.tabId as string), result => (result.stillPending > 0 ? 'Estorno ainda em verificação' : 'Estorno concluído'))}
              className="text-xs font-semibold border border-warning/40 rounded-lg px-2 py-1 disabled:opacity-50"
            >
              Tentar estorno de novo
            </button>
          )}
          {/* Estorno pendente não pode ser dispensado (409 ALERT_NOT_DISMISSIBLE): some quando o estorno é concluído. */}
          {alert.kind !== 'tab_refund_pending' && (
            <button disabled={pending} onClick={() => void run(() => dismissAlert(establishmentId, alert.id))} aria-label={`Dispensar alerta: ${alert.message}`} className="p-1 rounded hover:bg-black/5 disabled:opacity-50">
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
