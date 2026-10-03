export interface Address {
  id: string;
  label: string;
  street: string;
  city: string;
  isDefault: boolean;
}

export interface ClientAccount {
  id: string;
  name: string;
  /** Somente a versão mascarada; o CPF completo fica no backend. */
  cpfMasked: string;
  /** Hash irreversível usado só para impedir CPF duplicado no mock. */
  cpfFingerprint: string;
  email: string;
  phone: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  addresses: Address[];
  favoriteEstablishmentIds: string[];
  createdAt: string;
}

export type PlatformRole = 'client' | 'attendant' | 'manager' | 'admin';

export type PlatformUserStatus = 'active' | 'suspended';

export interface PlatformUser {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  permissions: string[];
  status: PlatformUserStatus;
  establishmentId?: string;
  lastAccess: string;
}

export interface PermissionChange {
  id: string;
  userId: string;
  userName: string;
  description: string;
  actor: string;
  at: string;
}
