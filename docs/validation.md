# Validation

We verified the browser parser against reference exports for two card bundles. The reference extractor was used only during development. Neither the desktop preview nor `web-cartoon-player/` loads or requires it at runtime.

| Check | 201389<br>佐城雪美「あなたに微笑むマドモアゼル」 | 300599<br>赤城みりあ「一夜の魔法」 |
|---|---:|---:|
| UnityFS / serialized version | 7 / 22 | 6 / 17 |
| Object inventory matches | 120 | 19 |
| Object bodies compared | 105 | 10 |
| Skeleton byte comparisons | 5 exact | 5 exact |
| Atlas text comparison | Exact | Exact |
| RGBA pixel comparisons | 7 exact | 2 exact |
| Browser Spine layers | 5 | 5 |
| Browser emitting particle systems | 21 | 0 |

Object field comparisons allow a small floating-point serialization tolerance. PathIDs stay as `BigInt` while parsing and become file-qualified strings in the playback plan. Texture SHA-256 fixtures cover decoded pixel data, including row orientation and alpha. All nine stored texture hashes match their references.

Both browser smoke checks load each supplied card and then reload the first, verify that **Pause** freezes the canvas, and check the bare player. With card 201389 present, they also check 21 emitter markers, visibility of the sorting-order field, and a stationary reference frame. They fail on JavaScript errors and confirm that loading does not issue POST requests.

The desktop check also submits a malformed file and checks that loading becomes available again. The standalone check also verifies inspector page padding and that the bare file selector is visible while the initial canvas is hidden. Desktop screenshots are saved to `test-output/` and standalone comparisons stay in memory. Earlier reference screenshots were visually inspected. Automated smoke checks do not establish visual equivalence with the official game.

These checks verify the bundle-loading and Spine-rendering path. Particle rendering remains an approximation of Unity's particle system, so it is not asserted to be pixel-identical.

Parser tests also cover malformed LZ4 input, unsupported formats, missing TypeTrees, binary bounds including invalid reader positions, 64-bit IDs, row flipping, cross-file PPtr resolution, and rejection of partial decode caches. Load-session tests cover cancellation during asynchronous viewer construction and recovery after a Worker error. RGB24 and RGBA32 have synthetic tests only because they were not present in the two reference bundles. Input and allocation sizes are bounded. Those limits do not imply support for every file below them.

Remote URL downloads, every allocation failure, and arbitrary malformed skeleton data are not comprehensively tested.

## Running the checks

From the repository root:

```sh
node --test tests/*.test.mjs
node scripts/sync-standalone.mjs --check
```

Set `CGSS_BUNDLE_DIR` to a directory containing `card_cartoon_201389.unity3d` and `card_cartoon_300599.unity3d` for reference integration tests. For example, in PowerShell:

```powershell
$env:CGSS_BUNDLE_DIR = '.\local-bundles'
node --test tests/*.test.mjs
```

The post-refactor run passed all 14 tests with those bundles. Without that environment variable, the two reference tests are skipped and the other 12 run.

Install Playwright for the optional browser checks:

```sh
npm install --no-save --package-lock=false playwright
node tests/browser-smoke.mjs /path/to/bundles
node tests/standalone-browser-smoke.mjs /path/to/bundles
```

Both browser checks passed after the refactor. Edge is the default. `BROWSER_CHANNEL` selects another installed Playwright browser channel. Only the desktop check requires Python. Set `PYTHON` if its executable is not named `python`. The supplied directory should contain only supported card bundles because the browser checks attempt every matching filename.

## Historical reference comparison

The object-body, skeleton, and atlas comparisons in the table above came from prepared reference exports. They are separate from the current automated RGBA hash and metadata checks and were not rerun as part of the refactor.

To compare a bundle against an existing prepared reference export during development:

```sh
node tests/compare-reference.mjs /path/to/card.unity3d /path/to/prepared-reference
```

The reference directory must contain `scene/objects.json`, per-object JSON files, and `assets/TextAsset/` from the earlier extraction flow. Reference exports and game files are not included in this repository.
