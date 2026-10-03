export type OrderStatus = 'received' | 'paid' | 'preparing' | 'ready' | 'delivered';

export type PaymentMethod = 'pix' | 'credit' | 'debit';

export interface OrderLine {
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  notes: string;
}

export interface Order {
  id: string;
  number: number;
  accountId: string;
  establishmentId: string;
  establishmentName: string;
  tableId?: string;
  tableLabel?: string;
  lines: OrderLine[];
  total: number;
  paymentMethod: PaymentMethod;
  transactionId: string;
  pickupPoint: string;
  pickupCode: string;
  createdAt: string;
  /** Pedidos históricos do seed já nascem entregues. */
  completed?: boolean;
}
