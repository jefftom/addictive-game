# Replayability and free-game monetization

Status: owner authorized continuing the recommended work on 2026-10-18.
Baseline: `b528dc7` on `claude/dazzling-faraday-2kxdhl`. Implement 6a/6b in order,
prepare 6c playtesting, then make the bounded optional puzzle prototype below.
Commerce and balance experiments retain their stated decision/playtest gates.

## Outcome

Help a player choose an interesting build, understand their progress, and want
to try another run. Preserve fair failure, useful stopping points and readable
phone combat. Revenue should come from optional value, not artificial friction.

## Verified starting point

- Seven weapons already have named evolutions and descriptions in
  `src/game/content/weapons.ts`. Eligibility is a level-5 unevolved weapon plus
  at least one rank of its partner passive (`availableEvolutions`).
- Upgrade cards already show some evolution hints, mainly at weapon level 5.
  Players already have rank, cores, workshop upgrades, missions and ship unlocks.
- Results already support Play Again, including Daily/co-op routing and a
  900 ms input grace period. Improve this flow rather than creating another one.
- `App.killedBy` identifies a boss present at defeat for story dialogue. It
  does not establish the source of the lethal hit. Never label it as such.

## 6a — Understand and pursue an evolution (first implementation)

On solo level-up cards and the paused build view, show each owned weapon's
evolved name, existing evolved description, weapon-level progress and partner
passive status. Use the content tables as the source of truth.

Example: `Pulse Blaster 3/5 → Photon Storm`, followed by the actual named
partner and whether it is owned. Show missing requirements, eligible, evolved,
and blocked-by-full-passive-slots states distinctly. Do not promise that a
particular random card will appear next. An optional single pinned evolution
goal stays within the current run and appears in paused/upgrade screens; it
does not add a persistent combat overlay or change offer odds.

Acceptance:
- Accurate at levels 1–5, missing/owned partner, evolved, and full slots.
- Opening, pinning or dismissing information never picks/rerolls a card,
  advances the simulation, changes RNG, or consumes gameplay input.
- 320px portrait, Pixel 7, landscape, keyboard and gamepad work without overflow;
  interactive targets are at least 44 CSS pixels. No hover-only information.
- Co-op still displays the picking pilot's information and preserves pick order.
  Pinning is solo-only in this milestone.
- Golden replay and original HUD snapshot remain unchanged. Relevant unit/E2E
  cases, strict types and both builds pass, followed by web and all desktop CI.

## 6b — Make results actionable and retry deliberate

Lead solo results with the actual outcome, final build and one useful next-run
goal. Prefer the unfinished pinned evolution, otherwise an existing mission or
ship-unlock requirement with measurable progress. If none fits, omit the goal.
Use honest values; do not invent closeness to a record or guarantee an unlock.

Make Play Again prominent with the mode clearly identified. Preserve the input
grace period, consume the triggering input once, and retain existing Daily,
co-op/controller-disconnect and save/reward behaviour. Keep Change Ship and
Return to Title accessible. Never duplicate rewards on retry or reload.

A precise death-cause panel is a separate substep: first trace damage sources
and add descriptive metadata without changing damage calculations or RNG.
Test enemy contact, projectile, environmental damage where applicable, retreat,
victory and co-op defeat. If attribution is unavailable or ambiguous, say so or
omit it; a boss merely being present is insufficient evidence.

Acceptance: phone/desktop results fit, one activation starts one intended run,
held dash cannot skip results, goals match real state, saves remain compatible,
and golden/unit/browser/build plus remote CI gates pass before proceeding.

## 6c — Playtest, then choose gameplay changes

Capture the current first-run experience before tuning. With outside players,
observe time to first meaningful choice, whether evolution requirements are
understood, confusion at death, voluntary second runs and next-day returns.
Start with a small usability group, then a larger cohort if the flow works.
Record counts and denominators; small cohorts are directional, not retention
proof. Use consented playtest notes initially, with no analytics SDK in 6a/6b.

Only then select a bounded gameplay experiment: stronger differences between
existing build styles, opening-minute pacing, or a 3–5-minute phone mission.
Specify the exact content/rule change and compare matched seeds and human play.
These experiments change balance and require their own acceptance criteria;
they are not bundled into the presentation milestones. Deliberate golden
changes must follow AGENTS.md, never be used to hide a regression.

## Monetization direction (proposal, separate from 6a/6b)

Recommended first offer: free core game with optional ship/trail/portrait
cosmetics and a one-time supporter bundle. Gameplay ships remain earnable.
Cosmetics must preserve readable silhouettes, hazard colours and visibility.
Indicative price experiments: $3–5 per pack, $7–10 per bundle; not forecasts.

Paid power, energy timers, paid random rewards and punitive streak mechanics
are excluded from this proposal. Optional post-run ads for cosmetic rewards
are a later experiment, not part of the first release. Purchases/ads would
explicitly revise the existing no-money/no-ads design direction.

Before store implementation, settle the launch platform (web vs native mobile
vs Steam), exact cosmetic inventory and player demand. Write a separate commerce
spec covering storefront rules, purchase/restore/refund handling, entitlement
storage, offline behaviour and failure states. No billing, ad SDK, account
backend, pricing publication or payment collection is authorized by this draft.

## 6d — One optional intercepted-transmission prototype

After the action/UI milestones pass CI, provide one short, clue-based word
puzzle outside combat. A completed normal solo run earns its signal fragment;
the player may decode it from results or the title menu, retry immediately,
or return later. No timer, no combat interruption, no letter pickups, and no
gameplay power reward. Solving reveals one original story transmission. Offer
a hint/reveal path and clear feedback; allow keyboard and touch without a
hardware keyboard. Preserve progress across reloads using compatible save data.

Acceptance: leaving/re-entering and incorrect/duplicate submissions do not lose
progress or award gameplay resources; completion persists, combat never opens
the puzzle, Daily/co-op rules remain unchanged, and old saves load safely.
Include a playable comparison/playtest question about whether players prefer
retrying or decoding. Do not expand to a puzzle campaign without player evidence.

## Delivery order

Implement 6a, verify local checks, push to the existing branch and wait for web
and desktop CI. Repeat for 6b. Deliver a playable and screenshots at each step.
Then evaluate 6c playtests before selecting new balance/content work or a store.
Update GAME_DESIGN and HANDOFF as behaviour lands; retain prior performance and
co-op balance gaps. Do not merge main or publish deployments as part of this spec.
