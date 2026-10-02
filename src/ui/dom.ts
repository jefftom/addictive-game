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
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (it === current) continue;
    const b = it.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const vx = bx - ax;
    const vy = by - ay;
    const along = vx * dx + vy * dy;
    if (along <= 4) continue;
    const across = Math.abs(vx * dy - vy * dx);
    const score = along + across * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = it;
    }
  }
  best?.focus();
}
