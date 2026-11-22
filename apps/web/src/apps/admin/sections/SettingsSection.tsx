import { useState } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import type { PlatformSettingDto, SettingImpactDto } from '@filafacil/shared';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import Toggle from '@/components/ui/Toggle';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { formatDateTime } from '@/lib/utils';
import { saveSetting, settingImpact, usePlatformSettings } from '@/services/sprint5Service';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Ficha 43: flags e parâmetros globais. Vale em até 1 minuto, sem deploy. Alteração crítica mostra o impacto
 * (calculado pelo servidor) e só é salva depois da confirmação.
 */
export default function SettingsSection({ notify }: { notify: (message: string) => void }) {
  const settings = usePlatformSettings();
  const { run } = useAsyncAction(notify);
  const [pending, setPending] = useState<{ setting: PlatformSettingDto; value: boolean | number; impact: SettingImpactDto } | null>(null);

  if (settings.error && !settings.data) return <ErrorBlock error={settings.error} onRetry={() => void settings.refetch()} />;
  if (!settings.data) return <LoadingBlock />;

  async function change(setting: PlatformSettingDto, value: boolean | number) {
    if (setting.critical) {
      const impact = await run(() => settingImpact(setting.key, value));
      if (impact) setPending({ setting, value, impact });
      return;
    }
    await run(() => saveSetting(setting.key, value), `${setting.label}: salvo. Vale em até 1 minuto.`);
  }

  const groups = [
    { id: 'features', title: 'Recursos (liga/desliga)' },
    { id: 'parameters', title: 'Parâmetros globais' },
  ] as const;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">
      <p className="text-sm text-muted-foreground">As alterações valem para toda a plataforma em até 1 minuto, sem novo deploy, e ficam registradas na auditoria. Itens marcados como críticos pedem confirmação depois de mostrar o impacto.</p>
      {groups.map(group => (
        <section key={group.id}>
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">{group.title}</h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {settings.data
              .filter(setting => setting.group === group.id)
              .map(setting => (
                <SettingRow key={setting.key} setting={setting} onChange={value => void change(setting, value)} />
              ))}
          </div>
        </section>
      ))}
      {pending && (
        <ConfirmDialog
          title={`Confirmar: ${pending.setting.label}`}
          tone="danger"
          description={pending.impact.message}
          confirmLabel="Confirmar alteração"
          onConfirm={() => void run(() => saveSetting(pending.setting.key, pending.value, true), `${pending.setting.label}: salvo. Vale em até 1 minuto.`).then(() => setPending(null))}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

function SettingRow({ setting, onChange }: { setting: PlatformSettingDto; onChange: (value: boolean | number) => void }) {
  const [draft, setDraft] = useState(String(setting.value));
  const number = Number(draft);
  const invalid = setting.type === 'number' && (!Number.isInteger(number) || (setting.min !== undefined && number < setting.min) || (setting.max !== undefined && number > setting.max));
  return (
    <div className="px-4 py-3 flex items-center gap-4" data-testid="setting-row" data-key={setting.key}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground flex items-center gap-2">
          {setting.label}
          {setting.critical && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-warning bg-warning-bg px-2 py-0.5 rounded-full"><AlertTriangle size={10} />crítico</span>}
        </p>
        <p className="text-xs text-muted-foreground">{setting.description}</p>
        {setting.updatedAt && <p className="text-[11px] text-muted-foreground mt-0.5">Alterado por {setting.updatedByName ?? '—'} em {formatDateTime(setting.updatedAt)}</p>}
      </div>
      {setting.type === 'boolean' ? (
        <Toggle checked={Boolean(setting.value)} onChange={() => onChange(!setting.value)} label={setting.label} />
      ) : (
        <div className="flex items-center gap-2">
          <input aria-label={setting.label} type="number" min={setting.min} max={setting.max} value={draft} onChange={event => setDraft(event.target.value)} className="w-24 border border-border rounded-xl px-3 py-1.5 text-sm bg-card" />
          <button disabled={invalid || number === setting.value} onClick={() => onChange(number)} aria-label={`Salvar ${setting.label}`} className="p-2 rounded-xl bg-primary text-primary-foreground disabled:opacity-40"><Save size={14} /></button>
        </div>
      )}
      {invalid && <span className="text-xs text-error">{setting.min}–{setting.max}</span>}
    </div>
  );
}
