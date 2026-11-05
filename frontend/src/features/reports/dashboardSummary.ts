import { directionOf } from '@/features/inventory/movementLabels';
import type { BillingPeriod, Movement, Shift } from '@/lib/api/types';
import { moneyToCents, qtyToMilli } from '@/lib/money';

export interface InventoryMovementTotals {
  inboundQtyMilli: bigint;
  outboundQtyMilli: bigint;
  inboundCents: bigint;
  outboundCents: bigint;
  missingCostCount: number;
}

export interface CashierShiftTotals {
  reportCount: number;
  cashSalesCents: bigint;
  creditSalesCents: bigint;
  cashInCents: bigint;
  cashOutCents: bigint;
}

export function summarizeCashierShifts(shifts: Array<Pick<Shift, 'id' | 'status' | 'summary'>>): CashierShiftTotals {
  const totals: CashierShiftTotals = {
    reportCount: 0,
    cashSalesCents: 0n,
    creditSalesCents: 0n,
    cashInCents: 0n,
    cashOutCents: 0n,
  };

  for (const shift of shifts) {
    if (shift.status !== 'closed' && shift.status !== 'reviewed') continue;
    totals.reportCount++;
    totals.cashSalesCents += parseCents(shift.summary.cash_sales_total, `penjualan tunai shift ${shift.id}`);
    totals.creditSalesCents += parseCents(shift.summary.credit_sales_total, `penjualan kredit shift ${shift.id}`);
    totals.cashInCents += parseCents(shift.summary.cash_in, `kas masuk shift ${shift.id}`);
    totals.cashOutCents += parseCents(shift.summary.cash_out, `kas keluar shift ${shift.id}`);
  }

  return totals;
}

export function summarizeInventoryMovements(movements: Movement[]): InventoryMovementTotals {
  const totals: InventoryMovementTotals = {
    inboundQtyMilli: 0n,
    outboundQtyMilli: 0n,
    inboundCents: 0n,
    outboundCents: 0n,
    missingCostCount: 0,
  };

  for (const movement of movements) {
    const direction = directionOf(movement);
    if (direction === 'move') continue;

    const qtyMilli = qtyToMilli(movement.qty);
    if (qtyMilli === null) throw new Error(`Kuantitas pergerakan stok ${movement.id} tidak valid.`);
    const costMatch = movement.unit_cost === null ? null : /^(\d+)(?:\.(\d{1,4}))?$/.exec(movement.unit_cost);
    if (movement.unit_cost !== null && costMatch === null) {
      throw new Error(`HPP pergerakan stok ${movement.id} tidak valid.`);
    }
    const costUnits = costMatch === null
      ? null
      : BigInt(costMatch[1] ?? '0') * 10_000n + BigInt((costMatch[2] ?? '').padEnd(4, '0'));
    const amountCents = costUnits === null ? null : (qtyMilli * costUnits + 50_000n) / 100_000n;

    if (direction === 'in') {
      totals.inboundQtyMilli += qtyMilli;
      if (amountCents === null) totals.missingCostCount++;
      else totals.inboundCents += amountCents;
    } else {
      totals.outboundQtyMilli += qtyMilli;
      if (amountCents === null) totals.missingCostCount++;
      else totals.outboundCents += amountCents;
    }
  }

  return totals;
}

function parseCents(value: string, label: string): bigint {
  const cents = moneyToCents(value);
  if (cents === null) throw new Error(`Nilai ${label} tidak valid.`);
  return cents;
}

export function sumBillingPeriods(
  periods: BillingPeriod[],
  year: number,
  month?: number,
): bigint {
  const yearPrefix = String(year);
  const monthPrefix = month === undefined ? null : `${yearPrefix}-${String(month).padStart(2, '0')}`;

  return periods.reduce((total, period) => {
    if (period.status === 'cancelled' || !period.period_month.startsWith(yearPrefix)) return total;
    if (monthPrefix && !period.period_month.startsWith(monthPrefix)) return total;
    return total + parseCents(period.sales_total, `tagihan periode ${period.id}`);
  }, 0n);
}
