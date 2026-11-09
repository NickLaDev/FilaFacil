import { useState, type FormEvent } from 'react';
import { Activity, AlertOctagon, CheckCircle2, KeyRound, Plus, Trash2 } from 'lucide-react';
import { INTEGRATION_KIND_LABELS, INTEGRATION_KINDS, type IntegrationCreatedDto, type IntegrationDto, type IntegrationKind } from '@filafacil/shared';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { useAllEstablishments } from '@/services/establishmentService';
import { createIntegration, deleteIntegration, rotateIntegrationKey, useIncidentHistory, useMonitoring } from '@/services/sprint4StaffService';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import { Pill } from '../components/Pills';

const duration = (seconds: number) => (seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min` : `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`);
const STATUS: Record<IntegrationDto['status'], { label: string; className: string }> = {
  online: { label: 'Online', className: 'bg-success/10 text-success' },
  offline: { label: 'Fora do ar', className: 'bg-error/10 text-error' },
  unknown: { label: 'Sem sinal ainda', className: 'bg-muted text-muted-foreground' },
};

/** Ficha 33: integrações em tempo real, incidente ativo com a contagem de estabelecimentos impactados e histórico de auditoria. */
export default function MonitoringSection({ notify }: { notify: (message: string) => void }) {
  const overview = useMonitoring();
  const [page, setPage] = useState(1);
  const history = useIncidentHistory(page);
  const { run } = useAsyncAction(notify);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<IntegrationCreatedDto | null>(null);
  const [removing, setRemoving] = useState<IntegrationDto | null>(null);

  if (overview.error && !overview.data) return <ErrorBlock error={overview.error} onRetry={() => void overview.refetch()} />;
  if (!overview.data) return <LoadingBlock />;
  const data = overview.data;

  return (
    <div className="p-6 flex flex-col gap-5 max-w-6xl">
      {data.activeIncidents.length > 0 ? (
        <div role="alert" data-testid="incident-banner" className="bg-error-bg border border-error/30 rounded-xl p-4 flex flex-col gap-2">
          <p className="flex items-center gap-2 font-display font-bold text-error"><AlertOctagon size={16} />Incidente ativo · <span data-testid="impacted-count">{data.impactedEstablishments}</span> {data.impactedEstablishments === 1 ? 'estabelecimento impactado' : 'estabelecimentos impactados'}</p>
          <ul className="flex flex-col gap-1">
            {data.activeIncidents.map(incident => (
              <li key={incident.id} data-testid="active-incident" className="text-sm text-error">
                <strong>{incident.integrationName}</strong> ({INTEGRATION_KIND_LABELS[incident.integrationKind]}) · {incident.establishmentName} · {incident.message} · há {duration(incident.durationSeconds)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p data-testid="all-clear" className="flex items-center gap-2 text-sm text-success bg-success-bg border border-success/20 rounded-xl px-4 py-3"><CheckCircle2 size={15} />Nenhum incidente ativo. Todas as integrações monitoradas estão respondendo.</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Cada integração envia sinal com a própria chave. Sem sinal por 30 s ou com falha informada, abre um incidente automaticamente.</p>
        <button onClick={() => setCreating(true)} data-testid="add-integration" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium flex-shrink-0"><Plus size={15} />Nova integração</button>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Integração</th><th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Último sinal</th><th className="px-4 py-3">Ações</th></tr></thead>
          <tbody>
            {data.integrations.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground"><Activity size={16} className="inline mr-2" />Nenhuma integração cadastrada.</td></tr>}
            {data.integrations.map(integration => (
              <tr key={integration.id} data-testid="integration-row" data-status={integration.status} className="border-t border-border text-sm">
                <td className="px-4 py-3 font-medium text-foreground">{integration.name} <span className="text-xs text-muted-foreground">· {INTEGRATION_KIND_LABELS[integration.kind]}</span></td>
                <td className="px-4 py-3 text-muted-foreground">{integration.establishmentName}</td>
                <td className="px-4 py-3"><Pill className={STATUS[integration.status].className}>{STATUS[integration.status].label}</Pill></td>
                <td className="px-4 py-3 text-muted-foreground">{integration.lastSeenAt ? formatDateTime(integration.lastSeenAt) : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => void run(() => rotateIntegrationKey(integration.id).then(setCreated))} title="Gerar nova chave" aria-label={`Gerar nova chave de ${integration.name}`} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground"><KeyRound size={14} /></button>
                    <button onClick={() => setRemoving(integration)} aria-label={`Remover ${integration.name}`} className="p-1.5 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Histórico de incidentes (auditoria — não pode ser apagado)</p>
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Início</th><th className="px-4 py-3">Integração</th><th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Causa</th><th className="px-4 py-3">Duração</th><th className="px-4 py-3">Situação</th></tr></thead>
            <tbody>
              {history.data?.items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum incidente registrado.</td></tr>}
              {history.data?.items.map(incident => (
                <tr key={incident.id} data-testid="incident-row" className="border-t border-border text-sm">
                  <td className="px-4 py-3">{formatDateTime(incident.startedAt)}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{incident.integrationName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{incident.establishmentName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{incident.cause === 'reported' ? 'Falha informada' : 'Sem sinal'}</td>
                  <td className="px-4 py-3 text-muted-foreground">{duration(incident.durationSeconds)}</td>
                  <td className="px-4 py-3"><Pill className={incident.resolvedAt ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}>{incident.resolvedAt ? 'Resolvido' : 'Ativo'}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data && <Pagination page={page} pageSize={history.data.pageSize} total={history.data.total} onChange={setPage} />}
        </div>
      </div>

      {creating && <IntegrationModal notify={notify} onClose={() => setCreating(false)} onCreated={setCreated} />}
      {created && (
        <Modal title="Chave da integração" onClose={() => setCreated(null)} width="md">
          <p className="text-sm text-muted-foreground mb-3">Guarde a chave de <strong>{created.name}</strong> agora: ela é mostrada uma única vez. O dispositivo envia <code>POST /api/integrations/heartbeat</code> com o cabeçalho <code>X-Integration-Key</code> a cada 15 s.</p>
          <p data-testid="device-key" className="font-mono text-xs bg-muted rounded-lg px-3 py-3 break-all select-all">{created.deviceKey}</p>
          <button onClick={() => setCreated(null)} className="w-full mt-4 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold">Já guardei a chave</button>
        </Modal>
      )}
      {removing && <ConfirmDialog title="Remover integração" tone="danger" description={`Remove ${removing.name}. Integrações com histórico de incidentes não podem ser removidas (o histórico é mantido para auditoria).`} confirmLabel="Remover" onConfirm={() => void run(() => deleteIntegration(removing.id), 'Integração removida').then(() => setRemoving(null))} onClose={() => setRemoving(null)} />}
    </div>
  );
}

function IntegrationModal({ notify, onClose, onCreated }: { notify: (message: string) => void; onClose: () => void; onCreated: (created: IntegrationCreatedDto) => void }) {
  const establishments = useAllEstablishments().data ?? [];
  const { run, pending } = useAsyncAction(notify);
  const [establishmentId, setEstablishmentId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<IntegrationKind>('pdv');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!establishmentId) next.establishment = 'Escolha o estabelecimento.';
    if (name.trim().length < 2) next.name = 'Informe o nome (ex.: PDV Caixa 1).';
    setErrors(next);
    if (Object.keys(next).length) return;
    const result = await run(() => createIntegration({ establishmentId, name: name.trim(), kind }));
    if (result) {
      onCreated(result);
      onClose();
    }
  }

  return (
    <Modal title="Nova integração" onClose={onClose}>
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Estabelecimento" htmlFor="integration-establishment" error={errors.establishment}>
          <select id="integration-establishment" value={establishmentId} onChange={event => setEstablishmentId(event.target.value)} className={PANEL_INPUT_CLASS}>
            <option value="">Escolha…</option>
            {establishments.map(establishment => <option key={establishment.id} value={establishment.id}>{establishment.name}</option>)}
          </select>
        </FormField>
        <FormField label="Nome" htmlFor="integration-name" error={errors.name}><input id="integration-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} className={PANEL_INPUT_CLASS} /></FormField>
        <FormField label="Tipo" htmlFor="integration-kind"><select id="integration-kind" value={kind} onChange={event => setKind(event.target.value as IntegrationKind)} className={PANEL_INPUT_CLASS}>{INTEGRATION_KINDS.map(option => <option key={option} value={option}>{INTEGRATION_KIND_LABELS[option]}</option>)}</select></FormField>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={pending} className={cn('flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60')}>{pending ? 'Criando…' : 'Criar'}</button>
        </div>
      </form>
    </Modal>
  );
}
