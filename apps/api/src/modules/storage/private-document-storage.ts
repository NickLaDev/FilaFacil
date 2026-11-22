import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const KEY_PATTERN = /^[a-f0-9]{32}\.(pdf|png|jpg|webp)$/;

/** Tipos aceitos, conferidos pelo conteúdo (assinatura do arquivo), não pelo nome nem pelo Content-Type do cliente. */
export const PRIVATE_DOCUMENT_TYPES = [
  { extension: 'pdf', contentType: 'application/pdf', matches: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { extension: 'png', contentType: 'image/png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { extension: 'jpg', contentType: 'image/jpeg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { extension: 'webp', contentType: 'image/webp', matches: (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
] as const;

export const detectDocumentType = (content: Buffer) => PRIVATE_DOCUMENT_TYPES.find(type => type.matches(content)) ?? null;

/**
 * Documentos de cadastro (ficha 55): ficam numa pasta fora de /api/uploads (sem URL pública) e só saem pela rota do
 * admin, que confere a permissão. Mesma proteção de chave da pasta pública (sem path traversal).
 */
export class PrivateDocumentStorage {
  readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async save(content: Buffer, extension: string): Promise<string> {
    const key = `${randomBytes(16).toString('hex')}.${extension}`;
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    await writeFile(this.pathFor(key), content, { flag: 'wx', mode: 0o640 });
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async delete(key: string) {
    await unlink(this.pathFor(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private pathFor(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error('Chave de arquivo inválida.');
    const path = join(this.directory, key);
    if (!path.startsWith(this.directory + sep)) throw new Error('Chave de arquivo inválida.');
    return path;
  }
}
