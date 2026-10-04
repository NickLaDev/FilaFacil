import { AppConfig } from '../../config/app-config.js';
import { parseEnv } from '../../config/env.js';
import { CpfProtector } from './cpf-protector.service.js';

describe('proteção do CPF', () => {
  const protector = new CpfProtector(new AppConfig(parseEnv(process.env)));

  it('gera o mesmo HMAC para o CPF com ou sem máscara (unicidade)', () => {
    expect(protector.hash('529.982.247-25')).toBe(protector.hash('52998224725'));
    expect(protector.hash('52998224725')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('cifra com IV aleatório e decifra de volta', () => {
    const first = protector.encrypt('52998224725');
    const second = protector.encrypt('52998224725');
    expect(first).not.toBe(second);
    expect(first).not.toContain('52998224725');
    expect(protector.decrypt(first)).toBe('52998224725');
  });

  it('expõe só a versão mascarada', () => {
    expect(protector.mask('52998224725')).toBe('***.***.247-25');
  });
});
