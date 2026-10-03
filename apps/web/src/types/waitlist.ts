export type WaitlistStatus = 'waiting' | 'notified';

export interface WaitlistEntry {
  id: string;
  establishmentId: string;
  name: string;
  phone: string;
  partySize: number;
  joinedAt: string;
  status: WaitlistStatus;
  notifiedAt?: string;
  notifiedTableLabel?: string;
}
