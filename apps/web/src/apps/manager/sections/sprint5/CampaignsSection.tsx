import { useState, type FormEvent } from 'react';
import { Cake, Edit3, Moon, Plus, Star, Trash2 } from 'lucide-react';
import { CUSTOMER_SEGMENT_LABELS, CUSTOMER_SEGMENTS, type CustomerSegment, type SegmentCampaignDto } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import Toggle from '@/components/ui/Toggle';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCents } from '@/lib/utils';
import { deleteCampaign, saveCampaign, useCampaigns } from '@/services/sprint5Service';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';

const SEGMENT_ICON = { birthday: Cake, inactive: Moon, frequent: Star } as const;
const segmentRule = (campaign: Pick<SegmentCampaignDto, 'segment' | 'threshold'>) =>
  campaign.segment === 'birthday' ? 'No dia do aniversário' : campaign.segment === 'inactive' ? `Sem pedir há ${campaign.threshold} dias` : `${campaign.threshold}+ pedidos em 30 dias`;
const benefit = (campaign: Pick<SegmentCampaignDto, 'discountType' | 'discountValue'>) => (campaign.discountType === 'percent' ? `${campaign.discountValue}% off` : `${formatCents(campaign.discountValue)} off`);

/**
 * Ficha 68: promoção segmentada. Cada campanha gera um cupom pessoal para quem entra no segmento e avisa no app —
 * automaticamente, todo dia, no fuso da casa. A taxa de uso mostra quantos dos que receberam usaram.
 */
