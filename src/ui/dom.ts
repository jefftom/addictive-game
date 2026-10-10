export function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(sel);
  if (!found) throw new Error(`Missing element ${sel}`);
  return found;
}

export function pips(level: number, max: number, next = -1): string {
  let out = '<span class="pips">';
  for (let i = 0; i < max; i++) out += `<i class="${i < level ? 'on' : ''}${i === next ? ' next' : ''}"></i>`;
  return `${out}</span>`;
}

export function focusables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]')).filter(
    (e) => e.offsetParent !== null,
  );
}

/** Rect fields moveFocus reads (DOMRect satisfies it). */
export interface FocusRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Spatial-navigation score of moving from `a` to `b` in direction (dx, dy); lower is
 * better, Infinity when `b` is not in that direction. The sideways cost uses the gap
 * between the two rects (0 when they overlap), so a wide button never outranks the row
 * directly under it just because their centres line up.
 */
export function focusScore(a: FocusRect, b: FocusRect, dx: number, dy: number): number {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const vx = b.left + b.width / 2 - ax;
  const vy = b.top + b.height / 2 - ay;
  const along = vx * dx + vy * dy;
  if (along <= 4) return Infinity;
  const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1);
  const xGap = gap(a.left, a.left + a.width, b.left, b.left + b.width);
  const yGap = gap(a.top, a.top + a.height, b.top, b.top + b.height);
  // Edge-to-edge distance along the move, and the sideways offset across it.
  const alongGap = dy !== 0 ? yGap : xGap;
  const sideGap = dy !== 0 ? xGap : yGap;
  const across = Math.abs(vx * dy - vy * dx);
  // Centre distances only break ties (e.g. between two buttons under a wide one).
  return alongGap + sideGap * 2.2 + (along + across) * 0.05;
}

/** Moves focus to the nearest focusable in a direction (spatial navigation). */
export function moveFocus(root: ParentNode, dx: number, dy: number): void {
  const items = focusables(root);
  if (items.length === 0) return;
  const current = document.activeElement as HTMLElement | null;
  if (!current || !items.includes(current)) {
    items[0]!.focus();
    return;
  }
  const a = current.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (it === current) continue;
    const score = focusScore(a, it.getBoundingClientRect(), dx, dy);
    if (score < bestScore) {
      bestScore = score;
      best = it;
    }
  }
  best?.focus();
}
