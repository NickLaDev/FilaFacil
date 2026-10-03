import { useState } from 'react';
import { Check, ChevronRight, Heart, MapPin, Plus, ShieldCheck, ShoppingBag, Trash2, type LucideIcon } from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { formatPhone, isValidEmail, isValidPhone } from '@/lib/validation';
import BottomSheet from '@/components/ui/BottomSheet';
import { deleteAddress, logout, saveAddress, setDefaultAddress, updateProfile } from '@/services/authService';
import { useClient } from '../clientContext';
import { FixedBottom, ScreenHeader } from '../components/Layout';
import { TextField } from '../components/AuthFields';
import VerificationBanner from '../components/VerificationBanner';
import type { ClientScreen } from '../types';

function MenuGroup({ title, items }: { title: string; items: { icon: LucideIcon; label: string; screen: ClientScreen }[] }) {
  const { go } = useClient();
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 px-1">{title}</p>
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {items.map(({ icon: Icon, label, screen }, index) => (
          <button
            key={label}
            onClick={() => go(screen)}
            className={cn('w-full flex items-center gap-3 px-5 py-4 hover:bg-muted/50 transition-colors text-left', index < items.length - 1 && 'border-b border-border')}
          >
            <Icon size={16} className="text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-foreground flex-1">{label}</span>
            <ChevronRight size={15} className="text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Dados pessoais e atalhos para pedidos, favoritos e endereços (fichas 13 e 45). */
export function ProfileScreen() {
  const { go, account, isVisitor } = useClient();
  const [logoutSheet, setLogoutSheet] = useState(false);

  function confirmLogout() {
    logout();
    setLogoutSheet(false);
    go('welcome');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Perfil" />
      <div className="px-5 py-5 flex flex-col gap-5">
        <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="font-display font-bold text-primary text-lg">{account ? getInitials(account.name) : isVisitor ? 'V' : '?'}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-foreground text-base leading-tight">{account?.name ?? 'Visitante'}</p>
            {account ? (
              <>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{[account.email, account.phone].filter(Boolean).join(' · ')}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">CPF {account.cpfMasked}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">Conta de visitante</p>
            )}
          </div>
          {account && <button onClick={() => go('edit-profile')} className="text-primary text-sm font-medium flex-shrink-0">Editar</button>}
        </div>

        {account && <VerificationBanner returnTo="profile" />}

        {account && (
          <MenuGroup
            title="Sua atividade"
            items={[
              { icon: ShoppingBag, label: 'Meus pedidos', screen: 'orders' },
              { icon: Heart, label: 'Favoritos', screen: 'favorites' },
              { icon: MapPin, label: 'Meus endereços', screen: 'addresses' },
            ]}
          />
        )}

        {account && <MenuGroup title="Configurações" items={[{ icon: ShieldCheck, label: 'Segurança e privacidade', screen: 'account-security' }]} />}

        {account ? (
          <button onClick={() => setLogoutSheet(true)} className="text-error text-sm font-medium text-center py-2">Sair da conta</button>
        ) : (
          <div className="flex flex-col gap-3">
            <button onClick={() => go('login')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Entrar</button>
            <button onClick={() => go('signup-name')} className="w-full border border-border text-foreground font-medium py-3.5 rounded-xl">Criar conta</button>
          </div>
        )}
      </div>

      {logoutSheet && (
        <BottomSheet onClose={() => setLogoutSheet(false)}>
          <p className="font-display font-bold text-foreground text-lg text-center mb-2">Deseja sair da sua conta?</p>
          <p className="text-muted-foreground text-sm text-center mb-6">Você precisará entrar novamente para fazer pedidos.</p>
          <div className="flex flex-col gap-3">
            <button onClick={confirmLogout} className="w-full bg-error text-white font-display font-semibold py-4 rounded-xl">Sair</button>
            <button onClick={() => setLogoutSheet(false)} className="w-full text-muted-foreground text-sm py-3">Cancelar</button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}

export function EditProfileScreen() {
  const { go, account, showToast } = useClient();
  const [firstName, ...rest] = account?.name.split(' ') ?? [''];
  const [first, setFirst] = useState(firstName ?? '');
  const [last, setLast] = useState(rest.join(' '));
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [submitted, setSubmitted] = useState(false);

  if (!account) return null;
  const errors = {
    first: !first.trim() ? 'Informe seu nome.' : undefined,
    phone: phone && !isValidPhone(phone) ? 'Celular inválido.' : undefined,
    email: email && !isValidEmail(email) ? 'E-mail inválido.' : undefined,
    contact: !phone && !email ? 'Mantenha ao menos um contato (e-mail ou celular).' : undefined,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  function save() {
    setSubmitted(true);
    if (!account || hasErrors) return;
    const contactChanged = email.trim() !== account.email || phone !== account.phone;
    updateProfile(account.id, { name: `${first.trim()} ${last.trim()}`.trim(), email: email.trim(), phone });
    showToast(contactChanged ? 'Dados salvos — confirme o novo contato' : 'Dados salvos');
    go('profile');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-28">
      <ScreenHeader title="Editar perfil" onBack={() => go('profile')} />
      <div className="flex-1 px-5 py-5 flex flex-col gap-4">
        <TextField label="Nome" value={first} onChange={setFirst} autoComplete="given-name" error={submitted ? errors.first : undefined} />
        <TextField label="Sobrenome" value={last} onChange={setLast} autoComplete="family-name" />
        <TextField label="Celular" value={phone} onChange={value => setPhone(formatPhone(value))} type="tel" inputMode="tel" autoComplete="tel"
          error={submitted ? errors.phone : undefined} hint="Alterar o celular exige nova verificação" />
        <TextField label="E-mail" value={email} onChange={setEmail} type="email" autoComplete="email"
          error={submitted ? errors.email ?? errors.contact : undefined} hint="Alterar o e-mail exige nova verificação" />
        <p className="text-xs text-muted-foreground">CPF {account.cpfMasked} · para alterar o CPF, fale com o suporte.</p>
      </div>
      <FixedBottom>
        <button onClick={save} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Salvar alterações</button>
      </FixedBottom>
    </div>
  );
}

export function AddressesScreen() {
  const { go, account, showToast } = useClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ label: '', street: '', city: '' });

  if (!account) return null;
  const canSave = form.label.trim() && form.street.trim() && form.city.trim();

  function addAddress() {
    if (!account || !canSave) return;
    saveAddress(account.id, { label: form.label.trim(), street: form.street.trim(), city: form.city.trim() });
    setForm({ label: '', street: '', city: '' });
    setAdding(false);
    showToast('Endereço salvo');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Endereços" onBack={() => go('profile')} />
      <div className="px-5 py-5 flex flex-col gap-3">
        {account.addresses.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">Nenhum endereço salvo.</p>}
        {account.addresses.map(address => (
          <div key={address.id} className={cn('bg-card border rounded-xl p-4 flex items-start gap-4', address.isDefault ? 'border-primary/30' : 'border-border')}>
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <MapPin size={18} className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-display font-semibold text-foreground text-sm">{address.label}</p>
                {address.isDefault && <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">Padrão</span>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{address.street}</p>
              <p className="text-xs text-muted-foreground">{address.city}</p>
              {!address.isDefault && (
                <button onClick={() => setDefaultAddress(account.id, address.id)} className="text-primary text-xs font-medium mt-1.5">Definir como padrão</button>
              )}
            </div>
            <button
              onClick={() => { deleteAddress(account.id, address.id); showToast('Endereço removido'); }}
              className="p-1.5 hover:bg-muted rounded-lg"
              aria-label={`Remover endereço ${address.label}`}
            >
              <Trash2 size={14} className="text-muted-foreground" />
            </button>
          </div>
        ))}
        <button onClick={() => setAdding(true)} className="w-full border border-dashed border-border text-muted-foreground py-4 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-muted/50">
          <Plus size={16} />
          Adicionar endereço
        </button>
      </div>

      {adding && (
        <BottomSheet onClose={() => setAdding(false)}>
          <p className="font-display font-bold text-foreground text-lg mb-4">Novo endereço</p>
          <div className="flex flex-col gap-4">
            <TextField label="Nome do endereço" value={form.label} onChange={label => setForm(prev => ({ ...prev, label: label.slice(0, 30) }))} placeholder="Ex: Casa, Trabalho" />
            <TextField label="Rua e número" value={form.street} onChange={street => setForm(prev => ({ ...prev, street: street.slice(0, 120) }))} autoComplete="street-address" />
            <TextField label="Cidade / UF" value={form.city} onChange={city => setForm(prev => ({ ...prev, city: city.slice(0, 60) }))} placeholder="Ex: Campinas, SP" />
            <button onClick={addAddress} disabled={!canSave} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2">
              <Check size={16} />
              Salvar endereço
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
