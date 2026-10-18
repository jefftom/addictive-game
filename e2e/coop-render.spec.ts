import { expect, test, type Page } from '@playwright/test';

const SEED_SAVE = { tutorialDone: true, story: { introSeen: true }, settings: { shake: 0, chatter: 'off' } };

async function onApp<T>(page: Page, body: string, arg?: unknown): Promise<T> {
  return page.evaluate(([code, value]) => new Function('a', 'v', code as string)((window as unknown as { shardstorm: unknown }).shardstorm, value), [body, arg]);
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'co-op needs keyboards or gamepads');
  await page.addInitScript(save => localStorage.setItem('shardstorm.save', JSON.stringify(save)), SEED_SAVE);
});

test('one zoom-aware view frames every captain at the leash corners', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?coop=4&autoplay');
  await onApp(page, `const w=a.world, span=w.maxSpan(), sx=span.x, sy=span.y;
    window.pinCorners=true;
    const pin=()=>{if(!window.pinCorners)return;w.players.forEach((p,i)=>{p.invuln=1e9;p.x=(i%2-.5)*sx;p.y=(Math.floor(i/2)-.5)*sy;p.vx=p.vy=0;});requestAnimationFrame(pin);};pin();`);
  await page.waitForTimeout(2000);
  const result = await onApp<{ zoom: number; view: number; inset: number; width: number; height: number; pilots: { x: number; y: number; error: number }[] }>(page,
    `window.pinCorners=false;const w=a.world,r=a.renderer; r.draw(w,0,{attract:false,realDt:0});
     return {zoom:w.zoom,view:r.viewZoom,inset:30*r.scale/w.zoom,width:r.cssW,height:r.cssH,pilots:w.players.map(p=>{
       const [x,y]=r.worldToScreen(p.x,p.y),[wx,wy]=r.screenToWorld(x,y);return{x,y,error:Math.hypot(wx-p.x,wy-p.y)};})};`);
  expect(result.zoom).toBeGreaterThan(1.35); expect(Math.abs(result.zoom - result.view)).toBeLessThan(1e-9);
  for (const p of result.pilots) {
    expect(p.x).toBeGreaterThanOrEqual(result.inset - 0.001); expect(p.x).toBeLessThanOrEqual(result.width - result.inset + 0.001);
    expect(p.y).toBeGreaterThanOrEqual(result.inset - 0.001); expect(p.y).toBeLessThanOrEqual(result.height - result.inset + 0.001);
    expect(p.error).toBeLessThan(0.01);
  }
  expect(errors).toEqual([]);
});

test('downs, last stand and revive have visible and screen-reader cues', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?coop=4');
  await onApp(page, 'for(const p of a.world.players)p.invuln=1e9;');
  const down = (pid: number) => onApp(page, 'const w=a.world,p=w.players[v];p.invuln=0;p.dashT=0;p.shieldReady=false;p.revivesUsed=99;w.hurtPlayer(1e9,p.x,p.y,v);', pid);
  const callouts = () => onApp<string[]>(page, 'return a.renderer.callouts.items.map(c=>c.text);');
  await down(1);
  await expect(page.locator('#sr-announce')).toContainText('P2 is down');
  await expect.poll(callouts).toContain('● P2 DOWN'); expect(await callouts()).not.toContain('LAST CAPTAIN STANDING');
  await expect(page.locator('#toasts')).not.toContainText('is down');
  await down(2); await down(3);
  await expect.poll(callouts).toContain('LAST CAPTAIN STANDING');
  await onApp(page, `const pin=()=>{const [p,q]=a.world.players;if(!q.downed)return;p.x=q.x+10;p.y=q.y;p.vx=p.vy=0;requestAnimationFrame(pin);};pin();`);
  await expect.poll(callouts, { timeout: 4000, intervals: [50, 100] }).toContain('● P2 BACK IN THE FIGHT');
  await expect(page.locator('#sr-announce')).toContainText('P2 is back in the fight');
  expect(errors).toEqual([]);
});

test.describe('HiDPI steering', () => {
  test.use({ deviceScaleFactor: 2 });
  test('mouse positions convert from CSS to device pixels exactly once', async ({ page }) => {
    await page.goto('/?coop=2');
    const before = await onApp<{ x: number; p2: number; screen: [number, number]; dpr: number }>(page,
      'for(const p of a.world.players)p.invuln=1e9;const p=a.world.players[0];return{x:p.x,p2:a.world.players[1].x,screen:a.renderer.worldToScreen(p.x,p.y),dpr:a.renderer.dpr};');
    expect(before.dpr).toBe(2);
    await page.mouse.move(before.screen[0] + 200, before.screen[1]); await page.mouse.down();
    await page.waitForTimeout(600); await page.mouse.up();
    const after = await onApp<number[]>(page, 'return a.world.players.map(p=>p.x);');
    expect(after[0]! - before.x).toBeGreaterThan(40); expect(Math.abs(after[1]! - before.p2)).toBeLessThan(5);
  });
});

test('solo keeps zoom one and the original following camera', async ({ page }) => {
  await page.goto('/?autoplay'); await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForTimeout(600);
  const state = await onApp<{ coop: boolean; zoom: number; dx: number; dy: number }>(page,
    'const r=a.renderer,p=a.world.players[0],[x,y]=r.worldToScreen(p.x,p.y);return{coop:a.world.coop,zoom:r.viewZoom,dx:Math.abs(x/r.cssW-.5),dy:Math.abs(y/r.cssH-.5)};');
  expect(state.coop).toBe(false); expect(state.zoom).toBe(1); expect(state.dx).toBeLessThan(0.25); expect(state.dy).toBeLessThan(0.25);
});
