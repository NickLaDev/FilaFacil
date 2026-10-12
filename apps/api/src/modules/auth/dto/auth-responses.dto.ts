import { ApiProperty } from '@nestjs/swagger';
import type { AuthProvidersResponse, OtpChallengeResponse, OtpChannel, PaymentProviderId } from '@filafacil/shared';

export class OtpChallengeDto implements OtpChallengeResponse {
  challengeId!: string;
  @ApiProperty({ enum: ['phone', 'email'] })
  channel!: OtpChannel;
  /** Ex.: "(19) *****-9999". */
  destinationMasked!: string;
  expiresAt!: string;
  /** A partir de quando é possível pedir outro código. */
  resendAvailableAt!: string;
}

export class AuthProvidersDto implements AuthProvidersResponse {
  google!: boolean;
  apple!: boolean;
  /** Canais que entregam códigos de verificação neste ambiente. */
  codeChannels!: Record<OtpChannel, boolean>;
  @ApiProperty({ enum: ['mercadopago', 'simulated', 'none'] })
  paymentProvider!: PaymentProviderId;
}
