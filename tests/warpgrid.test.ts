import { describe, expect, it, vi } from 'vitest';
import { GRID_MAX_POINTS, GRID_TINTS, WarpGrid, coolRGB, gridSpacingFor } from '../src/render/warpgrid';
import { gridEvent, gridFrame, type GridWorldView } from '../src/render/gridfx';
import { ZOOM_MAX } from '../src/game/content/coop';
import type { GameEvent } from '../src/game/types';

class RecordingContext {
  globalAlpha = 1;
  strokeStyle = '';
  peak = 0;
  minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
  setTransform() {}
  beginPath() {}
  moveTo(x: number, y: number) { this.point(x, y); }
  lineTo(x: number, y: number) { this.point(x, y); }
  quadraticCurveTo(x: number, y: number, x2: number, y2: number) { this.point(x, y); this.point(x2, y2); }
  private point(x: number, y: number) {
    this.minX = Math.min(this.minX, x); this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y); this.maxY = Math.max(this.maxY, y);
  }
  stroke() {
    const rgb = this.strokeStyle.match(/\d+/g)!.map(Number);
    this.peak = Math.max(this.peak, this.globalAlpha * Math.max(...rgb) / 255);
  }
  get ctx() { return this as unknown as CanvasRenderingContext2D; }
}
const DT = 1 / 60;
function setup() { const g = new WarpGrid(); g.resize(1426, 828); g.update(0, 0, 0); return g; }
function draw(g: WarpGrid, c: RecordingContext, beat = 0) { g.draw(c.ctx, 0, 0, 1.4057, 1920, 1080, GRID_TINTS[0], beat); }
function frames(g: WarpGrid, force: (n: number) => void, count = 120) {
  const c = new RecordingContext();
  for (let i = 0; i < count; i++) { force(i); g.update(DT, 0, 0, DT); draw(g, c); }
  return c.peak;
}
function boss(g: WarpGrid) { g.impulse(0, 0, 260, 900, 5); g.shock(0, 0, 1500, 5200, 1000, 5, 1, 80); }

describe('grid readability', () => {
  it('keeps the resting lattice faint, even on the beat', () => {
    const g = setup(), c = new RecordingContext(); draw(g, c);
    expect(c.peak).toBeLessThanOrEqual(0.076); draw(g, c, 1);
    expect(c.peak).toBeLessThanOrEqual(0.121);
  });
  it('caps a sustained ordinary kill storm at permit 2', () => {
    const g = setup(); let seed = 17;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    expect(frames(g, () => { for (let j = 0; j < 2; j++) g.impulse((random() - 0.5) * 1200, (random() - 0.5) * 700, 120, 340, 2); })).toBeLessThanOrEqual(0.181);
  });
  it('caps elite fronts without a flare', () => {
    const g = setup(); g.impulse(0, 0, 160, 420, 4); g.shock(0, 0, 240, 2600, 750, 4);
    expect(frames(g, () => {})).toBeLessThanOrEqual(0.291);
  });
  it('caps a sustained gravity well', () => {
    const g = setup();
    expect(frames(g, () => g.implode(0, 0, 320, 4200, DT, 0.6))).toBeLessThanOrEqual(0.246);
  });
  it('allows a brief capital front above ordinary brightness', () => {
    const g = setup(); boss(g); const peak = frames(g, () => {});
    expect(peak).toBeGreaterThan(0.35); expect(peak).toBeLessThanOrEqual(0.541);
  });
  it('removes the capital flare with reduced flashing', () => {
    const g = setup(); g.maxLevel = 3; g.flareAllowed = false; g.beatPulse = 0; boss(g);
    expect(frames(g, () => {})).toBeLessThanOrEqual(0.246); expect(g.flare).toBe(0);
  });
  it('merges nearby impulses and applies only eight separated kicks', () => {
    const g = setup();
    for (let i = 0; i < 60; i++) g.impulse(i * 100, 0, 100, 300 + i);
    expect(g.impulsesIn).toBe(60); g.update(DT, 0, 0); expect(g.impulsesApplied).toBe(8);
    for (let i = 0; i < 100; i++) g.impulse(10, 10, 100, 300);
    g.update(DT, 0, 0); expect(g.impulsesApplied).toBe(1);
  });
  it('makes motion zero glow without displacement', () => {
    const g = setup(); g.motion = 0; boss(g); g.wake(-100, 0, 100, 0, 420);
    frames(g, () => g.implode(0, 0, 320, 3000, DT), 30);
    const data = g as unknown as { dx: Float32Array; dy: Float32Array };
    expect([...data.dx, ...data.dy].every(v => v === 0)).toBe(true); expect(g.maxHeat).toBeGreaterThan(0.08);
  });
  it('advances fronts through hitstop but freezes them under a modal', () => {
    const g = setup(); boss(g); g.update(0, 0, 0, DT); const flare = g.flare;
    expect(flare).toBeGreaterThan(0.9); expect(g.stepsLast).toBe(0);
    for (let i = 0; i < 60; i++) g.update(0, 0, 0, 0);
    // The first frame stores its radius in Float32; recomputing flare rounds once.
    expect(g.flare).toBeCloseTo(flare, 8);
    for (let i = 0; i < 91; i++) { g.update(0, 0, 0, DT); expect(g.stepsLast).toBe(0); }
    expect(g.flare).toBe(0);
  });
  it('stops existing ripples immediately when motion is disabled live', () => {
    const g = setup(); boss(g); frames(g, () => {}, 10);
    const data = g as unknown as { dx: Float32Array; dy: Float32Array };
    expect([...data.dx].some(v => v !== 0)).toBe(true);
    g.motion = 0;
    frames(g, () => g.implode(0, 0, 320, 3000, DT), 10);
    expect([...data.dx, ...data.dy].every(v => v === 0)).toBe(true);
    expect(g.maxHeat).toBeGreaterThan(0.08);
  });
  it('resets exposure between worlds and relays on a same-count spacing change', () => {
    const g = setup(); g.exposure = 0.5; g.hotFrac = 0.8; g.reset();
    expect(g.exposure).toBe(1); expect(g.hotFrac).toBe(0);
    g.resize(100, 100, 32); g.update(0, 0, 0); boss(g); g.update(DT, 0, 0);
    const n = g.pointCount; g.resize(104, 104, 34); expect(g.pointCount).toBe(n);
    g.update(0, 0, 0); expect(g.flare).toBe(0); expect(g.spacing).toBe(34);
  });
});

