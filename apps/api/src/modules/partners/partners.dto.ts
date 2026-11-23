import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { ESTABLISHMENT_TYPES, type EstablishmentType, type PartnerApplicationStatus } from '@filafacil/shared';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { Trim } from '../../common/validation/transforms.js';

const digits = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PartnerApplicationDto {
  @Trim() @IsString() @Length(2, 80) businessName!: string;
  @IsIn(ESTABLISHMENT_TYPES) type!: EstablishmentType;
  /** CNPJ (com ou sem pontuação). */
  @digits() @Matches(/^\d{14}$/, { message: 'CNPJ deve ter 14 dígitos.' }) document!: string;
  @Trim() @IsString() @Length(2, 60) city!: string;
  @Trim() @IsString() @Length(5, 160) address!: string;
  @IsNumber() @IsLatitude() latitude!: number;
  @IsNumber() @IsLongitude() longitude!: number;
  @Matches(HHMM, { message: 'Use HH:MM.' }) opensAt!: string;
  /** "00:00" = fecha à meia-noite. */
  @Matches(HHMM, { message: 'Use HH:MM.' }) closesAt!: string;
  @Trim() @IsString() @Length(3, 120) contactName!: string;
  @Trim() @IsEmail() @MaxLength(254) contactEmail!: string;
  @digits() @Matches(/^\d{10,11}$/, { message: 'Celular com DDD (10 ou 11 dígitos).' }) contactPhone!: string;
  @IsOptional() @Trim() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdatePartnerApplicationDto extends PartialType(PartnerApplicationDto) {}

export class ListPartnerApplicationsQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['pending', 'needs_info', 'approved', 'rejected']) status?: PartnerApplicationStatus;
}

export class ApprovePartnerDto {
  @IsUUID() planId!: string;
}

export class PartnerDecisionMessageDto {
  @Trim() @IsString() @Length(10, 1000, { message: 'Explique em pelo menos 10 caracteres.' }) message!: string;
}
