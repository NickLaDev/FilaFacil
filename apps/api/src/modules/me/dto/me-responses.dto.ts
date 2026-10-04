import { ApiProperty } from '@nestjs/swagger';
import {
  ESTABLISHMENT_STATUSES,
  PERMISSION_KEYS,
  USER_ROLES,
  USER_STATUSES,
  type AddressDto,
  type AuthUser,
  type EstablishmentStatus,
  type MeResponse,
  type Permission,
  type StaffMembership,
  type UserRole,
  type UserStatus,
} from '@filafacil/shared';

export class AuthUserDto implements AuthUser {
  id!: string;
  name!: string;
  email!: string | null;
  phone!: string | null;
  /** Só a versão mascarada: o CPF completo nunca sai da API. */
  cpfMasked!: string | null;
  @ApiProperty({ enum: USER_ROLES })
  role!: UserRole;
  @ApiProperty({ enum: USER_STATUSES })
  status!: UserStatus;
  emailVerified!: boolean;
  phoneVerified!: boolean;
  @ApiProperty({ enum: PERMISSION_KEYS, isArray: true })
  permissions!: Permission[];
  createdAt!: string;
}

export class StaffMembershipDto implements StaffMembership {
  establishmentId!: string;
  establishmentName!: string;
  @ApiProperty({ enum: ESTABLISHMENT_STATUSES })
  establishmentStatus!: EstablishmentStatus;
  address!: string;
  organizationId!: string;
  organizationName!: string;
}

export class MeResponseDto implements MeResponse {
  user!: AuthUserDto;
  @ApiProperty({ type: [StaffMembershipDto] })
  memberships!: StaffMembershipDto[];
}

export class AddressResponseDto implements AddressDto {
  id!: string;
  label!: string;
  street!: string;
  city!: string;
  isDefault!: boolean;
}
