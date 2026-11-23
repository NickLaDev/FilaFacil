import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, Clock, Copy, FileText, Loader2, LocateFixed, MessageSquare, Upload, XCircle } from 'lucide-react';
import { ESTABLISHMENT_TYPES, isValidCnpj, PARTNER_STATUS_LABELS, type EstablishmentType, type PartnerApplicationDto, type PartnerApplicationInput } from '@filafacil/shared';
import { BrandLogo } from '@/components/brand/Logo';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { errorMessage, isApiError } from '@/lib/api/client';
import { cn, formatDateTime } from '@/lib/utils';
import { fetchPartnerApplication, submitPartnerApplication, updatePartnerApplication, uploadPartnerDocument, useFeatureEnabled } from '@/services/sprint5Service';

const TOKEN_KEY = 'filafacil.partner-token';
const TYPE_LABELS: Record<EstablishmentType, string> = { bar: 'Bar', restaurant: 'Restaurante', canteen: 'Cantina', snack_bar: 'Lanchonete' };

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* o código também é mostrado na tela para guardar */
  }
};

/**
 * Ficha 55 (lado do parceiro): cadastro do novo estabelecimento, sem conta. O código de acompanhamento mostrado ao
 * enviar é a chave para ver o status, anexar documentos e responder a pedidos de informação.
 */
export default function PartnerApp() {
  const [token, setToken] = useState<string | null>(readToken);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <BrandLogo size="sm" />
          <span className="text-sm text-muted-foreground">Seja parceiro</span>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">
        {token ? (
          <StatusPage
            token={token}
            freshToken={freshToken}
            onForget={() => {
              writeToken(null);
              setToken(null);
              setFreshToken(null);
            }}
          />
        ) : (
          <ApplyPage
            onCreated={created => {
              writeToken(created);
              setFreshToken(created);
              setToken(created);
            }}
            onUseToken={existing => {
              writeToken(existing);
              setToken(existing);
            }}
          />
        )}
      </main>
    </div>
  );
}

type FormState = Record<keyof PartnerApplicationInput, string>;
const EMPTY: FormState = { businessName: '', type: 'restaurant', document: '', city: '', address: '', latitude: '', longitude: '', opensAt: '11:00', closesAt: '23:00', contactName: '', contactEmail: '', contactPhone: '', notes: '' };

function validate(form: FormState) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (form.businessName.trim().length < 2) errors.businessName = 'Informe o nome do estabelecimento.';
  if (!isValidCnpj(form.document)) errors.document = 'CNPJ inválido.';
  if (form.city.trim().length < 2) errors.city = 'Informe a cidade.';
  if (form.address.trim().length < 5) errors.address = 'Informe o endereço completo.';
  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  if (!form.latitude || Number.isNaN(lat) || lat < -90 || lat > 90 || !form.longitude || Number.isNaN(lng) || lng < -180 || lng > 180) errors.latitude = 'Informe a localização (use o botão para pegar a atual).';
  if (form.opensAt === form.closesAt) errors.closesAt = 'Abertura e fechamento não podem ser iguais.';
  if (form.contactName.trim().length < 3) errors.contactName = 'Informe o responsável.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contactEmail.trim())) errors.contactEmail = 'E-mail inválido.';
  if (!/^\d{10,11}$/.test(form.contactPhone.replace(/\D/g, ''))) errors.contactPhone = 'Celular com DDD.';
  return errors;
}

const toInput = (form: FormState): PartnerApplicationInput => ({
  businessName: form.businessName.trim(),
  type: form.type as EstablishmentType,
  document: form.document,
  city: form.city.trim(),
  address: form.address.trim(),
  latitude: Number(form.latitude),
  longitude: Number(form.longitude),
  opensAt: form.opensAt,
  closesAt: form.closesAt,
  contactName: form.contactName.trim(),
  contactEmail: form.contactEmail.trim(),
  contactPhone: form.contactPhone,
  notes: form.notes.trim(),
});

