# Scene Architect — scene art kits

Source version **0.2.0-alpha.2**, targeting **Foundry VTT 14.365**.
Foundry's updater needs a published release ZIP at the manifest's download URL;
pushing this source code alone does not create it. No AI API or external asset
library is required.

**Description → structured plan → exact geometry → scene-specific art kit → deterministic assembly → playable Foundry scene.**

Scene Architect controls geometry, counts, footprints and rotations. ChatGPT supplies
separate material and prop images through a manual exchange. An image model never
needs to trace a floor plan or arrange a precise sprite sheet.

## Update your existing alpha.8 installation

There are two installation paths: upload the module files manually, or publish the
release ZIP so Foundry's updater can download it.

### Foundry updater: resolve a release ZIP “Not Found” error

The manifest points to the release asset named `scene-architect.zip` under tag
`v0.2.0-alpha.2`. A source push updates the manifest but does not create that release
asset. If it is missing, Foundry reports “Not Found” and cannot install the update.

From the repository root, build and verify the archive:

```powershell
powershell -NoProfile -File tools/package-module.ps1
```

Then create a GitHub release tagged **v0.2.0-alpha.2** from the commit containing this
version. Attach **dist/scene-architect.zip** and **dist/module.json**, and publish the
release (a draft is not publicly downloadable). The ZIP's filename and tag must match
the manifest exactly. GitHub's automatic “Source code” downloads do not replace this
asset. Packaging locally does not publish anything.

Once that asset is available, retry the module update in Foundry and hard-refresh your
browser. Confirm the installed version is **0.2.0-alpha.2**. For future versions, prepare
the archive and its release asset before exposing a manifest that points to them.

### Manual installation without a GitHub release

1. Stop Foundry on the VM.
2. Copy this checkout's `module.json`, complete `scripts/`, `styles/`, `templates/`
   and `fixtures/` into the existing `Data/modules/scene-architect/` directory,
   replacing the matching files. Include **all** scripts and the new fixtures directory.
3. Start Foundry and hard-refresh your browser to load the new JavaScript and template.
4. Confirm the installed module version is **0.2.0-alpha.2**. Keep Scene Architect
   enabled in your world. Existing scene data and uploaded artwork live in world data;
   replacing the module files does not migrate or render those scenes automatically.

There is no runtime build step. Omit `node_modules/`, `tests/` and `test-output/`.

## First test: geometry and persistence, without generating art

1. Open **Scenes → Scene Architect → Load laboratory example → Build draft scene**.
2. Enable **Allow labelled synthetic placeholders**, then **Save settings**.
3. Choose **Preview assembled scene**, then **Render to Foundry**. Expect five rooms,
   exactly three restraint beds and 11 editable prop/decal Tiles overall.
4. Open and close native doors, inspect grid alignment and try moving a prop Tile.
5. Close/reopen the wizard. Confirm it restores the linked scene and settings.
6. Move a native wall and try rendering again. It must refuse with a geometry conflict.
   Undo the wall move to resume. Re-rendering replaces generated Tile placements only
   after confirmation; native walls remain untouched.

This establishes whether the module works in your actual Foundry installation before
spending time generating the art kit. Placeholder appearance is intentionally basic.

## Intended workflow with your artwork

1. As GM, open **Scenes → Scene Architect**.
2. Choose **Load laboratory example**, then **Build draft scene**. Alternatively,
   describe a map, copy its layout request to ChatGPT, and import the returned JSON.
3. Choose **Copy artwork requests**. The prompt requests the complete kit sequentially,
   with one separate image per used slot and no confirmation between assets. Download
   the images individually. Generation limits may still interrupt completion; the prompt
   asks the model to identify completed and remaining slots so you can resume. Requests
   include intended proportions and shared art direction.
4. Expand a slot, choose PNG, JPEG or WebP, adjust crop percentages and **Preview crop / fit**.
   **Contain** shows the entire crop with transparent space around it; **Cover** fills
   the footprint and clips excess. Both preserve aspect ratio. Use Cover for material
   swatches when you want a filled square repeat.
5. **Upload / save this slot**. Alpha is preserved. Opaque backgrounds remain visible:
   there is no automatic background removal. The sampled transparency warning is
   advisory; inspect the checkerboard preview yourself.
