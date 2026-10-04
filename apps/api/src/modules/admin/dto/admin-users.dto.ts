import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PERMISSION_KEYS, USER_ROLES, USER_STATUSES, type Permission, type UserRole, type UserStatus } from '@filafacil/shared';
import { PageQueryDto } from '../../../common/pagination/page-query.dto.js';
import { Trim } from '../../../common/validation/transforms.js';

export class ListUsersQueryDto extends PageQueryDto {
  /** Nome ou e-mail. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @ApiPropertyOptional({ enum: USER_STATUSES })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: UserStatus;
}

export class UpdateUserAccessDto {
  @ApiProperty({ enum: USER_ROLES })
  @IsIn(USER_ROLES)
  role!: UserRole;

  /** Permissões compatíveis com o papel (ver catálogo em GET /admin/permissions). */
  @ApiProperty({ enum: PERMISSION_KEYS, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(PERMISSION_KEYS, { each: true })
  permissions!: Permission[];

  /** Estabelecimentos em que atendentes/gestores trabalham (obrigatório para esses papéis). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  establishmentIds?: string[];
}

export class SetUserStatusDto {
  @ApiProperty({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
  status!: UserStatus;
}

export class ListAuditQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}
