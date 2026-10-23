import type { CreditState, CustomerStatus } from '@/lib/api/types';
import { CREDIT_CLS, CREDIT_LABEL, STATUS_CLS, STATUS_LABEL } from './creditState';

const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';

export function CustomerStatusBadge({ status }: { status: CustomerStatus }) {
  return <span className={`${base} ${STATUS_CLS[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function CreditStateBadge({ state }: { state: CreditState }) {
  return <span className={`${base} ${CREDIT_CLS[state]}`}>{CREDIT_LABEL[state]}</span>;
}