export default function CampaignsSection({ unit, notify }: ManagerSectionProps) {
  const query = useCampaigns(unit.id);
  const { run } = useAsyncAction(notify);
  const [editing, setEditing] = useState<SegmentCampaignDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SegmentCampaignDto | null>(null);
  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">Sem disparo manual: a plataforma confere os segmentos todo dia e envia o cupom pessoal (vale só para aquele cliente, uma vez).</p>
        <button onClick={() => setEditing('new')} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium"><Plus size={15} />Nova campanha</button>
      </div>
      {query.data.length === 0 ? (
        <EmptyState icon={Cake} title="Nenhuma campanha" description="Crie, por exemplo, um presente de aniversário: o cliente recebe o cupom no dia certo, sozinho." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {query.data.map(campaign => {
            const Icon = SEGMENT_ICON[campaign.segment];
            return (
              <div key={campaign.id} data-testid="campaign-card" className={cn('bg-card border border-border rounded-xl p-4 flex flex-col gap-2', !campaign.active && 'opacity-60')}>
                <div className="flex items-start gap-2">
                  <Icon size={18} className="text-primary mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">{CUSTOMER_SEGMENT_LABELS[campaign.segment]} · {segmentRule(campaign)}</p>
                  </div>
                  <Toggle checked={campaign.active} onChange={active => void run(() => saveCampaign(unit.id, { ...campaign, active }, campaign.id), active ? 'Campanha ativada' : 'Campanha pausada')} label={`Ativar ${campaign.name}`} />
                </div>
                <p className="text-sm">{benefit(campaign)} · válido por {campaign.validDays} dia(s)</p>
                <div className="grid grid-cols-3 gap-2 text-center bg-muted/50 rounded-lg py-2">
                  <div><p className="text-lg font-bold">{campaign.sent}</p><p className="text-[11px] text-muted-foreground">enviados</p></div>
                  <div><p className="text-lg font-bold">{campaign.used}</p><p className="text-[11px] text-muted-foreground">usados</p></div>
                  <div><p className="text-lg font-bold" data-testid="usage-rate">{campaign.usageRate === null ? '—' : `${campaign.usageRate.toLocaleString('pt-BR')}%`}</p><p className="text-[11px] text-muted-foreground">taxa de uso</p></div>
                </div>
                <p className="text-xs text-muted-foreground">{campaign.eligibleNow} cliente(s) no segmento hoje</p>
                <div className="flex gap-1 justify-end">
                  <button onClick={() => setEditing(campaign)} aria-label={`Editar ${campaign.name}`} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground"><Edit3 size={14} /></button>
                  <button onClick={() => setDeleting(campaign)} aria-label={`Excluir ${campaign.name}`} className="p-1.5 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"><Trash2 size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && <CampaignModal unitId={unit.id} campaign={editing === 'new' ? null : editing} notify={notify} onClose={() => setEditing(null)} />}
      {deleting && <ConfirmDialog title="Excluir campanha" message={`Excluir "${deleting.name}"? Campanhas que já enviaram cupons não são excluídas (pause-as).`} confirmLabel="Excluir" onConfirm={() => run(() => deleteCampaign(unit.id, deleting.id), 'Campanha excluída').then(() => setDeleting(null))} onClose={() => setDeleting(null)} />}
    </div>
  );
}

function CampaignModal({ unitId, campaign, notify, onClose }: { unitId: string; campaign: SegmentCampaignDto | null; notify: (message: string) => void; onClose: () => void }) {
  const { run, pending } = useAsyncAction(notify);
  const [name, setName] = useState(campaign?.name ?? '');
  const [segment, setSegment] = useState<CustomerSegment>(campaign?.segment ?? 'birthday');
  const [threshold, setThreshold] = useState(String(campaign?.threshold || (segment === 'inactive' ? 30 : 4)));
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>(campaign?.discountType ?? 'percent');
  const [discount, setDiscount] = useState(campaign ? String(campaign.discountType === 'percent' ? campaign.discountValue : campaign.discountValue / 100) : '15');
  const [validDays, setValidDays] = useState(String(campaign?.validDays ?? 7));
  const [message, setMessage] = useState(campaign?.message ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(discount.replace(',', '.'));
    const next: Record<string, string> = {};
    if (name.trim().length < 3) next.name = 'Dê um nome (ex.: Presente de aniversário).';
    if (!(value > 0) || (discountType === 'percent' && value > 100)) next.discount = discountType === 'percent' ? 'Entre 1 e 100%.' : 'Informe o valor.';
    if (segment !== 'birthday' && !(Number(threshold) >= 1)) next.threshold = 'Obrigatório.';
    if (!(Number(validDays) >= 1 && Number(validDays) <= 90)) next.validDays = 'De 1 a 90 dias.';
    setErrors(next);
    if (Object.keys(next).length) return;
    const input = {
      name: name.trim(),
      segment,
      threshold: segment === 'birthday' ? undefined : Number(threshold),
      discountType,
      discountValue: discountType === 'percent' ? Math.round(value) : Math.round(value * 100),
      validDays: Number(validDays),
      message: message.trim(),
      active: campaign?.active ?? true,
    };
    const saved = await run(() => saveCampaign(unitId, input, campaign?.id), campaign ? 'Campanha salva' : 'Campanha criada');
    if (saved) {
      if (!campaign && saved.sent > 0) notify(`${saved.sent} cliente(s) já estavam no segmento e receberam o cupom.`);
      onClose();
    }
  }

  return (
    <Modal title={campaign ? 'Editar campanha' : 'Nova campanha'} onClose={onClose} width="md">
      <form onSubmit={event => void submit(event)} className="flex flex-col gap-3" noValidate>
        <FormField label="Nome" htmlFor="campaign-name" error={errors.name}><input id="campaign-name" value={name} onChange={event => setName(event.target.value)} maxLength={60} className={PANEL_INPUT_CLASS} /></FormField>
        <FormField label="Segmento" htmlFor="campaign-segment">
          <select id="campaign-segment" value={segment} onChange={event => setSegment(event.target.value as CustomerSegment)} className={PANEL_INPUT_CLASS}>
            {CUSTOMER_SEGMENTS.map(option => <option key={option} value={option}>{CUSTOMER_SEGMENT_LABELS[option]}</option>)}
          </select>
        </FormField>
        {segment !== 'birthday' && (
          <FormField label={segment === 'inactive' ? 'Dias sem pedir' : 'Pedidos nos últimos 30 dias'} htmlFor="campaign-threshold" error={errors.threshold}>
            <input id="campaign-threshold" type="number" min={1} max={365} value={threshold} onChange={event => setThreshold(event.target.value)} className={PANEL_INPUT_CLASS} />
          </FormField>
        )}
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Tipo de desconto" htmlFor="campaign-type">
            <select id="campaign-type" value={discountType} onChange={event => setDiscountType(event.target.value as 'percent' | 'fixed')} className={PANEL_INPUT_CLASS}><option value="percent">Percentual (%)</option><option value="fixed">Valor (R$)</option></select>
          </FormField>
          <FormField label={discountType === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'} htmlFor="campaign-discount" error={errors.discount}><input id="campaign-discount" inputMode="decimal" value={discount} onChange={event => setDiscount(event.target.value)} className={PANEL_INPUT_CLASS} /></FormField>
        </div>
        <FormField label="Validade do cupom (dias)" htmlFor="campaign-valid" error={errors.validDays}><input id="campaign-valid" type="number" min={1} max={90} value={validDays} onChange={event => setValidDays(event.target.value)} className={PANEL_INPUT_CLASS} /></FormField>
        <FormField label="Mensagem (opcional)" htmlFor="campaign-message"><input id="campaign-message" value={message} onChange={event => setMessage(event.target.value)} maxLength={200} placeholder="Ex.: Parabéns! A primeira rodada é por nossa conta." className={PANEL_INPUT_CLASS} /></FormField>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">{pending ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