describe('grid coverage and palette', () => {
  it.each([false, true])('covers displaced cameras with shake (co-op %s)', coop => {
    const g = new WarpGrid(); const z = coop ? ZOOM_MAX : 1;
    const vw = 1366 * z + 60, vh = 768 * z + 60;
    g.resize(vw, vh, gridSpacingFor(vw, vh)); g.update(0, 5200, -3100);
    if (coop) expect(g.spacing).toBe(44);
    for (const dx of [-16, 16]) for (const dy of [-16, 16]) {
      const c = new RecordingContext(); g.draw(c.ctx, 5200 + dx, -3100 + dy, 1.4057 / z, 1920, 1080, GRID_TINTS[0], 0);
      // At this rounded scale the smallest margin is 61.8 px (about 62).
      expect(c.minX).toBeLessThanOrEqual(0); expect(c.maxX).toBeGreaterThanOrEqual(1920);
      expect(c.minY).toBeLessThanOrEqual(0); expect(c.maxY).toBeGreaterThanOrEqual(1080);
    }
  });
  it('uses the smallest even spacing within budget across viewports', () => {
    // Visible world dimensions from Renderer.resize's area interpolation (before +60).
    const views = [[1366,768], [1252.002555,704.251437], [1283.51863,721.626873], [1576.33061,665.014477], [1930.602,542.9818], [455.405,1011.639], [1011.639,455.405]];
    for (const [w,h] of views) for (const z of [1, ZOOM_MAX]) {
      const vw=w*z+60, vh=h*z+60, S=gridSpacingFor(vw,vh); const g=new WarpGrid(); g.resize(vw,vh,S);
      expect(S % 2).toBe(0); expect(S).toBeGreaterThanOrEqual(32);
      if (z===1) expect(S).toBe(32);
      expect(g.pointCount).toBe((Math.ceil(vw/S)+6)*(Math.ceil(vh/S)+6)); expect(g.pointCount).toBeLessThanOrEqual(GRID_MAX_POINTS);
      if (S>32) expect((Math.ceil(vw/(S-2))+6)*(Math.ceil(vh/(S-2))+6)).toBeGreaterThan(GRID_MAX_POINTS);
    }
  });
  it('keeps every sector and warm input in the cool muted family', () => {
    const colors: string[] = [...GRID_TINTS];
    for (let h=0;h<360;h+=10) for (const s of [0.2,1]) for (const l of [0.3,0.5,0.8]) {
      const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs(h/60%2-1)), m=l-c/2;
      const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
      colors.push('#'+rgb.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join(''));
    }
    for (const color of colors) {
      const [r,g,b]=coolRGB(color).map(v=>v/255), max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min, l=(max+min)/2;
      const s=d/(1-Math.abs(2*l-1)); let h=60*(max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4); if(h<0)h+=360;
      expect(h).toBeGreaterThanOrEqual(189); expect(h).toBeLessThanOrEqual(271); expect(s).toBeLessThanOrEqual(0.46);
      expect(l).toBeGreaterThanOrEqual(0.49); expect(l).toBeLessThanOrEqual(0.71);
    }
  });
});

