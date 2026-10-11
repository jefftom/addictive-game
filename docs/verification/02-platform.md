# Task 2: platform wiring and bundled fonts

Source `361c4c1` is preserved by merge `ec48096`, after task 1 passed all CI jobs
at `2be4888`. Verification was performed on Windows x64, Node 22.16.0.

## Changes and review

Reviewed the platform boot, storage routing, achievement synchronization and
retry queue, presence mapping/throttling, desktop bridge, fullscreen UI, and
font bundling against the task specification. The web keeps `shardstorm.save`;
desktop hydrates its mirrored file before normal boot and flushes on quit.

Steam Deck now enforces fullscreen in the main process, including F11, without
overwriting the saved windowed preference. The desktop smoke checks both facts.
The explicit developer windowed override still bypasses the lock, as clarified
by the remote specification update preserved in this checkpoint.
Both standalone HTML outputs include the complete bundled OFL notice in a
comment; missing licence files throw and consecutive hyphens are escaped.

The Windows smoke previously timed out because its absolute Electron entry
path ended in a backslash. Launching `.` with the existing repository cwd fixes
that issue. A throwaway launch reproduced the failure with the old argument and
success with the new one, before the full smoke passed.

No simulation, renderer, golden master, determinism guard, pending-migration
allow-list, or web-bundle isolation check changed in this task.

## Local acceptance

- `npm ci`, typecheck, and all **343 unit tests** passed.
- Browser tests: **32 passed**, 8 existing device exclusions unchanged; desktop
  and Pixel 7 projects used the free port 4273 with a freshly built server.
- Windows Electron smoke: **48 checks passed**, including the new Deck F11
  check. Steam was explicitly disabled for this local no-client run.
- A separate throwaway Electron check confirmed the Deck developer override
  starts windowed and F11 can enter and leave fullscreen.
- Achievement table: `node scripts/gen-steam-achievements.mjs --check` reports
  up to date.
- `build:single`: `shardstorm.html` **406583 bytes (397.1 KiB)**;
  `embed.html` **406051 bytes (396.5 KiB)**. Both contain the OFL comment and
  neither comment contains an invalid double hyphen. The full file is below
  the build script's 400 KiB target.
- `git diff --check` passed.

## Font comparison

Built pre-platform `2be4888` in a separate detached worktree and the integrated
version independently. Captured and inspected title, Settings, and a run warped
to 30 seconds at 1280x720 and Pixel 7 dimensions (412x915, DPR 2.625): 12 images.
The before build successfully loaded Google Fonts; the after build made no
third-party requests. Neither build produced page errors.

Tektur logo, Chakra Petch menus, and Kode Mono numbers retained their shapes,
weights, sizing, and wrapping. Four font-width probes were identical before and
after on both viewports (Tektur 900/72px, Chakra Petch 400/18px and 700/24px, Kode
Mono 500/24px). Existing title/settings overflow at the small desktop height is
unchanged. The comparison does not claim a broader layout redesign.

## Known limits and remote gate

As the task requires, boot timeout/hydration races remain unchanged: timeout or
hydration error can start from localStorage and a later write can overwrite the
cloud file; hydration completing late can replace storage under a running App.
These need an owner decision and are recorded in the PR description.

Real Steam client integration and Steam-side token upload require the owner.
The optional macOS native-menu/green-button persistence improvement is deferred;
those native controls update the UI but currently do not save the preference.
Remote acceptance passed at `10a84c7cdaf4291b4f35ac8016b6fa538dc44915`:

- [CI: typecheck, unit tests, single build, desktop/mobile e2e](https://github.com/jefftom/addictive-game/actions/runs/38110958016).
- [Desktop: all three OS builds and packaging, Linux smoke](https://github.com/jefftom/addictive-game/actions/runs/38110958010).

The Linux job log confirms `DESKTOP SMOKE: 48 checks passed`. All required jobs
succeeded; the Steam deploy job was intentionally skipped.
