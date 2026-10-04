import { ApiProperty } from '@nestjs/swagger';
import {
  ESTABLISHMENT_STATUSES,
  ESTABLISHMENT_TYPES,
  PERMISSION_KEYS,
  PLAN_FEATURES,
  USER_ROLES,
  USER_STATUSES,
  type AdminEstablishmentDto,
  type AdminEstablishmentsPage,
  type AdminUserDto,
  type AdminUsersPage,
  type EstablishmentPhotoDto,
  type EstablishmentStatus,
  type EstablishmentType,
  type OrganizationDto,
  type Page,
  type Permission,
  type PermissionAuditAction,
  type PermissionAuditDto,
  type PlanDto,
  type PlanFeature,
  type UserRole,
  type UserStatus,
} from '@filafacil/shared';
import { PlanLimitsDto } from '../../establishments/dto/establishment-plan.dto.js';
import { OpeningHourResponseDto } from '../../restaurants/dto/restaurants-responses.dto.js';

export class OrganizationResponseDto implements OrganizationDto {
  id!: string;
  name!: string;
}

export class PlanSummaryDto {
  id!: string;
  name!: string;
}

export class EstablishmentPhotoResponseDto implements EstablishmentPhotoDto {
  id!: string;
  url!: string;
}

export class AdminEstablishmentResponseDto implements AdminEstablishmentDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: ESTABLISHMENT_TYPES })
  type!: EstablishmentType;
  @ApiProperty({ enum: ESTABLISHMENT_STATUSES })
  status!: EstablishmentStatus;
  city!: string;
  address!: string;
  latitude!: number;
  longitude!: number;
  timezone!: string;
  organization!: OrganizationResponseDto;
  plan!: PlanSummaryDto;
  foodCategories!: string[];
  tags!: string[];
  averageWaitMinutes!: number;
  ordersPaused!: boolean;
  highDemand!: boolean;
  rating!: number;
  ratingCount!: number;
  @ApiProperty({ type: [OpeningHourResponseDto] })
  openingHours!: OpeningHourResponseDto[];
  @ApiProperty({ type: [EstablishmentPhotoResponseDto] })
  photos!: EstablishmentPhotoResponseDto[];
  managerNames!: string[];
  createdAt!: string;
}

export class EstablishmentCountsDto {
  all!: number;
  active!: number;
  inactive!: number;
  suspended!: number;
}

export class AdminEstablishmentsPageDto implements AdminEstablishmentsPage {
  @ApiProperty({ type: [AdminEstablishmentResponseDto] })
  items!: AdminEstablishmentResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
  counts!: EstablishmentCountsDto;
}

export class UserMembershipDto {
  establishmentId!: string;
  establishmentName!: string;
}

export class AdminUserResponseDto implements AdminUserDto {
  id!: string;
  name!: string;
  email!: string | null;
  phone!: string | null;
  @ApiProperty({ enum: USER_ROLES })
  role!: UserRole;
  @ApiProperty({ enum: USER_STATUSES })
  status!: UserStatus;
  @ApiProperty({ enum: PERMISSION_KEYS, isArray: true })
  permissions!: Permission[];
  @ApiProperty({ type: [UserMembershipDto] })
  memberships!: UserMembershipDto[];
  lastAccessAt!: string | null;
  createdAt!: string;
}

export class UserCountsDto {
  all!: number;
  client!: number;
  attendant!: number;
  manager!: number;
  admin!: number;
}

export class AdminUsersPageDto implements AdminUsersPage {
  @ApiProperty({ type: [AdminUserResponseDto] })
  items!: AdminUserResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
  counts!: UserCountsDto;
}

const AUDIT_ACTIONS: PermissionAuditAction[] = ['role_changed', 'permissions_changed', 'memberships_changed', 'suspended', 'reactivated'];

export class PermissionAuditResponseDto implements PermissionAuditDto {
  id!: string;
  targetUserId!: string;
  targetUserName!: string;
  /** Quem alterou. */
  actorName!: string;
  @ApiProperty({ enum: AUDIT_ACTIONS })
  action!: PermissionAuditAction;
  description!: string;
  /** Estado anterior. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  before!: unknown;
  /** Estado posterior. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  after!: unknown;
  createdAt!: string;
}

export class PermissionAuditPageDto implements Page<PermissionAuditResponseDto> {
  @ApiProperty({ type: [PermissionAuditResponseDto] })
  items!: PermissionAuditResponseDto[];
  page!: number;
  pageSize!: number;
  total!: number;
}

export class PlanResponseDto implements PlanDto {
  id!: string;
  name!: string;
  monthlyPriceCents!: number;
  @ApiProperty({ type: PlanLimitsDto })
  limits!: PlanLimitsDto;
  @ApiProperty({ enum: PLAN_FEATURES, isArray: true })
  features!: PlanFeature[];
  /** Quantos estabelecimentos usam o plano. */
  establishmentCount!: number;
}
