import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, type OtpChannel } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class RegisterDto {
  /** Nome completo. */
  @Trim()
  @IsString()
  @Length(2, 120)
  name!: string;

  /** CPF com ou sem máscara; os dígitos verificadores são conferidos no servidor. */
  @IsString()
  @Length(11, 14)
  cpf!: string;

  /** Obrigatório para cadastro por e-mail (junto com a senha). */
  @IsOptional()
  @Trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  /** Mínimo 8 caracteres, com letra e número. */
  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password?: string;

  /** Celular com DDD (cadastro por celular entra depois com código por SMS). */
  @IsOptional()
  @IsString()
  @Length(10, 16)
  phone?: string;

  @ApiProperty({ example: true })
  @Equals(true, { message: 'É preciso aceitar os termos de uso.' })
  acceptTerms!: boolean;

  @IsOptional()
  @IsBoolean()
  marketingOptIn?: boolean;
}

export class LoginDto {
  @Trim()
  @IsEmail()
  @MaxLength(EMAIL_MAX_LENGTH)
  email!: string;

  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password!: string;
}

export class OtpRequestDto {
  @ApiProperty({ enum: ['phone', 'email'] })
  @IsIn(['phone', 'email'])
  channel!: OtpChannel;

  /** Celular com DDD ou e-mail da conta. */
  @Trim()
  @IsString()
  @Length(5, EMAIL_MAX_LENGTH)
  destination!: string;
}

export class OtpVerifyDto {
  @IsUUID()
  challengeId!: string;

  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code!: string;
}

export class ContactVerificationRequestDto {
  @ApiProperty({ enum: ['phone', 'email'] })
  @IsIn(['phone', 'email'])
  channel!: OtpChannel;
}

export class ContactVerificationConfirmDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code!: string;
}

export class PasswordResetRequestDto extends OtpRequestDto {}

export class PasswordResetConfirmDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code!: string;

  /** Mínimo 8 caracteres, com letra e número. */
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

export class DeleteAccountDto {
  /** Senha atual (contas com senha). */
  @IsOptional()
  @IsString()
  @Length(1, PASSWORD_MAX_LENGTH)
  password?: string;

  /** Alternativa à senha: desafio e código recebidos em `POST /me/delete-account/code`. */
  @IsOptional()
  @IsUUID()
  challengeId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos.' })
  code?: string;
}
