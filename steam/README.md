# steam/

Files Steam needs, kept next to the code that depends on them. The full release guide is
[docs/STEAM.md](../docs/STEAM.md).

| File | What it is | Edit by hand? |
| --- | --- | --- |
| `steam_appid.txt` | `480` (Valve's public "Spacewar" test app). The desktop shell reads it **only when not packaged** (`npm run desktop:dev`), so Steamworks can initialise against a running Steam client on a developer machine. Replace it with the real AppID once you have one, if you like. It is never packaged: `electron-builder.yml` does not include it, and every depot script excludes `steam_appid.txt`. | yes |
| `achievements.json` | The Steam achievement table: game id, **API name**, display name, description, hidden flag. Generated from `src/meta/achievements.ts` (plus the co-op placeholders in `src/platform/achievements.ts`). The desktop main process uses it as the allowlist of API names the renderer may unlock. | **no**: run `npm run steam:achievements` |
| `rich_presence_english.vdf` | Rich presence localisation tokens. Upload it in Steamworks > Community > Rich Presence. Keys match `desktop/validate.cjs`. | yes (keep the token names) |
| `app_build.vdf` | SteamPipe app build script. AppID and depot IDs are placeholders (`1234560`, `1234561..3`). | yes: real IDs |
| `depot_build_windows.vdf` | Windows depot: `release/win-unpacked/` | yes: depot ID |
| `depot_build_macos.vdf` | macOS depot: `release/mac-universal/` | yes: depot ID |
| `depot_build_linux.vdf` | Linux/SteamOS depot: `release/linux-unpacked/` | yes: depot ID |

## Achievement API names

Rule: `ACH_` + the game id in upper case. `first_run` becomes `ACH_FIRST_RUN`, `kills10k` becomes
`ACH_KILLS10K`, and the co-op ones are `ACH_SQUAD` and `ACH_MEDIC`. Enter exactly these names in
Steamworks > Stats & Achievements. If you rename or add an achievement in the game, run
`npm run steam:achievements`, commit the JSON, and add the new entry in Steamworks too.
`npm test` fails when the API names in the JSON drift from the game table, and
`npm run steam:achievements -- --check` (run by `desktop:dist` and CI) fails on any change.

## Uploading by hand

```bash
# On each OS (or download the three CI artifacts and untar them into release/):
npm ci && npm run desktop:dist
# Then, from the repo root, with the real IDs filled in:
steamcmd +login <builder-account> +run_app_build "$(pwd)/steam/app_build.vdf" +quit
```

Set `"Preview" "1"` in `app_build.vdf` for a dry run that uploads nothing.
