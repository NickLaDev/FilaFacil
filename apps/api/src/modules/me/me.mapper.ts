import { isPermission, type AuthUser, type StaffMembership } from '@filafacil/shared';
import type { Prisma } from '../../generated/prisma/client.js';

export const ME_INCLUDE = {
  permissions: { select: { permission: true } },
  memberships: {
    orderBy: { createdAt: 'asc' },
    select: {
      establishment: {
        select: { id: true, name: true, status: true, address: true, organization: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof ME_INCLUDE }>;

export function toAuthUser(user: UserWithAccess): AuthUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    cpfMasked: user.cpfMasked,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
    permissions: user.permissions.map(p => p.permission).filter(isPermission),
    createdAt: user.createdAt.toISOString(),
  };
}

export function toMemberships(user: UserWithAccess): StaffMembership[] {
  return user.memberships.map(({ establishment }) => ({
    establishmentId: establishment.id,
    establishmentName: establishment.name,
    establishmentStatus: establishment.status,
    address: establishment.address,
    organizationId: establishment.organization.id,
    organizationName: establishment.organization.name,
  }));
}
