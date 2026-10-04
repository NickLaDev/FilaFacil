/** Imagem neutra para itens/estabelecimentos ainda sem foto (evita <img> quebrado). */
export const PLACEHOLDER_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#E8E3DC"/></svg>');

export const imageOrPlaceholder = (src: string | null | undefined) => src || PLACEHOLDER_IMAGE;
