import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '@filafacil/shared';
import { Trim } from '../../../common/validation/transforms.js';

export class UpdateProfileDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(2, 120)
  name?: string;

  /** String vazia remove o e-mail (desde que reste outro contato). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(EMAIL_MAX_LENGTH)
  email?: string;

  /** String vazia remove o celular (desde que reste outro contato). */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(16)
  phone?: string;
}

export class CreateAddressDto {
  @Trim()
  @IsString()
  @Length(1, 40)
  label!: string;

  @Trim()
  @IsString()
  @Length(3, 160)
  street!: string;

  @Trim()
  @IsString()
  @Length(2, 80)
  city!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
