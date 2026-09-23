// Display rounding: nearest $10 for monthly figures, nearest $100 for annual figures.

export function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export function usd(n: number): string {
  const r = Math.round(n);
  const s = Math.abs(r).toLocaleString('en-US');
  return r < 0 ? `-$${s}` : `$${s}`;
}

export const yr = (n: number) => usd(roundTo(n, 100));
export const mo = (n: number) => usd(roundTo(n / 12, 10));

/** "$12,300/yr ($1,030/mo)" */
export const both = (n: number) => `${yr(n)}/yr (${mo(n)}/mo)`;

export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const CLASS_LABEL: Record<string, string> = {
  observed: 'Observed',
  modeled: 'Modeled',
  assumption: 'Assumption',
  input: 'Your input',
  derived: 'Derived',
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