6. Save material repeat size, wall width and shadow settings. Choose **Preview assembled
   scene**, then **Render to Foundry**.
7. Floors, surrounding rock and textured boundaries become a static PNG background.
   Props and decals become editable Tiles. Use native walls, doors and lights in play;
   the renderer adds no grid.
8. Reopen the wizard while viewing the scene, or select it in **Reopen**. Saved image
   assignments, crops, references and rendering settings return.

To test without artwork, enable **Allow labelled synthetic placeholders**, **Save settings**,
then preview/render. Missing images normally block rendering. The laboratory has
**three restraint beds sharing one image**, two medical beds sharing another, two broken
constructs sharing another, an Instantiator, generator, stairs and vapour decal:
**11 feature instances and 11 required images** (four materials, seven prop/decal images).
Placeholders are deliberately labelled and do not represent finished visual quality.

Slots save individually. Save a file selection/crop before other project actions or
closing the wizard. Imported plans are saved when you build their first draft.
**Import / edit plan JSON** starts a new project; **Build a new scene from plan** leaves
the original scene intact.

## Geometry and manual edits

The **saved rectangular plan is the source of truth** for assembled artwork. Before
preview, rendering or SVG guide export, the module compares native walls, door types,
blocking rules, scene dimensions, padding, grid offsets and background transforms with
that plan. Conflicts block the operation and explain reconciliation. Door open/closed/
locked state and harmless grid-edge wall segmentation do not cause conflicts.
Existing native walls are never replaced.

Reconcile by undoing the native change, or downloading the plan, updating its rooms,
openings or barriers, reimporting it and building a new scene. Arbitrary wall-to-room
reconstruction is not supported. Reset changed background transforms to zero offset/
rotation and unit scale. Only one scene level is supported.

Props use top-left x/y and width/height in **cells**, with clockwise rotation about their
footprint centre. Rotated footprints must fit inside a room. Overlapping props, blocked
doorway approaches (half a cell on both sides), invalid asset references, out-of-bounds
geometry, overlapping rooms and openings not on walls are rejected. Decals may overlap
props. Disconnected rooms produce a warning. Connectivity checks do not solve pathfinding
around furniture or interior barriers: review token circulation yourself.

Moving generated Tiles in Foundry does not update saved features. Re-rendering asks
before replacing generated Tiles, including manual edits. Other Tiles, native walls and
lights remain. Edit the plan to retain a placement on subsequent renders. Uploaded
sources and previous render files are retained; unused files are not deleted automatically.

Door, secret-door and window spans remain visually clear. There is **no door-leaf art or
window framing** in this milestone, so a closed door is never permanently painted into
the background. Secret passages are visible in the art even though native secret-door
controls are hidden from players. Do not rely on this art treatment to conceal entrances.
New multi-cell doors are one native door each; old per-cell doors remain untouched.

## Manifest and compatibility

See [fixtures/laboratory.json](fixtures/laboratory.json). Plans use `version: 2`; the
independently versioned art manifest uses `art.version: 1`. Valid version-1 plans migrate
in memory and save only through a user action. Migration creates deterministic material
IDs and one prop slot per legacy feature, without guessing which machines share art.
Use **Edit art descriptions / reuse slots** to reference one asset ID from repeated
features. Old plans failing strengthened validation need correction before use; unknown
future versions are rejected.

| Data | Purpose |
| --- | --- |
| `art.direction` | Shared palette, perspective and lighting guidance |
| `art.assets[]` | Stable ID, kind, description, width:height ratio and image requirements |
| `spaces[].floorAsset` | Floor material reference |
| `features[].assetId` | Shared prop image reference |
| `features[].roomId / rotation / layer` | Placement room, clockwise angle, prop or decal |
| `art.surroundAsset / wallAsset` | Surround and wall material references |
| `art.assignments[id]` | Persistent source path, contain/cover fit, normalized crop, metadata |
| `art.settings` | Material repeat, wall width, contact shadows and placeholder mode |

The complete plan is stored at `flags.scene-architect.plan`. A revision marker detects
stale saves from another wizard (best effort, not a distributed lock). Exported JSON
contains assignments/settings but no image bytes; transferring worlds requires copying
referenced files too. Only used slots appear in requests/import controls. Identical prop
footprints reuse one source and one fitted texture.

