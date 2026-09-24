# Third-party notices

## AssetStudio

We used [AssetStudio](https://github.com/Perfare/AssetStudio) as the reference for the UnityFS, SerializedFile, TypeTree, and shared-string handling. `src/common-strings.js` adapts its shared string table. AssetStudio is MIT licensed. Its text is in [licenses/AssetStudio-MIT.txt](licenses/AssetStudio-MIT.txt). We do not distribute or load AssetStudio binaries.

## MDUI

We are very thankful to [MDUI](https://www.mdui.org/) for its Material Design direction, which inspired the local interface. No MDUI source or package files are bundled. MDUI is available under the MIT License. Its notice is included in [licenses/MDUI-MIT.txt](licenses/MDUI-MIT.txt).

## Spine Runtimes and CGSS preview code

`runtime/spine-core.js` and `runtime/spine-canvas.js` come from Spine Runtimes 3.6 by Esoteric Software. The Spine Runtimes Software License v2.5 is in [licenses/Spine-3.6.txt](licenses/Spine-3.6.txt). We retain that license with the runtime files.

`runtime/spine-webgl.js` and `runtime/cgss_skel_parser.js` started from the existing CGSS preview source supplied with this work. We made local resource-management and texture-cache changes to the renderer and simplified comments in the parser. No separate upstream license notice was supplied for these two files.

The same notices apply to the synchronized copies under `web-cartoon-player/runtime/` and `web-cartoon-player/src/`. When redistributing the standalone folder, include this notice and the files in `licenses/`. [licenses/README.md](licenses/README.md) explains the mapping.

## Test assets

We do not include game bundles, textures, or skeletons. Supply bundle files you
are entitled to use when running integration checks.
