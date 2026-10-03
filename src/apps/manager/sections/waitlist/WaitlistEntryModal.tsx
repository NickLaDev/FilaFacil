import { useState, type FormEvent } from 'react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { formatPhone, isValidPhone } from '@/lib/validation';
import { addToWaitlist } from '@/services/waitlistService';

const MIN_PARTY = 1;
const MAX_PARTY = 20;

interface Props {
  establishmentId: string;
  onClose: () => void;
  onAdded: (name: string) => void;
}

export default function WaitlistEntryModal({ establishmentId, onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; partySize?: string }>({});

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const size = Number(partySize);
    const nextErrors: typeof errors = {};
    if (name.trim().length < 2) nextErrors.name = 'Informe o nome do cliente.';
    if (!isValidPhone(phone)) nextErrors.phone = 'Informe um celular com DDD — é por ele que o cliente será avisado.';
    if (!Number.isInteger(size) || size < MIN_PARTY || size > MAX_PARTY) nextErrors.partySize = `Entre ${MIN_PARTY} e ${MAX_PARTY} pessoas.`;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    addToWaitlist(establishmentId, { name: name.trim(), phone: formatPhone(phone), partySize: size });
    onAdded(name.trim());
    onClose();
  }

  return (
    <Modal title="Adicionar à fila" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="Nome" htmlFor="wait-name" error={errors.name}>
          <input id="wait-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="Ex: Ana Souza" className={PANEL_INPUT_CLASS} />
        </FormField>
        <FormField label="Celular" htmlFor="wait-phone" error={errors.phone}>
          <input id="wait-phone" type="tel" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="(19) 99999-9999" className={PANEL_INPUT_CLASS} />
        </FormField>
        <FormField label="Tamanho do grupo" htmlFor="wait-party" error={errors.partySize}>
          <input id="wait-party" type="number" min={MIN_PARTY} max={MAX_PARTY} value={partySize} onChange={e => setPartySize(e.target.value)} className={PANEL_INPUT_CLASS} />
        </FormField>
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold">
            Adicionar
          </button>
        </div>
      </form>
    </Modal>
  );
}
