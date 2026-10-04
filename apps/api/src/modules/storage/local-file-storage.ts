import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { FileStorage } from './file-storage.js';

/** Prefixo público das imagens servidas pela API (ver main.ts). */
export const UPLOADS_URL_PREFIX = '/api/uploads/';

// Chave gerada pelo servidor: nome imprevisível, sem caminho e sem extensão vinda do cliente.
const KEY_PATTERN = /^[a-f0-9]{32}\.(webp|png|jpg)$/;

export class LocalFileStorage extends FileStorage {
  readonly directory: string;

  constructor(directory: string) {
    super();
    this.directory = resolve(directory);
  }

  async save(content: Buffer, extension: string) {
    const key = `${randomBytes(16).toString('hex')}.${extension}`;
    await mkdir(this.directory, { recursive: true });
    // `wx` falha se o arquivo existir: nunca sobrescreve outro upload.
    await writeFile(this.pathFor(key), content, { flag: 'wx', mode: 0o640 });
    return { key, url: `${UPLOADS_URL_PREFIX}${key}` };
  }

  async delete(key: string) {
    await unlink(this.pathFor(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  /** Recusa qualquer chave fora do padrão: impede path traversal (../) e acesso a outros arquivos. */
  private pathFor(key: string) {
    if (!KEY_PATTERN.test(key)) throw new Error('Chave de arquivo inválida.');
    const path = join(this.directory, key);
    if (!path.startsWith(this.directory + sep)) throw new Error('Chave de arquivo inválida.');
    return path;
  }
}
