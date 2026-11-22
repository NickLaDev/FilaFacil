import { useState } from 'react';
import { Lock } from 'lucide-react';
import { AUDIT_ACTIONS, type AuditLogDto } from '@filafacil/shared';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useDebouncedValue } from '@/lib/hooks';
import { cn, formatDateTime } from '@/lib/utils';
import { useAuditLog } from '@/services/sprint5Service';
import Pagination from '../components/Pagination';

/** Ficha 42: ações sensíveis registradas de forma imutável, com filtro por usuário, ação e data. */
export default function AuditSection() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const query = useAuditLog({ page, action: action || undefined, q: useDebouncedValue(q.trim()) || undefined, from: from || undefined, to: to || undefined, actorId: actor?.id });
  const reset = () => setPage(1);

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock size={14} />Registros somente leitura: o banco recusa qualquer edição ou exclusão.</p>
      <div className="flex items-end gap-3 flex-wrap">
        <input aria-label="Buscar no resumo ou autor" value={q} onChange={event => { setQ(event.target.value); reset(); }} placeholder="Buscar (autor, resumo)…" className={cn(PANEL_INPUT_CLASS, 'max-w-xs')} />
        <select aria-label="Ação" value={action} onChange={event => { setAction(event.target.value); reset(); }} className={cn(PANEL_INPUT_CLASS, 'max-w-xs')}>
          <option value="">Todas as ações</option>
          {Object.entries(AUDIT_ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <input aria-label="De" type="date" value={from} onChange={event => { setFrom(event.target.value); reset(); }} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        <input aria-label="Até" type="date" value={to} onChange={event => { setTo(event.target.value); reset(); }} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        {actor && <button onClick={() => { setActor(null); reset(); }} className="text-sm bg-primary/10 text-primary rounded-full px-3 py-1.5">Autor: {actor.name} ✕</button>}
      </div>
      {query.error && !query.data && <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />}
      {!query.data && !query.error && <LoadingBlock />}
      {query.data && (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Quando</th><th className="px-4 py-3">Autor</th><th className="px-4 py-3">Ação</th><th className="px-4 py-3">Resumo</th></tr></thead>
            <tbody>
              {query.data.items.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum registro com esses filtros.</td></tr>}
              {query.data.items.map(entry => (
                <tr key={entry.id} data-testid="audit-row" onClick={() => setSelected(entry)} className="border-t border-border text-sm cursor-pointer hover:bg-muted/40">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDateTime(entry.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    {entry.actorId ? (
                      <button onClick={event => { event.stopPropagation(); setActor({ id: entry.actorId as string, name: entry.actorName }); reset(); }} className="hover:underline text-foreground">{entry.actorName}</button>
                    ) : (
                      <span className="text-muted-foreground">{entry.actorName}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{entry.actionLabel}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage} />
        </div>
      )}
      {selected && (
        <Modal title={selected.actionLabel} onClose={() => setSelected(null)} width="lg">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm" data-testid="audit-detail">
            <dt className="text-muted-foreground">Quando</dt><dd>{formatDateTime(selected.createdAt)}</dd>
            <dt className="text-muted-foreground">Autor</dt><dd>{selected.actorName}{selected.actorRole ? ` (${selected.actorRole})` : ''}</dd>
            <dt className="text-muted-foreground">IP</dt><dd>{selected.ipAddress ?? '—'}</dd>
            <dt className="text-muted-foreground">Alvo</dt><dd>{selected.targetType}{selected.targetId ? ` · ${selected.targetId}` : ''}</dd>
            <dt className="text-muted-foreground">Resumo</dt><dd>{selected.summary}</dd>
          </dl>
          {selected.details != null && <pre className="mt-3 bg-muted rounded-lg p-3 text-xs overflow-x-auto max-h-64">{JSON.stringify(selected.details, null, 2)}</pre>}
        </Modal>
      )}
    </div>
  );
}
