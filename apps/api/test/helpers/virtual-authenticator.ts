import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64url = (data: Uint8Array | Buffer | string) => Buffer.from(data).toString('base64url');
const sha256 = (data: Uint8Array | Buffer | string) => createHash('sha256').update(data).digest();

/**
 * Autenticador de software (chave ES256 em memória) que produz as mesmas respostas JSON do navegador.
 * Permite testar o fluxo WebAuthn de ponta a ponta sem aparelho com biometria.
 */
export class VirtualAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly cose: Uint8Array;
  counter = 0;

  constructor(
    private readonly origin = 'http://localhost:5173',
    private readonly rpId = 'localhost',
    private readonly userHandle = randomBytes(16),
  ) {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x as string, 'base64url')],
        [-3, Buffer.from(jwk.y as string, 'base64url')],
      ]),
    );
  }

  get id() {
    return b64url(this.credentialId);
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private counterBytes() {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(this.counter);
    return bytes;
  }

  /** Resposta de `navigator.credentials.create` (attestation "none", usuário verificado). */
  create(options: { challenge: string; user?: { id: string } }, overrides: { origin?: string } = {}) {
    const credentialData = Buffer.concat([Buffer.alloc(16), Buffer.from([this.credentialId.length >> 8, this.credentialId.length & 0xff]), this.credentialId, this.cose]);
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([0x45]), this.counterBytes(), credentialData]);
    const attestationObject = isoCBOR.encode(new Map<string, string | Map<string, string> | Uint8Array>([['fmt', 'none'], ['attStmt', new Map<string, string>()], ['authData', authData]]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, overrides.origin)),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
    };
  }

  /** Resposta de `navigator.credentials.get`; incrementa o contador como um autenticador real. */
  get(options: { challenge: string }, overrides: { origin?: string; userVerified?: boolean; key?: KeyObject; counter?: number } = {}) {
    this.counter = overrides.counter ?? this.counter + 1;
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([overrides.userVerified === false ? 0x01 : 0x05]), this.counterBytes()]);
    const clientDataJSON = this.clientData('webauthn.get', options.challenge, overrides.origin);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), overrides.key ?? this.privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature), userHandle: b64url(this.userHandle) },
    };
  }

  static otherKey() {
    return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  }
}
