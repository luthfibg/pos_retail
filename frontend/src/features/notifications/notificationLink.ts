import type { AppNotification } from '@/lib/api/types';

/** Tujuan saat notifikasi diklik. null = hanya ditandai terbaca. */
export function notificationTarget(n: Pick<AppNotification, 'type' | 'entity_type' | 'entity_id'>): string | null {
  if (n.type === 'customer.limit_needed' && n.entity_type === 'customer' && n.entity_id !== null) {
    return `/customers?open=${n.entity_id}`;
  }
  return null;
}

export function badgeText(unread: number): string {
  return unread > 99 ? '99+' : String(unread);
}
