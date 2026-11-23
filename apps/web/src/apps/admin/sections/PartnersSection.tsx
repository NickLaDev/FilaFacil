import { useState } from 'react';
import { Check, FileText, MessageSquare, X } from 'lucide-react';
import { PARTNER_STATUS_LABELS, type PartnerApplicationDto, type PartnerApplicationStatus } from '@filafacil/shared';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { usePlans } from '@/services/planService';
import { approvePartner, partnerDocumentUrl, rejectPartner, requestPartnerInfo, usePartnerApplications } from '@/services/sprint5Service';
import FilterChips from '../components/FilterChips';
import Pagination from '../components/Pagination';
import { Pill } from '../components/Pills';

const STATUS_CLASS: Record<PartnerApplicationStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  needs_info: 'bg-blue-500/10 text-blue-500',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-error/10 text-error',
};
const TYPE_LABELS: Record<string, string> = { bar: 'Bar', restaurant: 'Restaurante', canteen: 'Cantina', snack_bar: 'Lanchonete' };
const cnpj = (digits: string) => digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const phone = (digits: string) => digits.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

/** Ficha 55: fila de novos parceiros com dados e documentos; aprovar, recusar ou pedir mais informações. */
export default function PartnersSection({ notify }: { notify: (message: string) => void }) {
  const [status, setStatus] = useState<PartnerApplicationStatus>('pending');
  const [page, setPage] = useState(1);
  const query = usePartnerApplications(status, page);
  const [selected, setSelected] = useState<PartnerApplicationDto | null>(null);
  const counts = query.data?.counts;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <FilterChips
        label="Status do cadastro"
        value={status}
        onChange={value => { setStatus(value); setPage(1); }}
        options={(Object.keys(PARTNER_STATUS_LABELS) as PartnerApplicationStatus[]).map(id => ({ id, label: PARTNER_STATUS_LABELS[id], count: counts?.[id] }))}
      />
      {query.error && !query.data && <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />}
      {!query.data && !query.error && <LoadingBlock />}
      {query.data && (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">#</th><th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Cidade</th><th className="px-4 py-3">Contato</th><th className="px-4 py-3">Enviado</th><th className="px-4 py-3">Docs</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>
              {query.data.items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum cadastro {PARTNER_STATUS_LABELS[status].toLowerCase()}.</td></tr>}
              {query.data.items.map(application => (
                <tr key={application.id} data-testid="partner-row" onClick={() => setSelected(application)} className="border-t border-border text-sm cursor-pointer hover:bg-muted/40">
                  <td className="px-4 py-2.5 text-muted-foreground">{application.number}</td>
                  <td className="px-4 py-2.5 font-medium text-foreground">{application.businessName} <span className="text-xs text-muted-foreground">· {TYPE_LABELS[application.type]}</span></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{application.city}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{application.contactName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatDateTime(application.createdAt)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{application.documents.length}</td>
                  <td className="px-4 py-2.5"><Pill className={STATUS_CLASS[application.status]}>{PARTNER_STATUS_LABELS[application.status]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage} />
        </div>
      )}
      {selected && <PartnerModal application={selected} notify={notify} onClose={() => setSelected(null)} />}
    </div>
  );
}

type Decision = 'approve' | 'reject' | 'info' | null;

function PartnerModal({ application, notify, onClose }: { application: PartnerApplicationDto; notify: (message: string) => void; onClose: () => void }) {
  const plans = usePlans().data ?? [];
  const { run, pending } = useAsyncAction(notify);
  const [decision, setDecision] = useState<Decision>(null);
  const [planId, setPlanId] = useState('');
  const [message, setMessage] = useState('');
  const open = application.status === 'pending' || application.status === 'needs_info';
  const messageOk = message.trim().length >= 10;

  async function submit() {
    const action =
      decision === 'approve'
        ? () => approvePartner(application.id, planId)
        : decision === 'reject'
          ? () => rejectPartner(application.id, message.trim())
          : () => requestPartnerInfo(application.id, message.trim());
    const done = decision === 'approve' ? 'Parceiro aprovado: já pode receber pedidos' : decision === 'reject' ? 'Cadastro recusado; o parceiro recebeu o motivo' : 'Pedido de informações enviado';
    if (await run(action, done)) onClose();
  }

  return (
    <Modal title={`#${application.number} · ${application.businessName}`} onClose={onClose} width="lg">
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-sm" data-testid="partner-detail">
          <dt className="text-muted-foreground">Status</dt><dd><Pill className={STATUS_CLASS[application.status]}>{PARTNER_STATUS_LABELS[application.status]}</Pill></dd>
          <dt className="text-muted-foreground">CNPJ</dt><dd>{cnpj(application.document)}</dd>
          <dt className="text-muted-foreground">Tipo</dt><dd>{TYPE_LABELS[application.type]}</dd>
          <dt className="text-muted-foreground">Endereço</dt><dd>{application.address} · {application.city}</dd>
          <dt className="text-muted-foreground">Funcionamento</dt><dd>{application.opensAt} às {application.closesAt}</dd>
          <dt className="text-muted-foreground">Contato</dt><dd>{application.contactName} · {application.contactEmail} · {phone(application.contactPhone)}</dd>
          {application.notes && (<><dt className="text-muted-foreground">Observações</dt><dd className="whitespace-pre-wrap">{application.notes}</dd></>)}
          {application.infoRequest && (<><dt className="text-muted-foreground">Info pedida</dt><dd>{application.infoRequest}</dd></>)}
          {application.decisionReason && (<><dt className="text-muted-foreground">Motivo da recusa</dt><dd>{application.decisionReason}</dd></>)}
        </dl>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Documentos</p>
          {application.documents.length === 0 && <p className="text-sm text-muted-foreground">Nenhum documento enviado.</p>}
          <div className="flex flex-wrap gap-2">
            {application.documents.map(doc => (
              <a key={doc.id} href={partnerDocumentUrl(application.id, doc.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-1.5 text-sm hover:bg-muted"><FileText size={13} />{doc.fileName} <span className="text-xs text-muted-foreground">({Math.ceil(doc.sizeBytes / 1024)} KB)</span></a>
            ))}
          </div>
        </div>

        {open && (
          <>
            <div className="flex gap-2">
              <button onClick={() => setDecision('approve')} className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium border', decision === 'approve' ? 'bg-success text-white border-success' : 'border-border hover:bg-muted')}><Check size={14} />Aprovar</button>
              <button onClick={() => setDecision('info')} className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium border', decision === 'info' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted')}><MessageSquare size={14} />Pedir informações</button>
              <button onClick={() => setDecision('reject')} className={cn('flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium border', decision === 'reject' ? 'bg-error text-white border-error' : 'border-border hover:bg-muted')}><X size={14} />Recusar</button>
            </div>
            {decision === 'approve' && (
              <select aria-label="Plano do novo parceiro" value={planId} onChange={event => setPlanId(event.target.value)} className={PANEL_INPUT_CLASS}>
                <option value="">Escolha o plano…</option>
                {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
              </select>
            )}
            {(decision === 'reject' || decision === 'info') && (
              <textarea aria-label={decision === 'reject' ? 'Motivo da recusa' : 'O que falta'} value={message} onChange={event => setMessage(event.target.value)} rows={3} maxLength={1000} placeholder={decision === 'reject' ? 'Motivo (enviado ao parceiro)…' : 'O que o parceiro precisa enviar…'} className={PANEL_INPUT_CLASS} />
            )}
            {decision && (
              <button disabled={pending || (decision === 'approve' ? !planId : !messageOk)} onClick={() => void submit()} className="bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">
                {pending ? 'Enviando…' : 'Confirmar'}
              </button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
