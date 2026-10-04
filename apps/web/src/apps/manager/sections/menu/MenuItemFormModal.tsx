import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import Toggle from '@/components/ui/Toggle';
import { errorMessage, isApiError } from '@/lib/api/client';
import { isSafeImageSrc } from '@/lib/validation';
import { saveMenuItem, uploadMenuItemPhoto, type MenuItemView } from '@/services/menuService';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
/** Mesmo teto da API (UPLOAD_MAX_BYTES); o servidor confere o conteúdo e converte para WebP. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const NEW_CATEGORY = '__new__';
const MAX_PRICE = 10_000;

interface Props {
  establishmentId: string;
  item?: MenuItemView;
  categories: string[];
  notify: (message: string) => void;
  onClose: () => void;
}

type Errors = Partial<Record<'name' | 'description' | 'category' | 'price' | 'image' | 'form', string>>;

/** Ficha 28: cadastro/edição do item; foto enviada vai para o storage da API (ficha 03). */
export default function MenuItemFormModal({ establishmentId, item, categories, notify, onClose }: Props) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? categories[0] ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState('');
  const [price, setPrice] = useState(item ? item.price.toFixed(2).replace('.', ',') : '');
  const [imageLink, setImageLink] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [available, setAvailable] = useState(item?.available ?? true);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  // Libera a URL temporária da pré-visualização ao trocar de arquivo ou fechar o modal.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const shownImage = preview ?? (isSafeImageSrc(imageLink) ? imageLink : item?.image ?? null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    event.target.value = '';
    if (!selected) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type)) return setErrors(prev => ({ ...prev, image: 'Use uma imagem PNG, JPG ou WEBP.' }));
    if (selected.size > MAX_IMAGE_BYTES) return setErrors(prev => ({ ...prev, image: 'A imagem deve ter no máximo 2 MB.' }));
    setFile(selected);
    setImageLink('');
    setErrors(prev => ({ ...prev, image: undefined }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const finalCategory = (category === NEW_CATEGORY ? newCategory : category).trim();
    const parsedPrice = Number(price.replace(',', '.'));
    const link = imageLink.trim();
    const nextErrors: Errors = {};
    if (!name.trim()) nextErrors.name = 'Informe o nome do item.';
    else if (name.trim().length > 80) nextErrors.name = 'Use até 80 caracteres.';
    if (description.trim().length > 200) nextErrors.description = 'Use até 200 caracteres.';
    if (!finalCategory) nextErrors.category = 'Escolha ou crie uma categoria.';
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0 || parsedPrice > MAX_PRICE) nextErrors.price = 'Informe um preço válido.';
    if (link && !/^https:\/\/\S+$/i.test(link)) nextErrors.image = 'O link da foto precisa começar com https://';
    if (!file && !link && !item?.image) nextErrors.image = 'Envie uma foto ou informe um link https.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      const saved = await saveMenuItem(
        establishmentId,
        {
          name: name.trim(),
          description: description.trim(),
          categoryName: finalCategory,
          priceCents: Math.round(parsedPrice * 100),
          available,
          ...(link && { imageUrl: link }),
        },
        item?.id,
      );
      if (file) await uploadMenuItemPhoto(establishmentId, saved.id, file);
      notify(item ? `${name.trim()} atualizado` : `${name.trim()} adicionado ao cardápio`);
      onClose();
    } catch (error) {
      setErrors({
        image: isApiError(error) && ['UNSUPPORTED_IMAGE', 'FILE_TOO_LARGE'].includes(error.code) ? error.message : undefined,
        form: errorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={item ? 'Editar item' : 'Novo item'} onClose={onClose} width="md">
      <form onSubmit={event => void handleSubmit(event)} className="flex flex-col gap-4" noValidate>
        <FormField label="Nome" htmlFor="item-name" error={errors.name}>
          <input id="item-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="Ex: X-Burger" className={PANEL_INPUT_CLASS} />
        </FormField>
        <FormField label="Descrição" htmlFor="item-description" error={errors.description}>
          <textarea
            id="item-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder="Ingredientes, tamanho da porção..."
            className={`${PANEL_INPUT_CLASS} resize-none`}
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Categoria" htmlFor="item-category" error={errors.category}>
            <select id="item-category" value={category} onChange={e => setCategory(e.target.value)} className={PANEL_INPUT_CLASS}>
              {categories.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
              <option value={NEW_CATEGORY}>Nova categoria…</option>
            </select>
          </FormField>
          <FormField label="Preço (R$)" htmlFor="item-price" error={errors.price}>
            <input id="item-price" value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" className={PANEL_INPUT_CLASS} />
          </FormField>
        </div>
        {category === NEW_CATEGORY && (
          <FormField label="Nome da nova categoria" htmlFor="item-new-category">
            <input id="item-new-category" value={newCategory} onChange={e => setNewCategory(e.target.value)} maxLength={40} placeholder="Ex: Sobremesas" className={PANEL_INPUT_CLASS} />
          </FormField>
        )}

        <FormField label="Foto" htmlFor="item-image" error={errors.image} hint="PNG, JPG ou WEBP até 2 MB, ou link https.">
          <div className="flex gap-3 items-start">
            <div className="w-20 h-20 rounded-xl bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
              {shownImage ? <img src={shownImage} alt="Pré-visualização" className="w-full h-full object-cover" /> : <ImagePlus size={20} className="text-muted-foreground" />}
            </div>
            <div className="flex-1 flex flex-col gap-2">
              <input
                id="item-image"
                value={imageLink}
                onChange={e => {
                  setImageLink(e.target.value.trim());
                  setFile(null);
                }}
                placeholder={file ? `Arquivo: ${file.name}` : 'https://...'}
                className={PANEL_INPUT_CLASS}
              />
              <label className="self-start cursor-pointer text-xs font-medium text-primary hover:underline">
                Enviar do computador
                <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={handleFile} className="sr-only" />
              </label>
            </div>
          </div>
        </FormField>

        <div className="flex items-center justify-between bg-muted/50 rounded-xl px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Disponível para pedido</p>
            <p className="text-xs text-muted-foreground">Itens esgotados não aparecem para o cliente.</p>
          </div>
          <Toggle checked={available} onChange={setAvailable} label="Disponível para pedido" tone="success" />
        </div>

        {errors.form && <p className="text-error text-sm">{errors.form}</p>}
        <div className="flex gap-3 mt-1">
          <button type="button" onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
            {saving ? 'Salvando…' : item ? 'Salvar alterações' : 'Adicionar item'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
