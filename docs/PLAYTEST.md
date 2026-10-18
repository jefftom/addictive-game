# Solo phone and optional-transmission playtest

Status: kit prepared; **no outside-player sessions or physical-phone results
have been collected by this implementation**. Automated tests are not retention
or player-preference evidence. Do not add analytics or contact participants
automatically. Ask participants for consent before notes or recording.

## Builds and setup

- A: action/results checkpoint `9d50fe0`, local standalone
  `F:\addictive-game-handoff\2026-10-18-replayability\6b-shardstorm.html`.
- B: current branch, same action game plus one optional transmission. Local
  standalone `F:\addictive-game\dist-single\shardstorm.html`, Windows
  `F:\addictive-game\release\win-unpacked\SHARDSTORM.exe`, or the local phone
  preview `http://192.168.50.227:4382/` while the host server is running.
- Record the actual SHA/build, device, OS, browser, orientation and settings.
  Use separate test browser profiles for A and B; preserve the owner's save.
  The phone must be on the host's local network. This is not a public deployment.
- Start with six adult volunteer players, including people unfamiliar with the
  genre. This is a usability sample, not a retention estimate. Alternate which
  build is seen first; record order, familiarity and any coaching. Do not treat
  second-build performance as an independent first-time-player observation.

## Session script

1. Let the player start a fresh solo run without coaching. Ask them to say what
   they are trying to do. Note first meaningful upgrade offer and choice times,
   mistaken taps, thumb occlusion, missed hazards and any unreadable text.
2. Before explaining evolutions, ask: "What would you need to turn one of your
   weapons into its evolved form?" Record their own answer and whether they
   discovered the guide or pinned a goal unaided. Do not lead with the answer.
3. After the run, ask "What ended that run?" and "What would you try next?"
   Distinguish understanding of the actual lethal-hit category from boss
   dialogue. Record whether their next goal matches a real requirement.
4. Leave the results choice to them. Record retry, Change Ship, Workshop,
   transmission or stop, including time to choose. Do not count a prompted
   replay as voluntary. Stopping is a valid choice.
5. In B, the fragment unlocks after a normal solo defeat or victory. Retreat,
   Daily and co-op do not earn it. Decoding is optional and gives story only.
   First observe whether they open it unaided. Afterwards, if they skipped it,
   offer a separate prompted usability attempt and label it as prompted.
6. Ask "Did the transmission make you want another run, interrupt your mood,
   or make no difference?" Record free-form reasons and A/B preference. Note
   puzzle completion, hint, reveal, abandonment, and any belief it was required.
7. If they opt into a next-day check, record whether they returned on their own
   and which build they chose. Do not invent missing follow-up data, reminders
   or return events. The owner handles any participant communication.

## Scorecard (one row per participant/build)

Copy [the CSV template](playtest-scorecard.csv). Use an anonymous test id; no
email, birthdate or other identifiers are needed. Times are seconds from Play;
first choice time means a committed upgrade selection. Leave unobserved fields
blank, not zero. Count spontaneous and prompted puzzle attempts separately.

Report counts **with denominators**: correct evolution explanations / asked;
understood lethal cause / losses observed; voluntary retries / first results
observed; voluntary puzzle opens / B fragment holders; hints or reveals / puzzle
attempts; self-initiated next-day returns / participants with observed follow-up.
Include missing follow-ups and exposure order. Do not claim commercial retention
or statistical significance from this small sample.

## Phone acceptance, separate from preference

Use a physical midrange Android and an iPhone. Check portrait and landscape,
browser chrome/safe areas, simultaneous steering and DASH, accidental touches,
pause/resume and switching apps. Play for at least 15 minutes to observe warmth,
frame consistency and battery change; record device/settings and the actual
duration. If using the FPS display, label the session so it is not confused with
an unmodified first-run observation. Test enhanced graphics and the 2D fallback.
Record dropped-frame feel and thumb comfort; desktop SwiftShader measurements
and viewport emulation cannot establish physical-device acceptance.

## Decisions after observation

Fix blocked controls, clipped content, lost progress or misleading rewards
before recruiting a larger cohort. Prioritize repeated comprehension problems.
Keep or remove the one-puzzle prototype based on observed choice and reasons;
do not infer demand for a puzzle campaign from completion alone. Only after this
review choose one new experiment: stronger existing build differences, opening
pacing, or a 3–5-minute mission. Each needs its own balance spec and CI gate.

Optional cosmetic monetization remains a proposal. Before implementation,
choose launch platform, concrete cosmetic inventory and a demand test, then
spec purchase/restore/refund/offline failures. No paid power, energy gates,
random paid rewards, ads, billing SDK, account service or published prices are
part of this build.
