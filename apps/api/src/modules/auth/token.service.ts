import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { AppConfig } from '../../config/app-config.js';

const ISSUER = 'filafacil-api';
const AUDIENCE = 'filafacil-web';

export interface AccessTokenPayload {
  userId: string;
  sessionId: string;
}

/** Access token curto (JWT HS256). A validade real depende também da sessão no banco. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.env.JWT_ACCESS_SECRET);
  }

  signAccessToken({ userId, sessionId }: AccessTokenPayload) {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      return null;
    }
  }
}
