import { COMBO_MULTS, COMBO_TIERS, comboMult, comboTier } from '../game/combo';
import { ENEMIES } from '../game/content/enemies';
import { PASSIVES } from '../game/content/passives';
import { WEAPONS } from '../game/content/weapons';
import type { EnemyKind, PassiveId } from '../game/types';
import type { World } from '../game/world';
import { TAU, clamp, formatNumber, formatTime } from '../core/math';
import { FONT_BODY, FONT_DISPLAY, FONT_MONO, PAL } from './palette';

export interface HudState {
  bestScore: number;
  touch: boolean;
  fps: number;
  showFps: boolean;
  xpFlash: number;
  hpFlash: number;
  comboBreak: { value: number; t: number } | null;
  dashButton: { x: number; y: number; r: number };
  stick: { active: boolean; ox: number; oy: number; x: number; y: number };
  /** Reserved space at the top-right for the DOM pause button (device px). */
  pauseInset: number;
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, fill: string, back: string, glow = 0): void {
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  if (k > 0) {
    if (glow > 0) {
      ctx.shadowColor = fill;
      ctx.shadowBlur = glow;
    }
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w * clamp(k, 0, 1), h);
    ctx.shadowBlur = 0;
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, world: World, w: number, h: number, ui: number, st: HudState): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  const m = 16 * ui;
  const p = world.player;
  const stats = world.stats;

  // ── XP bar (full width, top) ──
  const xpH = 6 * ui;
  bar(ctx, 0, 0, w, xpH, world.xp / world.xpNext, PAL.xp, 'rgba(69,232,255,0.12)', 12 * ui);
  if (st.xpFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${st.xpFlash * 0.8})`;
    ctx.fillRect(0, 0, w, xpH);
  }

  // ── Top-left: level, HP, dash ──
  let y = xpH + 12 * ui;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `800 ${13 * ui}px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAL.xp;
  ctx.fillText(`LV ${world.level}`, m, y);
  y += 20 * ui;

  const hpW = 190 * ui;
  const hpH = 12 * ui;
  const hpK = p.hp / stats.maxHp;
  const low = hpK < 0.3;
  bar(ctx, m, y, hpW, hpH, hpK, low ? '#ff2d55' : PAL.hp, PAL.hpBack, 10 * ui);
  if (st.hpFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${st.hpFlash})`;
    ctx.fillRect(m, y, hpW, hpH);
  }
  ctx.font = `700 ${10 * ui}px ${FONT_MONO}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.ceil(p.hp)} / ${stats.maxHp}`, m + hpW - 4 * ui, y + 1.5 * ui);
  ctx.textAlign = 'left';
  y += hpH + 8 * ui;

  // Dash charges.
  const pip = 9 * ui;
  for (let i = 0; i < stats.dashCharges; i++) {
    const cx = m + pip + i * pip * 2.6;
    const cy = y + pip;
    const ready = i < p.dashCharges;
    ctx.beginPath();
    ctx.moveTo(cx, cy - pip);
    ctx.lineTo(cx + pip, cy);
    ctx.lineTo(cx, cy + pip);
    ctx.lineTo(cx - pip, cy);
    ctx.closePath();
    ctx.lineWidth = 1.5 * ui;
    ctx.strokeStyle = '#c9b8ff';
    ctx.stroke();
    if (ready) {
      ctx.shadowColor = '#c9b8ff';
      ctx.shadowBlur = 10 * ui;
      ctx.fillStyle = '#e6deff';
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (i === Math.floor(p.dashCharges) && stats.dashCooldown > 0) {
      const k = 1 - Math.max(0, p.dashRecharge) / stats.dashCooldown;
      ctx.save();
      ctx.clip();
      ctx.fillStyle = 'rgba(201,184,255,0.45)';
      ctx.fillRect(cx - pip, cy + pip - pip * 2 * k, pip * 2, pip * 2 * k);
      ctx.restore();
    }
  }
  ctx.font = `600 ${10 * ui}px ${FONT_BODY}`;
  ctx.fillStyle = PAL.textDim;
  ctx.fillText(st.touch ? 'DASH' : 'SPACE  DASH', m + stats.dashCharges * pip * 2.6 + 4 * ui, y + pip * 0.45);
  if (world.hasRelic('shield')) {
    ctx.fillStyle = p.shieldReady ? '#7ff9ff' : 'rgba(127,249,255,0.3)';
    ctx.fillText(p.shieldReady ? '⬡ SHIELD' : `⬡ ${Math.ceil(20 - p.shieldT)}s`, m + 110 * ui, y + pip * 0.45);
  }
  y += pip * 2 + 10 * ui;

  // Build icons.
  const box = 26 * ui;
  let x = m;
  for (const wpn of world.build.weapons) {
    const def = WEAPONS[wpn.id];
    ctx.fillStyle = 'rgba(10,8,30,0.7)';
    ctx.fillRect(x, y, box, box);
    ctx.lineWidth = 1.5 * ui;
    ctx.strokeStyle = wpn.evolved ? PAL.gold : def.color;
    ctx.strokeRect(x + 0.5, y + 0.5, box - 1, box - 1);
    ctx.font = `700 ${15 * ui}px ${FONT_BODY}`;
    ctx.fillStyle = wpn.evolved ? PAL.gold : def.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, x + box / 2, y + box / 2 + 1 * ui);
    // level pips
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = wpn.evolved || i < wpn.level ? (wpn.evolved ? PAL.gold : def.color) : 'rgba(255,255,255,0.15)';
      ctx.fillRect(x + 2 * ui + i * ((box - 4 * ui) / 5), y + box + 2 * ui, (box - 4 * ui) / 5 - 1.5 * ui, 2.5 * ui);
    }
    x += box + 6 * ui;
  }
  x = m;
  y += box + 9 * ui;
  const pbox = 19 * ui;
  for (const id of Object.keys(world.build.passives) as PassiveId[]) {
    const def = PASSIVES[id];
    const lvl = world.build.passives[id] ?? 0;
    ctx.fillStyle = 'rgba(10,8,30,0.7)';
    ctx.fillRect(x, y, pbox, pbox);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1 * ui;
    ctx.strokeRect(x + 0.5, y + 0.5, pbox - 1, pbox - 1);
    ctx.font = `700 ${11 * ui}px ${FONT_BODY}`;
    ctx.fillStyle = def.color;
    ctx.fillText(def.icon, x + pbox / 2, y + pbox / 2);
    ctx.font = `700 ${8 * ui}px ${FONT_MONO}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(lvl), x + pbox - 3 * ui, y + pbox - 3 * ui);
    x += pbox + 4 * ui;
  }
  for (const id of world.build.relics) {
    ctx.font = `700 ${12 * ui}px ${FONT_BODY}`;
    ctx.fillStyle = PAL.gold;
    ctx.fillText('◆', x + pbox / 2, y + pbox / 2);
    x += pbox * 0.8;
    void id;
  }

  // ── Top-centre: timer / boss ──
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `700 ${28 * ui}px ${FONT_MONO}`;
  ctx.fillStyle = world.victory ? PAL.gold : PAL.text;
  ctx.fillText(formatTime(world.time), w / 2, xpH + 10 * ui);
  const boss = world.boss;
  if (boss && !boss.dead) {
    const bw = Math.min(460 * ui, w * 0.5);
    const by = xpH + 64 * ui;
    ctx.font = `800 ${12 * ui}px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#ff6b8a';
    ctx.fillText(nameOf(boss.kind).toUpperCase(), w / 2, by - 18 * ui);
    bar(ctx, w / 2 - bw / 2, by, bw, 9 * ui, boss.hp / boss.maxHp, '#ff2d55', 'rgba(255,45,85,0.15)', 14 * ui);
  } else {
    const next = world.nextBoss();
    if (next) {
      const left = next.at - world.time;
      ctx.font = `600 ${11 * ui}px ${FONT_MONO}`;
      ctx.fillStyle = left < 20 ? '#ff6b8a' : PAL.textDim;
      ctx.fillText(`${next.name.replace('The ', '').toUpperCase()} IN ${formatTime(left)}`, w / 2, xpH + 44 * ui);
    }
  }

  // ── Top-right: score, best, combo ──
  const rx = w - m - st.pauseInset;
  ctx.textAlign = 'right';
  ctx.font = `700 ${24 * ui}px ${FONT_MONO}`;
  const beating = st.bestScore > 0 && world.score > st.bestScore;
  ctx.fillStyle = beating ? PAL.gold : PAL.text;
  if (beating) {
    ctx.shadowColor = PAL.gold;
    ctx.shadowBlur = 12 * ui;
  }
  ctx.fillText(formatNumber(world.score), rx, xpH + 10 * ui);
  ctx.shadowBlur = 0;
  ctx.font = `600 ${11 * ui}px ${FONT_MONO}`;
  if (st.bestScore > 0) {
    ctx.fillStyle = beating ? PAL.gold : PAL.textDim;
    ctx.fillText(beating ? '★ NEW BEST' : `BEST ${formatNumber(st.bestScore)}`, rx, xpH + 40 * ui);
    if (!beating) bar(ctx, rx - 110 * ui, xpH + 56 * ui, 110 * ui, 2 * ui, world.score / st.bestScore, 'rgba(255,201,60,0.8)', 'rgba(255,255,255,0.08)');
  }

  // Combo.
  const cy = xpH + 72 * ui;
  if (world.combo > 0) {
    const tier = comboTier(world.combo);
    const color = PAL.combo[tier] ?? '#fff';
    const mult = comboMult(world.combo);
    ctx.font = `900 ${34 * ui}px ${FONT_DISPLAY}`;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 16 * ui;
    ctx.fillText(`×${mult}`, rx, cy);
    ctx.shadowBlur = 0;
    ctx.font = `700 ${14 * ui}px ${FONT_MONO}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${world.combo} COMBO`, rx, cy + 40 * ui);
    bar(ctx, rx - 120 * ui, cy + 60 * ui, 120 * ui, 3 * ui, world.comboTimer / stats.comboWindow, color, 'rgba(255,255,255,0.1)');
    if (tier < COMBO_TIERS.length - 1) {
      ctx.font = `600 ${10 * ui}px ${FONT_MONO}`;
      ctx.fillStyle = PAL.textDim;
      ctx.fillText(`×${COMBO_MULTS[tier + 1]} AT ${COMBO_TIERS[tier + 1]}`, rx, cy + 68 * ui);
    }
  }
  if (st.comboBreak && st.comboBreak.t > 0) {
    const k = st.comboBreak.t;
    ctx.globalAlpha = k;
    ctx.font = `700 ${14 * ui}px ${FONT_MONO}`;
    ctx.fillStyle = '#ff6b8a';
    ctx.fillText(`COMBO ${st.comboBreak.value} LOST`, rx + (1 - k) * 6 * ui * Math.sin(k * 40), cy + (world.combo > 0 ? 84 : 6) * ui);
    ctx.globalAlpha = 1;
  }
  if (world.overdriveT > 0) {
    ctx.font = `800 ${13 * ui}px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#ff4fd2';
    ctx.fillText(`OVERDRIVE ${world.overdriveT.toFixed(1)}`, rx, cy + 104 * ui);
  }

  // ── Touch controls ──
  if (st.touch) {
    const db = st.dashButton;
    ctx.beginPath();
    ctx.arc(db.x, db.y, db.r, 0, TAU);
    ctx.fillStyle = p.dashCharges >= 1 ? 'rgba(201,184,255,0.22)' : 'rgba(201,184,255,0.06)';
    ctx.fill();
    ctx.lineWidth = 2 * ui;
    ctx.strokeStyle = p.dashCharges >= 1 ? '#c9b8ff' : 'rgba(201,184,255,0.35)';
    ctx.stroke();
    if (p.dashCharges < stats.dashCharges && stats.dashCooldown > 0) {
      const k = 1 - Math.max(0, p.dashRecharge) / stats.dashCooldown;
      ctx.beginPath();
      ctx.arc(db.x, db.y, db.r + 5 * ui, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.strokeStyle = '#c9b8ff';
      ctx.lineWidth = 3 * ui;
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${13 * ui}px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('DASH', db.x, db.y);
    if (st.stick.active) {
      ctx.beginPath();
      ctx.arc(st.stick.ox, st.stick.oy, 56 * ui, 0, TAU);
      ctx.strokeStyle = 'rgba(127,249,255,0.35)';
      ctx.lineWidth = 2 * ui;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(st.stick.x, st.stick.y, 22 * ui, 0, TAU);
      ctx.fillStyle = 'rgba(127,249,255,0.35)';
      ctx.fill();
    }
  }

  if (st.showFps) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.font = `600 ${10 * ui}px ${FONT_MONO}`;
    ctx.fillStyle = PAL.textDim;
    ctx.fillText(`${Math.round(st.fps)} FPS · ${world.enemies.length} enemies`, m, h - 8 * ui);
  }
}

function nameOf(kind: EnemyKind): string {
  return ENEMIES[kind].name;
}
