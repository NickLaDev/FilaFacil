import { Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { MeModule } from '../me/me.module.js';
import { AccountController } from './account.controller.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CpfProtector } from './cpf-protector.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { createOAuthProviders, OAUTH_PROVIDERS } from './oauth/oauth-provider.js';
import { OAuthService } from './oauth/oauth.service.js';
import { OtpService } from './otp.service.js';
import { PasswordHasher } from './password-hasher.service.js';
import { SessionService } from './session.service.js';
import { WebAuthnController } from './webauthn.controller.js';
import { WebAuthnService } from './webauthn.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [MeModule],
  controllers: [AuthController, AccountController, WebAuthnController],
  providers: [
    AuthService,
    AccountDeletionService,
    WebAuthnService,
    SessionService,
    TokenService,
    PasswordHasher,
    CpfProtector,
    OtpService,
    LoginAttemptsService,
    OAuthService,
    { provide: OAUTH_PROVIDERS, inject: [AppConfig], useFactory: createOAuthProviders },
  ],
  exports: [SessionService, TokenService, PasswordHasher, CpfProtector],
})
export class AuthModule {}