## Verification

Node 22+ is required for the development harness:

```powershell
npm ci
npm test
npm run test:browser
```

The browser runner uses an isolated headless Edge profile on Windows. Set
`SCENE_ARCHITECT_BROWSER` to another Chromium executable if necessary. It binds a
short-lived localhost server and writes results, synthetic assembled PNGs and a wizard
screenshot into ignored `test-output/`. Handlebars is a development-only dependency;
Foundry supplies it at runtime.

Automated tests cover geometry, validation, multi-cell/legacy doors, references, rotation,
placement, shared assets, persistence, removal of old assignments, conflicts, Tile
replacement and rollback. Browser checks inspect real Canvas pixels and PNG alpha and
run the production Handlebars template and UI handlers. **Foundry document, upload and
application APIs are mocked.** This does not establish real-world Foundry integration.

Local verification on 2026-09-24: **21 core tests and 28 headless-browser assertions
passed**. The synthetic assembly and wizard screenshot were visually inspected.

### Manual verification in Foundry 14.365

1. Build the laboratory in a test world. Confirm five rooms, two ordinary doors, one
   secret door, one open passage, three native lights and a 28×24 / 70px canvas.
2. Render placeholders. Count three restraint beds, two medical beds, two construct
   piles and four other objects (11 Tiles). Inspect circulation with the native grid.
3. Import transparent PNG, opaque JPEG and non-square WebP examples. Test crop,
   Contain/Cover, preserved alpha, visible opaque backgrounds, rotation and shadows.
4. Close/reopen and refresh the browser. Check paths, crops and settings. Export JSON,
   import it into a new project and verify references survive.
5. Open, close and lock doors; ensure no closed door leaf persists in the background.
   Test native collision, vision and lighting with a player token.
6. Move/delete a wall or change a door type. Reopen and attempt preview/render/SVG:
   operations must refuse without altering the scene. Undo and retry. Repeat with a
   grid shift or background transform.
7. Move a generated Tile and add an unrelated Tile. Cancel re-render first, then accept:
   generated Tiles reset while unrelated Tiles and walls remain.
8. Reopen a valid alpha.8 plan with a wide doorway. Verify migration without wall writes.
   Keep a copy of old JSON when correcting validation errors.
9. Test upload failures, missing paths, slow uploads and another GM editing the project.
   Previous art should survive ordinary failures. Server-side partial failures may need
   manual recovery; rollback is best effort.

API shapes were checked against official v14.365 documentation for
[TileData](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.TileData.html),
[LevelData](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.LevelData.html),
[WallData](https://foundryvtt.com/api/v14/interfaces/foundry.documents.types.WallData.html)
and [DialogV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.DialogV2.html).
Actual Foundry runtime verification remains outstanding.

When reporting feedback, include the Foundry/module versions, the button or step that
failed, what happened versus what you expected, and any notification or browser-console
error. Note whether you used the laboratory fixture or an older saved scene.

## Limits

- Rectangular rooms, orthogonal boundaries, one level; no polygon or wall reconstruction.
- No image generation during development, server AI integration or FA library dependency.
- No segmentation, sprite-sheet slicing, background removal, door-leaf art, pipe/cable
  routing or animated vapour. Vapour is a static decal below props.
- Tiling seams, palette coherence and final beauty depend on imported artwork; synthetic
  tests cannot establish production visual quality.
- Material scale is shared across surfaces. Crop/fit is shared per asset; different
  footprints fit the same source independently. Props do not add collision walls.
- Rendering is limited to 8192px per side / 24 megapixels; inputs to 30 MB / 40 megapixels.
  Large maps may still be slow on low-memory browsers.
- The former whole-map image handoff is superseded by this art-kit workflow. Existing
  backgrounds remain until the GM explicitly renders new artwork.

## Code layout

- `plan.js`: normalization, placement validation and connectivity warnings.
- `geometry.js`: exact segment compilation.
- `art-manifest.js`: migration, references, assignments and requests.
- `renderer.js`: Canvas assembly and fitting, independent of Foundry.
- `project.js`: persistence, conflicts and managed Tile application.
- `foundry-data.js`: native wall/light document data.
- `scene-architect.js`: Foundry application, dialogs, imports and workflow actions.