function ApplyPage({ onCreated, onUseToken }: { onCreated: (token: string) => void; onUseToken: (token: string) => void }) {
  const signupOpen = useFeatureEnabled('partnerSignup');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [existing, setExisting] = useState('');
  const errors = submitted ? validate(form) : {};
  const set = (key: keyof FormState) => (value: string) => setForm(current => ({ ...current, [key]: value }));

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      position => setForm(current => ({ ...current, latitude: position.coords.latitude.toFixed(6), longitude: position.coords.longitude.toFixed(6) })),
      () => setServerError('Não foi possível obter a localização. Digite latitude e longitude.'),
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(validate(form)).length) return;
    setSending(true);
    try {
      const created = await submitPartnerApplication(toInput(form));
      onCreated(created.trackingToken);
    } catch (failure) {
      setServerError(errorMessage(failure));
    } finally {
      setSending(false);
    }
  }

  const field = (key: keyof FormState, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <FormField label={label} htmlFor={`partner-${key}`} error={errors[key]}>
      <input id={`partner-${key}`} value={form[key]} onChange={event => set(key)(event.target.value)} className={PANEL_INPUT_CLASS} {...props} />
    </FormField>
  );

  if (!signupOpen) {
    return <p className="bg-card border border-border rounded-2xl p-6 text-center text-muted-foreground">O cadastro de novos parceiros está fechado no momento. Tente novamente mais tarde.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">Cadastre seu estabelecimento</h1>
        <p className="text-sm text-muted-foreground mt-1">Nossa equipe analisa os dados e documentos. Aprovado, você já pode receber pedidos e recebe o acesso ao painel do gestor por e-mail.</p>
      </div>
      <form onSubmit={event => void submit(event)} noValidate className="bg-card border border-border rounded-2xl p-5 grid sm:grid-cols-2 gap-4">
        {field('businessName', 'Nome do estabelecimento', { maxLength: 80 })}
        <FormField label="Tipo" htmlFor="partner-type">
          <select id="partner-type" value={form.type} onChange={event => set('type')(event.target.value)} className={PANEL_INPUT_CLASS}>
            {ESTABLISHMENT_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
          </select>
        </FormField>
        {field('document', 'CNPJ', { inputMode: 'numeric', placeholder: '00.000.000/0000-00', maxLength: 18 })}
        {field('city', 'Cidade', { maxLength: 60 })}
        <div className="sm:col-span-2">{field('address', 'Endereço', { maxLength: 160, placeholder: 'Rua, número, bairro' })}</div>
        {field('latitude', 'Latitude', { inputMode: 'decimal' })}
        <div className="flex items-end gap-2">
          <div className="flex-1">{field('longitude', 'Longitude', { inputMode: 'decimal' })}</div>
          <button type="button" onClick={locate} title="Usar minha localização" aria-label="Usar minha localização" className="mb-0.5 p-2.5 border border-border rounded-xl hover:bg-muted"><LocateFixed size={16} /></button>
        </div>
        {field('opensAt', 'Abre às', { type: 'time' })}
        {field('closesAt', 'Fecha às (00:00 = meia-noite)', { type: 'time' })}
        {field('contactName', 'Responsável', { maxLength: 120, autoComplete: 'name' })}
        {field('contactEmail', 'E-mail do responsável', { type: 'email', autoComplete: 'email' })}
        {field('contactPhone', 'Celular com DDD', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
        <div className="sm:col-span-2">
          <FormField label="Observações (opcional)" htmlFor="partner-notes">
            <textarea id="partner-notes" value={form.notes} onChange={event => set('notes')(event.target.value)} rows={3} maxLength={1000} className={PANEL_INPUT_CLASS} />
          </FormField>
        </div>
        {serverError && <p className="sm:col-span-2 text-sm text-error">{serverError}</p>}
        <button type="submit" disabled={sending} data-testid="partner-submit" className="sm:col-span-2 bg-primary text-primary-foreground rounded-xl py-3 font-semibold disabled:opacity-60">{sending ? 'Enviando…' : 'Enviar cadastro'}</button>
      </form>
      <div className="bg-card border border-border rounded-2xl p-5 flex flex-col sm:flex-row gap-3 sm:items-end">
        <div className="flex-1">
          <FormField label="Já enviou? Acompanhe com o código" htmlFor="partner-existing"><input id="partner-existing" value={existing} onChange={event => setExisting(event.target.value.trim())} className={PANEL_INPUT_CLASS} /></FormField>
        </div>
        <button disabled={existing.length < 20} onClick={() => onUseToken(existing)} className="border border-border rounded-xl px-4 py-2.5 text-sm hover:bg-muted disabled:opacity-50">Acompanhar</button>
      </div>
    </div>
  );
}

const STATUS_STYLE = {
  pending: { icon: Clock, className: 'bg-warning-bg text-warning border-warning/30' },
  needs_info: { icon: MessageSquare, className: 'bg-primary/10 text-primary border-primary/30' },
  approved: { icon: CheckCircle2, className: 'bg-success-bg text-success border-success/30' },
  rejected: { icon: XCircle, className: 'bg-error-bg text-error border-error/30' },
} as const;

function StatusPage({ token, freshToken, onForget }: { token: string; freshToken: string | null; onForget: () => void }) {
  const [application, setApplication] = useState<PartnerApplicationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchPartnerApplication(token)
        .then(data => !cancelled && setApplication(data))
        .catch(failure => !cancelled && setError(isApiError(failure, 'INVALID_TRACKING_TOKEN') ? 'Código de acompanhamento inválido.' : errorMessage(failure)));
    void load();
    const timer = window.setInterval(() => void load(), 30_000); // a decisão aparece sem recarregar
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [token]);

  async function act(action: () => Promise<PartnerApplicationDto>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      setApplication(await action());
      setNotice(success);
    } catch (failure) {
      setNotice(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-3 items-center text-center">
        <p className="text-error">{error}</p>
        <button onClick={onForget} className="border border-border rounded-xl px-4 py-2 text-sm hover:bg-muted">Voltar ao cadastro</button>
      </div>
    );
  }
  if (!application) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary" /></div>;
  const style = STATUS_STYLE[application.status];
  const Icon = style.icon;
  const open = application.status === 'pending' || application.status === 'needs_info';

  return (
    <div className="flex flex-col gap-4">
      {freshToken && (
        <div className="bg-card border-2 border-primary/40 rounded-2xl p-5 flex flex-col gap-2" data-testid="tracking-token">
          <p className="font-semibold text-foreground">Cadastro enviado! Guarde seu código de acompanhamento:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm bg-muted rounded-lg px-3 py-2 break-all select-all">{freshToken}</code>
            <button onClick={() => void navigator.clipboard?.writeText(freshToken)} aria-label="Copiar código" className="p-2 border border-border rounded-lg hover:bg-muted"><Copy size={15} /></button>
          </div>
          <p className="text-xs text-muted-foreground">Ele não é mostrado de novo. Este navegador já guardou, mas anote para acompanhar de outro aparelho.</p>
        </div>
      )}
      <div className={cn('border rounded-2xl p-5 flex items-start gap-3', style.className)} data-testid="partner-status" data-status={application.status}>
        <Icon size={22} className="flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-display font-bold text-lg">{PARTNER_STATUS_LABELS[application.status]}</p>
          <p className="text-sm text-foreground/80">
            {application.status === 'pending' && 'Nossa equipe está analisando seu cadastro. Você recebe a resposta por e-mail.'}
            {application.status === 'needs_info' && application.infoRequest}
            {application.status === 'approved' && `Seu estabelecimento já pode receber pedidos. Entre no painel do gestor com o e-mail ${application.contactEmail} (use "Entrar com código" no primeiro acesso).`}
            {application.status === 'rejected' && `Motivo: ${application.decisionReason}`}
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-1 text-sm">
        <p className="font-semibold text-foreground">#{application.number} · {application.businessName}</p>
        <p className="text-muted-foreground">{application.address} · {application.city}</p>
        <p className="text-muted-foreground">Funcionamento: {application.opensAt} às {application.closesAt}</p>
        <p className="text-muted-foreground">Enviado em {formatDateTime(application.createdAt)}</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-foreground">Documentos</p>
          {open && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                aria-label="Documento"
                className="hidden"
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void act(() => uploadPartnerDocument(token, file), 'Documento enviado.');
                }}
              />
              <button disabled={busy || application.documents.length >= 5} onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 border border-border rounded-xl px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"><Upload size={14} />Anexar</button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Contrato social, alvará ou comprovante de endereço — PDF ou imagem, até 5 MB, no máximo 5 arquivos.</p>
        {application.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento enviado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-1">{application.documents.map(doc => <li key={doc.id} data-testid="partner-document" className="text-sm flex items-center gap-2"><FileText size={14} className="text-muted-foreground" />{doc.fileName}</li>)}</ul>
        )}
      </div>

      {application.status === 'needs_info' && (
        <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
          <p className="font-semibold text-foreground">Responder à equipe</p>
          <textarea aria-label="Resposta" value={answer} onChange={event => setAnswer(event.target.value)} rows={3} maxLength={1000} placeholder="Explique o que foi corrigido ou anexado…" className={PANEL_INPUT_CLASS} />
          <button disabled={busy || answer.trim().length < 3} onClick={() => void act(() => updatePartnerApplication(token, { notes: answer.trim() }), 'Resposta enviada: o cadastro voltou para análise.')} className="bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50">Enviar e voltar para análise</button>
        </div>
      )}

      {notice && <p role="status" className="text-sm text-center text-muted-foreground">{notice}</p>}
      <button onClick={onForget} className="text-sm text-muted-foreground underline self-center">Sair deste cadastro neste navegador</button>
    </div>
  );
}
