import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { maskCpf, onlyDigits } from '@filafacil/shared';
import { AppConfig } from '../../config/app-config.js';
import { hmacSha256Hex } from '../../common/crypto/hashing.js';

const VERSION = 'v1';

/**
 * Proteção do CPF (dado pessoal sensível, LGPD):
 * - `hash`: HMAC-SHA256 com segredo próprio → unicidade e busca exata sem guardar o CPF em claro
 *   (sem o segredo, não dá para testar CPFs por força bruta contra o banco);
 * - `encrypt`: AES-256-GCM com IV aleatório → recuperar o número só quando houver necessidade legítima;
 * - `mask`: versão exibível. Nenhum endpoint devolve o CPF completo.
 */
@Injectable()
export class CpfProtector {
  private readonly key: Buffer;

  constructor(private readonly config: AppConfig) {
    this.key = Buffer.from(config.env.CPF_ENCRYPTION_KEY, 'base64');
  }

  normalize(cpf: string) {
    return onlyDigits(cpf);
  }

  hash(cpf: string) {
    return hmacSha256Hex(this.config.env.CPF_HMAC_SECRET, this.normalize(cpf));
  }

  mask(cpf: string) {
    return maskCpf(cpf);
  }

  encrypt(cpf: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(this.normalize(cpf), 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
  }

  decrypt(payload: string) {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== VERSION || !iv || !tag || !data) throw new Error('Formato de CPF cifrado desconhecido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }
}
