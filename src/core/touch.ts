/** Touch geometry is in CSS pixels, independent of HUD and world resolution. */
export const TOUCH_RADIUS = 52;

export function touchVector(dx: number, dy: number, radius: number): { mx: number; my: number } {
  const distance = Math.hypot(dx, dy), dead = radius * 0.18;
  if (distance <= dead || radius <= 0) return { mx: 0, my: 0 };
  const strength = Math.min(1, (distance - dead) / (radius - dead));
  return { mx: dx / distance * strength, my: dy / distance * strength };
}

export function dashLayout(width: number, height: number, dpr: number, right = 0, bottom = 0) {
  return { x: (width - right - 62) * dpr, y: (height - bottom - 82) * dpr, r: 38 * dpr };
}
