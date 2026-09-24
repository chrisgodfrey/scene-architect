# Scene Architect

Scene Architect for Foundry VTT v14 creates **one coherently illustrated map with
editable native walls, doors and lights**. You exchange a layout request and a map
reference with ChatGPT manually. No API key, generator service or asset library is
required.

The module generates the initial Foundry geometry from a plan, exports a PNG
reference, and imports your finished map as a single background. Machinery,
pipes and scenery can flow across grid boundaries. It does not assemble separate
prop images or repeated texture tiles in the current wizard.

**Alignment is a starting point, not a guarantee.** An image generator can move or
redraw architecture despite the reference. Scene Architect does not detect walls
from pixels. Review the overlay and adjust native walls and doors to match the art.

## Current build and installation

**0.2.0-alpha.3** introduces the complete-map workflow. Update Scene Architect in
Foundry's Add-on Modules screen, then hard-refresh your browser. Confirm the
installed version is **0.2.0-alpha.3**. The [GitHub release](https://github.com/chrisgodfrey/scene-architect/releases/tag/v0.2.0-alpha.3)
also provides the module ZIP for manual installation.

For a manual server refresh, stop Foundry and replace the files in
`Data/modules/scene-architect/` with `module.json`, `README.md`, and the complete
`scripts/`, `styles/`, `templates/` and `fixtures/` directories from this checkout.
Restart Foundry, hard-refresh your browser and check the module version.
Existing world scenes and artwork are preserved. There is no runtime build step.

Alternatively, create the verified module archive:

```powershell
powershell -NoProfile -File tools/package-module.ps1
```

Extract `dist/scene-architect.zip` into that module directory. The archive has
`module.json` at its root. It excludes tests, dependencies and experiments.

For **Foundry's updater**, a published GitHub release tagged `v0.2.0-alpha.3` must
contain `scene-architect.zip` and `module.json`. A source push alone does not create
those assets and will cause a download “Not Found” error if the manifest points to
an unpublished release. Prepare the release assets before exposing that manifest.

## Intended flow

1. As GM, open **Scenes → Scene Architect**. Load the laboratory example, or enter
   a brief, **Copy layout request**, send it to ChatGPT and **Import / edit plan JSON**
   with the returned layout.
2. **Build draft scene**. This creates the scene, native walls, doors and lights,
   and a schematic reference background. It does not create prop Tiles.
3. **Export PNG reference** and **Copy map prompt**. Attach the PNG in ChatGPT with
   that prompt. Generate and download **one complete map image**.
4. Choose that image under **Import and align the map**, then **Preview alignment**.
   Yellow lines are current walls, blue lines are ordinary doors, and purple lines
   are secret doors. Toggle the overlay off to inspect the artwork alone.
5. If necessary, change **Scale (%)**, **Horizontal offset** or **Vertical offset**,
   then preview again. **Apply map background** saves the source and alignment and
   replaces the background. The coloured overlay is never baked into the map.
6. **View scene**. Use Foundry's wall controls to move endpoints, reposition doors,
   and add or remove wall segments where the illustration differs. Adjust lights
   and test movement and vision with a player token.
7. Reopen the wizard to reuse the saved original image or import a replacement.
   Applying again preserves all current native walls, doors, lights and Tiles.

Settings and file selections save when you apply. Leaving the file input empty
reuses the saved source. The module always fits from the original image, avoiding
repeated resampling of an already fitted background.

## Quick server test

1. Load the laboratory and build a **new** draft. Expect a 28×24 scene at 70px per
   square, five rooms, two ordinary doors, one secret door, one open passage and
   three native lights. Expect **zero generated prop Tiles**.
2. Export the PNG and attach it with the copied prompt in ChatGPT. The prompt asks
   for all 11 illustrated features, including three restraint beds. These are
   requested illustration details, not mechanically guaranteed image counts.
3. Import the returned full map, preview the overlay and apply it. Check the
   machinery reads as part of the complete illustration and no guide labels remain.
4. Move one wall endpoint and reposition a door in Foundry. Reopen Scene Architect,
   preview and apply again. Both edits must remain; a geometry difference must not
   block the import. Open/close the doors and test token vision and collision.
5. Close/reopen the wizard and refresh the browser. Confirm the saved image returns.
   Try a small image offset, preview and reapply; native geometry must stay fixed.

To test the import mechanics before generating art, use the exported reference PNG
as the input image. Its labels are part of that test image and will remain visible;
this checks file handling and alignment only, not final visual quality.

Report the Foundry/module versions, the step that failed, expected versus actual
behaviour and any browser-console error. For image alignment feedback, distinguish
an overall shift/scale problem from individual rooms or doors being redrawn.

## Alignment and manual edits

The initial fit maps the image's full rectangle to the scene's full rectangle.
A different aspect ratio stretches the image; both preview and confirmation warn
about this. Request the reference's aspect ratio and inspect the result. Scaling
is centred on the canvas; positive offsets move the art right/down. Enlarging or
shifting can crop edges, and uncovered space is filled dark. These controls cannot
correct local changes in room shape: edit the relevant Foundry walls instead.

The overlay always reads **live wall coordinates and door types**. Geometry
changes are advisory, not a requirement to undo your work. Exported references
also use live walls, but room fills, labels and numbered feature footprints still
come from the original plan. They do not reconstruct rooms from edited walls.

Native edits are stored by Foundry. **Download original plan JSON** exports the
original plan; it does not include your subsequent wall edits or imported map.
**Import / edit plan JSON** and **Build a new scene from plan** start a new scene
and leave the previous scene intact. Use Foundry's scene export and copy its
referenced image files when transferring a finished scene.

The wizard supports one level, zero scene padding/grid shift, and default level
background transforms. New drafts use those settings. If changed externally,
reset them before using the alignment preview; wall and door edits remain valid.

## Existing scenes and files

Valid older plans can reopen. Old art manifests and assignments are retained for
compatibility, but the wizard no longer asks for individual assets or renders them.
It does not automatically alter an existing scene when opened.

Older generated prop Tiles remain above any replacement background. The wizard
warns when they exist. For a clean whole-map test, build a new draft from the plan;
otherwise remove unwanted old Tiles using Foundry's controls. Unrelated Tiles are
also preserved.

World uploads live under `worlds/<world-id>/scene-architect/`. Original sources and
previous backgrounds are retained. Unused files are not automatically deleted.
Project data lives in `flags.scene-architect.plan`; the new image source and
alignment are in `flags.scene-architect.map`. A revision marker rejects stale
saves from another wizard (best effort, not a distributed lock).

If an upload fails, the current background stays in place. A background-update
failure attempts to restore it; the uploaded source/settings may already be saved
so you can retry. Server-side partial failures can require manual recovery.

## Limits

- Initial plans use rectangular rooms and orthogonal walls. You can edit native
  walls freely afterward; the module does not rebuild them on image import.
- No automatic tracing, image segmentation, per-asset imports or API generation.
- No guarantee that generated room shapes, door positions or feature counts
  match the reference. Native geometry follows the plan until you adjust it.
- Doors drawn into the artwork remain static. The prompt requests ordinary doors
  drawn open, but check the generated result. Review secret-door concealment too.
- Whole-map features are painted into the background; they are not movable props.
- PNG, JPEG and WebP inputs: up to 30 MB and 40 megapixels. Fitted images and
  references: up to 8192px per side and 24 megapixels.
- Image quality and generation fidelity require visual assessment. Synthetic
  tests do not establish how much wall correction an actual generated map needs.

## Development verification

With Node 22+:

```powershell
npm ci
npm test
npm run test:browser
```

The browser harness uses isolated headless Edge on Windows. Set
`SCENE_ARCHITECT_BROWSER` to another Chromium executable if necessary. It writes
results, a reference PNG and a wizard screenshot to ignored `test-output/`.

Local verification for this change: **26 core tests and 35 browser assertions**
passed. Coverage includes full-map import, exact output dimensions, live edited
wall overlays, omission of overlays from the uploaded background, offsets,
saved-source reuse, preservation of native edits and Tiles, cancelled application,
upload failure and background rollback. Retained legacy renderer checks also run.
The reference and wizard screenshot were visually inspected.

Canvas rendering and PNG encoding/decoding run in a real browser. **Foundry host,
document and upload APIs are mocked.** Verification on the user's Foundry server
remains necessary.

Code: `scene-architect.js` owns the wizard; `whole-map.js` handles references,
prompts and full-map rendering; `plan.js`, `geometry.js` and `foundry-data.js`
provide initial geometry; `project.js` saves project state. Legacy art modules are
retained for compatibility. The abandoned atlas experiment is outside the runtime
package and is not part of this workflow.
