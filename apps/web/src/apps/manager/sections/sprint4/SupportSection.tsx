import { useState, type FormEvent } from 'react';
import { LifeBuoy, Plus } from 'lucide-react';
import { SUPPORT_PRIORITIES, SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS, type SupportPriority } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { createSupportTicket, replySupportTicket, resolveSupportTicket, useEstablishmentTicket, useEstablishmentTickets } from '@/services/sprint4StaffService';
import type { ManagerSectionProps } from '../../types';

const PRIORITY_STYLE: Record<SupportPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-primary/10 text-primary',
  high: 'bg-warning-bg text-warning',
  urgent: 'bg-error-bg text-error',
};

/** Ficha 39 (lado do estabelecimento): abre chamados com urgência, acompanha e responde a conversa. */
export default function SupportSection({ unit, notify }: ManagerSectionProps) {
  const tickets = useEstablishmentTickets(unit.id);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (tickets.error && !tickets.data) return <ErrorBlock error={tickets.error} onRetry={() => void tickets.refetch()} />;
  if (!tickets.data) return <LoadingBlock />;

  return (
    <div className="p-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] max-w-6xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Fale com a equipe da plataforma. Você é avisado a cada resposta.</p>
          <button onClick={() => setCreating(true)} data-testid="new-ticket" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium flex-shrink-0"><Plus size={15} />Novo chamado</button>
        </div>
        {tickets.data.length === 0 ? (
          <div className="bg-card rounded-xl border border-border"><EmptyState icon={LifeBuoy} title="Nenhum chamado" description="Abra um chamado quando precisar de ajuda da plataforma." /></div>
        ) : (
          tickets.data.map(ticket => (
            <button key={ticket.id} data-testid="ticket-row" onClick={() => setSelected(ticket.id)} className={cn('text-left bg-card rounded-xl border p-4 flex flex-col gap-1', selected === ticket.id ? 'border-primary' : 'border-border')}>
              <div className="flex items-center gap-2">
                <p className="font-display font-semibold text-foreground text-sm flex-1 truncate">#{ticket.number} · {ticket.subject}</p>
                <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full', PRIORITY_STYLE[ticket.priority])}>{SUPPORT_PRIORITY_LABELS[ticket.priority]}</span>
              </div>
              <p className="text-xs text-muted-foreground">{SUPPORT_STATUS_LABELS[ticket.status]} · {ticket.messageCount} {ticket.messageCount === 1 ? 'mensagem' : 'mensagens'} · {formatDateTime(ticket.lastMessageAt)}</p>
            </button>
          ))
        )}
      </div>
      <div>{selected ? <TicketThread unitId={unit.id} ticketId={selected} notify={notify} /> : <div className="bg-card rounded-xl border border-border"><EmptyState icon={LifeBuoy} title="Selecione um chamado" description="A conversa com a plataforma aparece aqui." /></div>}</div>
      {creating && <NewTicketModal unitId={unit.id} notify={notify} onClose={() => setCreating(false)} onCreated={id => setSelected(id)} />}
    </div>
  );
}

function TicketThread({ unitId, ticketId, notify }: { unitId: string; ticketId: string; notify: (message: string) => void }) {
  const query = useEstablishmentTicket(unitId, ticketId);
  const { run, pending } = useAsyncAction(notify);
  const [body, setBody] = useState('');
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const ticket = query.data;

  async function send() {
    if (!body.trim()) return;
    if (await run(() => replySupportTicket(unitId, ticketId, body.trim()))) setBody('');
  }

  return (
    <div className="bg-card rounded-xl border border-border flex flex-col" data-testid="ticket-thread">
      <div className="p-4 border-b border-border flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-foreground truncate">#{ticket.number} · {ticket.subject}</p>
          <p className="text-xs text-muted-foreground">{SUPPORT_STATUS_LABELS[ticket.status]} · urgência {SUPPORT_PRIORITY_LABELS[ticket.priority].toLowerCase()}</p>
        </div>
        {ticket.status !== 'resolved' && <button onClick={() => void run(() => resolveSupportTicket(unitId, ticketId), 'Chamado encerrado')} className="text-xs font-semibold border border-border rounded-lg px-3 py-1.5 hover:bg-muted">Marcar como resolvido</button>}
      </div>
      <ul className="p-4 flex flex-col gap-3 max-h-[420px] overflow-y-auto">
        {ticket.messages.map(message => (
          <li key={message.id} data-testid="ticket-message" data-side={message.side} className={cn('rounded-xl px-3 py-2 text-sm max-w-[85%]', message.side === 'platform' ? 'bg-primary/10 self-start' : 'bg-muted self-end')}>
            <p className="text-[11px] text-muted-foreground mb-0.5">{message.side === 'platform' ? 'Plataforma' : message.authorName} · {formatDateTime(message.createdAt)}</p>
            <p className="text-foreground whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={(event: FormEvent) => { event.preventDefault(); void send(); }} className="p-4 border-t border-border flex gap-2">
        <textarea value={body} onChange={event => setBody(event.target.value.slice(0, 2000))} rows={2} aria-label="Sua resposta" placeholder="Escreva sua resposta…" className={cn(PANEL_INPUT_CLASS, 'resize-none flex-1')} />
        <button type="submit" disabled={pending || !body.trim()} className="bg-primary text-primary-foreground rounded-xl px-4 text-sm font-semibold disabled:opacity-50">Enviar</button>
      </form>
    </div>
  );
}

function NewTicketModal({ unitId, notify, onClose, onCreated }: { unitId: string; notify: (message: string) => void; onClose: () => void; onCreated: (id: string) => void }) {
  const { run, pending } = useAsyncAction(notify);
  const [subject, setSubject] = useState('');
  const [priority, setPriority] = useState<SupportPriority>('normal');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (subject.trim().length < 3) next.subject = 'Descreva o assunto (mín. 3 caracteres).';
    if (!message.trim()) next.message = 'Conte o que está acontecendo.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const created = await run(() => createSupportTicket(unitId, { subject: subject.trim(), priority, message: message.trim() }), 'Chamado aberto');
    if (created) {
      onCreated(created.id);
      onClose();
    }
  }

  return (
    <Modal title="Novo chamado" onClose={onClose} width="md">
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Assunto" htmlFor="ticket-subject" error={errors.subject}><input id="ticket-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={120} className={PANEL_INPUT_CLASS} /></FormField>
        <FormField label="Urgência" htmlFor="ticket-priority" hint="Urgente é para problemas que param a operação.">
          <select id="ticket-priority" value={priority} onChange={event => setPriority(event.target.value as SupportPriority)} className={PANEL_INPUT_CLASS}>
            {SUPPORT_PRIORITIES.map(option => <option key={option} value={option}>{SUPPORT_PRIORITY_LABELS[option]}</option>)}
          </select>
        </FormField>
        <FormField label="Mensagem" htmlFor="ticket-message" error={errors.message}><textarea id="ticket-message" value={message} onChange={event => setMessage(event.target.value.slice(0, 2000))} rows={5} className={cn(PANEL_INPUT_CLASS, 'resize-none')} /></FormField>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">{pending ? 'Enviando…' : 'Abrir chamado'}</button>
        </div>
      </form>
    </Modal>
  );
}