function spyGrid() {
  const calls = { impulse: vi.fn(), shock: vi.fn(), wake: vi.fn(), implode: vi.fn(), ring: vi.fn() };
  return { calls, grid: calls as unknown as WarpGrid };
}
const empty: GridWorldView = { players: [], enemies: [], mines: [], rings: [] };
describe('gameplay grid forces', () => {
  it('maps all event strengths, permits and front budgets', () => {
    const cases: [Record<string, unknown>, string, number[]][] = [
      [{t:'kill',r:10},'impulse',[1,2,120,340,2]],
      [{t:'kill',r:10,elite:true},'impulse',[1,2,140,420,4]],
      [{t:'kill',r:10,elite:true},'shock',[1,2,210,2600,750,4]],
      [{t:'kill',boss:true},'impulse',[1,2,240,800,5]],
      [{t:'explode',r:60},'impulse',[1,2,122,420,3]],
      [{t:'explode',r:60},'shock',[1,2,102,2000,650,3]],
      [{t:'explode',r:20},'impulse',[1,2,80,320,2]],
      [{t:'bossdead'},'impulse',[1,2,260,900,5]],
      [{t:'bossdead'},'shock',[1,2,1500,5200,1000,5,1,80]],
      [{t:'bomb'},'impulse',[1,2,220,700,5]],
      [{t:'bomb'},'shock',[1,2,1800,5200,1400,5,1,80]],
      [{t:'death'},'impulse',[1,2,180,700,4]],
      [{t:'death'},'shock',[1,2,1000,4200,800,4,0.4]],
      [{t:'revive'},'shock',[1,2,800,3600,900,4]],
      [{t:'revived'},'shock',[1,2,800,3600,900,4]],
      [{t:'downed'},'impulse',[1,2,150,500,4]],
      [{t:'downed'},'shock',[1,2,600,3200,800,4]],
      [{t:'perfect'},'impulse',[1,2,150,450,4]],
      [{t:'perfect'},'shock',[1,2,280,3000,900,4]],
      [{t:'dash',dx:1,dy:0},'wake',[-49,2,1,2,420,80,3]],
      [{t:'hurt'},'impulse',[1,2,110,260,2]],
      [{t:'shieldbreak'},'impulse',[1,2,150,420,3]],
    ];
    for (const [event, method, args] of cases) {
      const {calls,grid}=spyGrid(); gridEvent(grid,{x:1,y:2,...event} as GameEvent,empty);
      expect(calls[method as keyof typeof calls]).toHaveBeenCalledExactlyOnceWith(...args);
    }
    for(const t of ['sector','ring','hit']) {
      const {calls,grid}=spyGrid(); gridEvent(grid,{t} as GameEvent,empty);
      for(const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
    }
    const {calls,grid}=spyGrid(); gridEvent(grid,{t:'kill',boss:true,x:1,y:2} as GameEvent,empty);
    expect(calls.shock).not.toHaveBeenCalled();
  });
  it('kicks only up pilots on level up', () => {
    const {calls,grid}=spyGrid();
    gridEvent(grid,{t:'levelup',level:2},{...empty,players:[
      {x:1,y:2,dashT:0,alive:true,downed:false},{x:3,y:4,dashT:0,alive:true,downed:true},{x:5,y:6,dashT:0,alive:false,downed:false},
    ]}); expect(calls.impulse).toHaveBeenCalledExactlyOnceWith(1,2,240,380,3);
  });
  it('scales continuous forces by dt and always refreshes wake origins', () => {
    const {calls,grid}=spyGrid(), prev=new Float32Array([0,0,3,4]);
    const world: GridWorldView={players:[{x:10,y:20,dashT:1,alive:true,downed:false}],
      enemies:[{x:5,y:6,kind:'voidheart',dead:false,spawnT:0,hp:4,maxHp:10},
        {x:5,y:6,kind:'voidheart',dead:true,spawnT:0,hp:0,maxHp:10},
        {x:5,y:6,kind:'voidheart',dead:false,spawnT:1,hp:10,maxHp:10}],
      mines:[{x:7,y:8,radius:100,triggered:true,pull:true},{x:7,y:8,radius:100,triggered:false,pull:true}],
      rings:[{x:9,y:10,radius:200,t:0.1,duration:0.5},{x:9,y:10,radius:200,t:-1,duration:0.5},{x:9,y:10,radius:200,t:0.5,duration:0.5}]};
    gridFrame(grid,world,prev,0); expect([...prev]).toEqual([10,20,3,4]);
    for(const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
    gridFrame(grid,world,prev,DT);
    expect(calls.wake).toHaveBeenCalledExactlyOnceWith(10,20,10,20,420,84,3);
    expect(calls.implode).toHaveBeenCalledTimes(2);
    expect(calls.implode).toHaveBeenNthCalledWith(1,5,6,320,4200,DT,0.6);
    expect(calls.implode).toHaveBeenNthCalledWith(2,7,8,100*2.2,6500,DT,0.8);
    expect(calls.ring).toHaveBeenCalledExactlyOnceWith(9,10,200,44,2400,DT,3);
  });
});
