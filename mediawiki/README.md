# MediaWiki single-file player

We generate `cgss-mediawiki.js` from the same loader, Spine runtime, particle
simulation, material rules, and WebGL renderer used by the main player. The
generated file contains the player logic and its required runtime code. It
contains no card bundle or card assets. We first fetch one deployment manifest,
then fetch only the selected card file or its listed parts.

## Use

Load `cgss-mediawiki.js` once as a wiki gadget or page-level script. The suggested
[template text](Template-CGSSCard.wikitext) accepts a card ID as its first
parameter and outputs only the container our player reads:

```html
<div class="cgss-mediawiki-card"
     data-cgss-card="{{{1|}}}"
     data-cgss-manifest-title="cgss-card-bundles.json.tiff"></div>
```

We can then use `{{CGSSCard|301202}}` on a card page. The manifest maps that ID
to either `card_cartoon_301202.unity3d.tiff` or a numbered list of `.tiff`
parts. The `.tiff` suffix satisfies the wiki filename rule. The uploaded bytes
remain UnityFS or JSON data and must not be converted by an image optimizer.
We intentionally do not copy the older template's time, duration, framing,
particle, namespace, or version attributes because this player does not accept
those controls through template data.

We scan these containers when the one script starts and create only a canvas
inside each container. We keep the player's native square render coordinates,
then crop the MediaWiki container to the attachment named `bg`. We do not use the
whole background skeleton because it can contain animated bones outside the
rectangular card background. This keeps character and effect scale unchanged
while clipping everything outside the actual card frame. We show a grey
`LOADING...` surface until the selected bundle has finished loading. These
presentation rules apply only to the MediaWiki build.

Some older cards use names such as `BG` or `bg3`. We match exact `bg` without
case sensitivity first. When it is absent, we select the largest active,
normally blended attachment with a card-like aspect ratio. We use attachment
geometry rather than card IDs, so the same rule covers these naming variants.
We can set `data-cgss-bundle-url` instead of
`data-cgss-file-title` when the bundle is hosted at a direct URL. We can set
`data-cgss-api-url` if the page does not expose `mw.util.wikiScript('api')`.
The template can substitute its card-ID parameter into the file title. We do
not need inline JavaScript in the template, which many wiki configurations
restrict.

We can mount containers added after initial page load with
`CGSSMediaWiki.mountAll()`. We can retrieve their player with
`CGSSMediaWiki.getPlayer(element)` for custom controls or cleanup.

For a page that does permit direct JavaScript, we also expose a manual API:

```js
const player = CGSSMediaWiki.createPlayer(document.querySelector('#cgss-card'));
await player.load({cardId:'301202', manifestTitle:'cgss-card-bundles.json.tiff', apiUrl:'/api.php'});
```

We can omit `apiUrl` if `mw.util.wikiScript('api')` is available. The manual API
also accepts `{file: input.files[0]}` for a browser-selected local bundle. Each `load()`
replaces the previous card. We expose `play()`, `pause()`, `renderOnce()`,
`summary`, `diagnostics`, and `dispose()` on the player. We do not hard-code a
wiki namespace, card ID, or asset location. The page must provide a reachable
card ID and manifest, bundle URL, File title, or local File. Remote URLs must allow browser access.
The wiki must allow the container's `data-*` attributes and the bundle file.

## Prepare card uploads

We provide one local packaging command:

```powershell
npm run package:mediawiki-bundles -- <input-directory> <output-directory>
```

We copy cards up to 7,500,000 bytes as
`card_cartoon_<id>.unity3d.tiff`. We split larger cards into files such as
`card_cartoon_<id>.unity3d.part001.tiff`. We keep every generated file below
the wiki's 8,000,000-byte limit. We write `cgss-card-bundles.json.tiff` in the
same output directory.

The manifest uses this shape:

```json
{
  "version": 1,
  "chunkBytes": 7500000,
  "cards": {
    "301202": {
      "split": true,
      "partCount": 2,
      "parts": [
        "card_cartoon_301202.unity3d.part001.tiff",
        "card_cartoon_301202.unity3d.part002.tiff"
      ],
      "bytes": 11099656,
      "sha256": "7a0b0df8212f9f307235d555628f4e678e6cb3210a71a9d49d2e7728cb032fcc"
    },
    "201389": {
      "split": false,
      "file": "card_cartoon_201389.unity3d.tiff",
      "bytes": 7090583,
      "sha256": "cc9666151ef0c9c0b43f1b19a18a26d300edd8a8702737622b45b3c6ec4b1828"
    }
  }
}
```

We upload the manifest and every generated `.tiff` file. The player resolves
their original upload URLs through the MediaWiki API. It validates the listed
part count and combined byte length before parsing the reconstructed bundle.
We can override the default limit with `--chunk-bytes=<bytes>` and the manifest
name with `--manifest=<name>.tiff`.

We currently parse the bundle on the page's main thread. Large bundles may
briefly pause page interaction during decoding. We keep this path in one script
without relying on a blob worker, which some wiki content-security policies
may forbid.

## Maintenance

We edit the canonical `src/`, `web/`, and `runtime/` files, not the generated
`cgss-mediawiki.js` or `cgss-mediawiki.min.js`. We run `npm run sync:standalone`
after a player change. That command updates the standalone folder, the readable
MediaWiki script, and its minified copy. We run `npm run check:standalone` in
review or CI to catch any generated output going stale. We can build or check
both MediaWiki files with `npm run build:mediawiki` or `npm run check:mediawiki`.
We can also regenerate only the minified copy with `npm run minify:mediawiki`.
We run `npm install` once before these commands to install the Terser build dependency.

We recommend `cgss-mediawiki.min.js` for deployment when transfer size matters.
Its leading license block is preserved in full and identifies
`cgss-mediawiki.js` as the readable version.

We have verified that the single script loads a UnityFS 6 card and a UnityFS 8
card in a browser. This does not establish wiki hosting permissions, network
access, or visual parity for every card.

## Redistribution

The generated file contains the Spine runtime and embeds its license terms.
Its header credits KinomotoKazari and links the project repository. We identify
the project-authored code as MIT licensed, while retaining separate notices for
embedded third-party code.
We must review the Spine Runtimes Software License and obtain any permission
required for public MediaWiki deployment. A technically working script is not an
authorization to publish it. We must also follow the wiki's rules for hosting
game bundles and other third-party assets.
