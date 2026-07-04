/**
 * XIRR — annualized money-weighted return from irregular cash flows.
 * Convention: money you put in is negative, money you get out (or the
 * portfolio's current value as a terminal flow) is positive.
 *
 * Newton-Raphson with a bisection fallback; returns null when no rate in
 * (-99%, +1000%) fits or the flows are one-sided.
 */

export interface CashFlow {
  date: string; // ISO YYYY-MM-DD
  amount: number; // any consistent unit (we use paise)
}

const MS_PER_YEAR = 365.25 * 86_400_000;

export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasNegative = flows.some((f) => f.amount < 0);
  const hasPositive = flows.some((f) => f.amount > 0);
  if (!hasNegative || !hasPositive) return null;

  const t0 = Date.parse(flows[0].date);
  const points = flows.map((f) => ({
    years: (Date.parse(f.date) - t0) / MS_PER_YEAR,
    amount: f.amount,
  }));

  const npv = (rate: number): number =>
    points.reduce((sum, p) => sum + p.amount / Math.pow(1 + rate, p.years), 0);
  const dNpv = (rate: number): number =>
    points.reduce(
      (sum, p) => sum - (p.years * p.amount) / Math.pow(1 + rate, p.years + 1),
      0,
    );

  // Newton-Raphson from a sane starting point.
  let rate = 0.1;
  for (let i = 0; i < 50; i++) {
    const value = npv(rate);
    if (Math.abs(value) < 1e-7) return clampRate(rate);
    const derivative = dNpv(rate);
    if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
    const next = rate - value / derivative;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - rate) < 1e-9) return clampRate(next);
    rate = next;
  }

  // Bisection fallback over (-0.99, 10).
  let lo = -0.99;
  let hi = 10;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null; // no sign change — no root in range
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7 || hi - lo < 1e-9) return clampRate(mid);
    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return null;
}

function clampRate(rate: number): number | null {
  return rate > -0.999 && rate < 10 ? rate : null;
}
