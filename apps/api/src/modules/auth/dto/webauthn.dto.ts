import { IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Trim } from '../../../common/validation/transforms.js';

/** `response` é o JSON produzido por @simplewebauthn/browser; a estrutura é conferida pela biblioteca no servidor. */
export class WebAuthnRegisterVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: Record<string, unknown>;

  /** Nome do aparelho exibido na lista (ex.: "iPhone da Maria"). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  deviceName?: string;
}

export class WebAuthnLoginVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: Record<string, unknown>;
}

export class WebAuthnRegisterOptionsDto {
  /** Senha atual (contas com senha) para confirmar a identidade antes de ativar a biometria. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  /** Contas sem senha: desafio e código recebidos em `POST /auth/webauthn/register/code`. */
  @IsOptional()
  @IsUUID()
  challengeId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code?: string;
}
