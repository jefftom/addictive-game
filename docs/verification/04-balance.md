# Balance receipts

Rank 1, skill 0.6; alternating Spark/Vanguard. Tick timings exclude bot work.

Trial 13 is the final review candidate. Its main target bands pass, but the
held-out 4P boss fight is 94.08 s against an 89.40 s limit, and the outcome
rates are not strictly monotone across squads. These remain acceptance gaps;
see [the consolidated report](04-verify-and-ship.md). Solo/2P per-seed records
match the 24-run baseline exactly after excluding timing samples.

## Post-determinism baseline

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 24 | 555 | 18/24 (75%) | 8/24 (33.33%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 24 | 382.9 | 17/24 (70.83%) | 6/24 (25%) | 5.5 | 73.72 | 2 / 1 | 5 | 501 |
| 3P | 24 | 592.02 | 21/24 (87.5%) | 11/24 (45.83%) | 7 | 57.72 | 6.5 / 5 | 0 | 560 |
| 4P | 24 | 660.02 | 23/24 (95.83%) | 17/24 (70.83%) | 7 | 64.02 | 8 / 6 | 0 | 600 |

## 24-seed iterations (1000–1023)

| Trial | 3P hp / bossHp | 4P hp / bossHp / xpReq / cap | 3P Warden / 600s / median s | 4P Warden / 600s / median s |
|---|---|---|---|---|
| 1 | 1.7 / 3.1 | 2.1 / 4.3 / 2.6 / 600 | 18 / 7 / 530.97 | 23 / 10 / 530.32 |
| 2 | 1.95 / 3.6 | 2.6 / 5.6 / 2.6 / 600 | 18 / 5 / 424.93 | 17 / 6 / 433.62 |
| 3 | 1.95 / 3.8 | 2.7 / 5.6 / 2.6 / 597 | 20 / 4 / 416.82 | 13 / 3 / 361.33 |
| 4 | 2.1 / 3.6 | 2.65 / 5.6 / 2.6 / 597 | 16 / 4 / 410.97 | 16 / 4 / 412.85 |
| 5 | 2 / 3.6 | 2.65 / 5.2 / 2.6 / 597 | 18 / 3 / 397.76 | 14 / 3 / 394.73 |
| 6 | 1.95 / 3.6 | 2.55 / 5.6 / 2.6 / 597 | 18 / 5 / 424.93 | 16 / 1 / 422.5 |
| 7 | 1.95 / 3.6 | 2.55 / 6.2 / 2.35 / 597 | 18 / 5 / 424.93 | 15 / 4 / 412.68 |
| 8 | 1.95 / 3.6 | 2.45 / 6 / 2.35 / 597 | 18 / 5 / 424.93 | 17 / 5 / 395.57 |
| 9 | 1.95 / 3.6 | 2.5 / 6.1 / 2.35 / 597 | 18 / 5 / 424.93 | 17 / 5 / 409.73 |
| 10 | 1.95 / 3.6 | 2.52 / 6.15 / 2.35 / 597 | 18 / 5 / 424.93 | 20 / 3 / 410.07 |
| 11 | 1.95 / 3.6 | 2.6 / 5.6 / 2.6 / 597 | 18 / 5 / 424.93 | 17 / 4 / 433.62 |
| 12 | 1.95 / 3.6 | 2.45 / 6.2 / 2.35 / 597 | 18 / 5 / 424.93 | 20 / 9 / 434.65 |
| 13 | 1.95 / 3.6 | 2.55 / 6.2 / 2.25 / 597 | 18 / 5 / 424.93 | 17 / 6 / 440 |
| 14 | 1.95 / 3.6 | 2.6 / 6 / 2.25 / 597 | 18 / 5 / 424.93 | 16 / 6 / 530.01 |

All other multipliers stay at the baseline. Trial 2 correctly failed the unchanged 4P hard-cap assertion at 601. Trial 3 reserves three boss slots at cap 597.

Trials 11 and 12 revisit earlier configurations: 11 is trial 2 with only the
cap reserve; 12 is trial 8 with boss HP 6.0 → 6.2. Trial 13 changes XP from
trial 7 (2.35 → 2.25); trial 14 changes ordinary/boss HP from trial 13.
The small samples are scouting runs, not confirmation. Trial 14's 48-seed
4P-only confirmations are compared with the unchanged solo/2P/3P records
from trial 13; the final candidate's two blocks reran all four profiles.

## balance-confirm-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 413.93 | 32/48 (66.67%) | 8/48 (16.67%) | 6 | 72.48 | 5 / 3 | 0 | 561 |
| 4P | 48 | 408.47 | 31/48 (64.58%) | 7/48 (14.58%) | 5 | 95.58 | 8 / 5 | 0 | 598 |

## balance-confirm07-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 412.5 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 72.67 | 5 / 3.5 | 0 | 561 |
| 4P | 48 | 411.32 | 29/48 (60.42%) | 8/48 (16.67%) | 6 | 85.95 | 8 / 5 | 0 | 598 |

## balance-confirm08-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 412.5 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 72.67 | 5 / 3.5 | 0 | 561 |
| 4P | 48 | 419.28 | 37/48 (77.08%) | 11/48 (22.92%) | 6 | 91.4 | 8 / 6 | 0 | 597 |

## balance-confirm09-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 412.5 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 72.67 | 5 / 3.5 | 0 | 561 |
| 4P | 48 | 397.68 | 37/48 (77.08%) | 9/48 (18.75%) | 6 | 95.75 | 9 / 6 | 0 | 598 |

## balance-confirm10-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 412.5 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 72.67 | 5 / 3.5 | 0 | 561 |
| 4P | 48 | 408.53 | 32/48 (66.67%) | 6/48 (12.5%) | 5 | 84.29 | 8 / 5 | 0 | 598 |

## balance-confirm11-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 412.5 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 72.67 | 5 / 3.5 | 0 | 561 |
| 4P | 48 | 406.36 | 29/48 (60.42%) | 6/48 (12.5%) | 5 | 91.53 | 8 / 5 | 0 | 597 |

## balance-confirm13-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 374.35 | 28/48 (58.33%) | 9/48 (18.75%) | 6 | 50.28 | 0 / 0 | 0 | 421 |
| 2P | 48 | 402.1 | 37/48 (77.08%) | 14/48 (29.17%) | 5.5 | 63.2 | 2 / 1 | 11 | 501 |
| 3P | 48 | 412.5 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 72.67 | 5 / 3.5 | 0 | 561 |
| 4P | 48 | 435.8 | 34/48 (70.83%) | 12/48 (25%) | 6 | 93.19 | 9 / 6.5 | 0 | 598 |

## balance-confirm13-5000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 1P | 48 | 343.55 | 20/48 (41.67%) | 8/48 (16.67%) | 6 | 32.26 | 0 / 0 | 0 | 421 |
| 2P | 48 | 421.15 | 35/48 (72.92%) | 10/48 (20.83%) | 6 | 59.6 | 2 / 1 | 13 | 501 |
| 3P | 48 | 398.8 | 30/48 (62.5%) | 4/48 (8.33%) | 6 | 77.6 | 5 / 3 | 0 | 561 |
| 4P | 48 | 415.69 | 38/48 (79.17%) | 10/48 (20.83%) | 6 | 94.08 | 8 / 5 | 0 | 598 |

## balance-confirm14-1000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 4P | 48 | 414.01 | 30/48 (62.5%) | 7/48 (14.58%) | 6 | 82.3 | 8 / 5 | 0 | 598 |

## balance-confirm14-5000

| Squad | Runs | Median seconds | Warden | Reached 600s | Level60 | Fight seconds | Downs / revives | First-down wipes | Peak enemies |
|---|---|---|---|---|---|---|---|---|---|
| 4P | 48 | 437.82 | 40/48 (83.33%) | 11/48 (22.92%) | 6 | 84.13 | 9 / 6 | 0 | 598 |
