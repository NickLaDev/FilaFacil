import { useState, type FormEvent } from 'react';
import { LifeBuoy } from 'lucide-react';
import { SUPPORT_PRIORITIES, SUPPORT_PRIORITY_LABELS, SUPPORT_STATUS_LABELS, SUPPORT_STATUSES, type SupportPriority, type SupportStatus } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { replyAdminTicket, updateAdminTicket, useAdminTicket, useAdminTickets, type AdminTicketsFilter } from '@/services/sprint4StaffService';
import FilterChips from '../components/FilterChips';
import SearchBox from '../components/SearchBox';
import { Pill } from '../components/Pills';

const PRIORITY_STYLE: Record<SupportPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-primary/10 text-primary',
  high: 'bg-warning-bg text-warning',
  urgent: 'bg-error-bg text-error',
};

/** Ficha 39: fila de chamados priorizada por urgência, com resposta, histórico de conversa e status. */
export default function SupportSection({ notify }: { notify: (message: string) => void }) {
  const [scope, setScope] = useState<AdminTicketsFilter['scope']>('active');
  const [priority, setPriority] = useState<SupportPriority | ''>('');
  const [q, setQ] = useState('');
  const query = useAdminTickets({ scope, priority: priority || undefined, q: q.trim() || undefined });
  const [selected, setSelected] = useState<string | null>(null);

  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const { items, counts } = query.data;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-7xl">
      <div className="flex items-center gap-3 flex-wrap">
        <FilterChips
          label="Chamados"
          value={scope}
          onChange={setScope}
          options={[
            { id: 'active', label: 'Ativos', count: counts.open + counts.in_progress },
            { id: 'resolved', label: 'Resolvidos', count: counts.resolved },
            { id: 'all', label: 'Todos' },
          ]}
        />
        <select aria-label="Urgência" value={priority} onChange={event => setPriority(event.target.value as SupportPriority | '')} className="border border-border rounded-xl px-3 py-2 text-sm bg-card">
          <option value="">Qualquer urgência</option>
          {SUPPORT_PRIORITIES.map(option => <option key={option} value={option}>{SUPPORT_PRIORITY_LABELS[option]}</option>)}
        </select>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por assunto ou estabelecimento" />
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span data-testid="urgent-count">Urgentes abertos: <strong className={counts.urgentOpen > 0 ? 'text-error' : 'text-foreground'}>{counts.urgentOpen}</strong></span>
        <span data-testid="awaiting-count">Aguardando a plataforma: <strong className="text-foreground">{counts.awaiting}</strong></span>
        <span>{scope === 'active' ? 'Ordem: urgência e, depois, o mais antigo' : 'Ordem: atividade mais recente'}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <div className="bg-card rounded-xl border border-border"><EmptyState icon={LifeBuoy} title="Nenhum chamado" description="Os chamados abertos pelos estabelecimentos aparecem aqui na hora." /></div>
          ) : (
            items.map(ticket => (
              <button key={ticket.id} data-testid="admin-ticket" data-priority={ticket.priority} onClick={() => setSelected(ticket.id)} className={cn('text-left bg-card rounded-xl border p-4 flex flex-col gap-1', selected === ticket.id ? 'border-primary' : 'border-border')}>
                <div className="flex items-center gap-2">
                  <p className="font-display font-semibold text-foreground text-sm flex-1 truncate">#{ticket.number} · {ticket.subject}</p>
                  <Pill className={PRIORITY_STYLE[ticket.priority]}>{SUPPORT_PRIORITY_LABELS[ticket.priority]}</Pill>
                </div>
                <p className="text-xs text-muted-foreground">{ticket.establishmentName} · {SUPPORT_STATUS_LABELS[ticket.status]} · {formatDateTime(ticket.createdAt)}</p>
                {ticket.awaitingPlatform && <p className="text-[11px] font-semibold text-primary">Aguardando resposta da plataforma</p>}
              </button>
            ))
          )}
        </div>
        <div>{selected ? <Thread key={selected} ticketId={selected} notify={notify} /> : <div className="bg-card rounded-xl border border-border"><EmptyState icon={LifeBuoy} title="Selecione um chamado" description="A conversa, o status e a urgência aparecem aqui." /></div>}</div>
      </div>
    </div>
  );
}

function Thread({ ticketId, notify }: { ticketId: string; notify: (message: string) => void }) {
  const query = useAdminTicket(ticketId);
  const { run, pending } = useAsyncAction(notify);
  const [body, setBody] = useState('');
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const ticket = query.data;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    if (await run(() => replyAdminTicket(ticketId, body.trim()), 'Resposta enviada — o estabelecimento foi notificado')) setBody('');
  }

  return (
    <div className="bg-card rounded-xl border border-border flex flex-col" data-testid="admin-ticket-thread">
      <div className="p-4 border-b border-border flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-foreground truncate">#{ticket.number} · {ticket.subject}</p>
          <p className="text-xs text-muted-foreground">{ticket.establishmentName}</p>
        </div>
        <select aria-label="Status do chamado" value={ticket.status} onChange={event => void run(() => updateAdminTicket(ticketId, { status: event.target.value as SupportStatus }), 'Status atualizado')} className="border border-border rounded-lg px-2 py-1.5 text-xs bg-card">
          {SUPPORT_STATUSES.map(option => <option key={option} value={option}>{SUPPORT_STATUS_LABELS[option]}</option>)}
        </select>
        <select aria-label="Urgência do chamado" value={ticket.priority} onChange={event => void run(() => updateAdminTicket(ticketId, { priority: event.target.value as SupportPriority }), 'Urgência atualizada')} className="border border-border rounded-lg px-2 py-1.5 text-xs bg-card">
          {SUPPORT_PRIORITIES.map(option => <option key={option} value={option}>{SUPPORT_PRIORITY_LABELS[option]}</option>)}
        </select>
      </div>
      <ul className="p-4 flex flex-col gap-3 max-h-[440px] overflow-y-auto">
        {ticket.messages.map(message => (
          <li key={message.id} data-testid="admin-ticket-message" data-side={message.side} className={cn('rounded-xl px-3 py-2 text-sm max-w-[85%]', message.side === 'platform' ? 'bg-primary/10 self-end' : 'bg-muted self-start')}>
            <p className="text-[11px] text-muted-foreground mb-0.5">{message.authorName} · {formatDateTime(message.createdAt)}</p>
            <p className="text-foreground whitespace-pre-wrap">{message.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={event => void send(event)} className="p-4 border-t border-border flex gap-2">
        <textarea value={body} onChange={event => setBody(event.target.value.slice(0, 2000))} rows={2} aria-label="Sua resposta" placeholder="Responder ao estabelecimento…" className={cn(PANEL_INPUT_CLASS, 'resize-none flex-1')} />
        <button type="submit" disabled={pending || !body.trim()} className="bg-primary text-primary-foreground rounded-xl px-4 text-sm font-semibold disabled:opacity-50">Responder</button>
      </form>
    </div>
  );
}
