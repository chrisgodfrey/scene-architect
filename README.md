---
title: Scene Architect
description: Build complete Foundry VTT scenes from a semantic brief and generated map
---

Scene Architect for Foundry VTT v14 creates **one coherently illustrated map with
editable native walls, doors and lights**. You exchange a coordinate-free scene
design request and a map reference with ChatGPT manually. Scene Architect then
compiles the design locally into bounded rooms, circulation, openings, features
and lights. No API key, generator service or asset library is required.

The semantic response describes what the scene needs, not where each item goes.
Scene Architect owns all coordinates and validates the complete result before
making it available. Successful generation therefore cannot hand the wizard an
invalid plan. The module exports a PNG reference from that plan and imports your
finished map as a single background. Machinery, pipes and scenery can flow across
grid boundaries. It does not assemble separate prop images or repeated texture
tiles in the current wizard.

New layout plans can describe lights by purpose, such as a magic portal, flame,
flickering lamp, steady lamp or ambient fill. Scene Architect links non-ambient
lights to visible features, applies bounded defaults, and validates animation
effects against the installed Foundry runtime before creating a scene.

**Alignment is a starting point, not a guarantee.** An image generator can move or
redraw architecture and light sources despite the reference. The required
**Fit Foundry scene** stage asks ChatGPT for geometry and lighting together,
validates both responses before saving either one, and provides one combined
preview and apply. Scene Architect itself does not run an image detector. Review
the result and make any remaining corrections in Foundry.

## Current build and installation

**0.2.0-alpha.14** makes map import an artwork-only decision and treats a pure
90-degree top-down orthographic projection as a hard map requirement. Its map
prompt tells the image generator to paint over the supplied reference on one flat
coordinate plane and explicitly rejects isometric, oblique and perspective
views. Stage 3 names the same projection requirement before map application
because the later scene-fit stage can move walls but cannot repair perspective.
Scene Architect does not automatically classify projection, so regenerate an
image that shows diagonal projection axes, perspective convergence,
foreshortening or visible vertical wall faces. This release also removes the
misleading pre-fit wall overlay from stage 3 and retains alpha.13's semantic
light-animation compatibility fallback. The current source uses five required
stages:
**Describe**, **Build**, **Generate map**, **Fit Foundry scene**, and **Test**.
Geometry and lighting are no longer separate or skippable stages.

### Install or update in Foundry

1. Publish or update the module from Foundry's **Add-on Modules** screen.
2. For a first installation, choose **Install Module** and paste this manifest URL:

   ```text
   https://raw.githubusercontent.com/chrisgodfrey/scene-architect/main/module.json
   ```

3. Restart Foundry if it is running, then hard-refresh the browser.
4. Open **Add-on Modules** and confirm Scene Architect reports
   **0.2.0-alpha.14**.

The [GitHub release](https://github.com/chrisgodfrey/scene-architect/releases/tag/v0.2.0-alpha.14)
also provides `scene-architect.zip` for manual installation. Existing world
scenes and uploaded artwork are preserved when updating.

For a manual server refresh, stop Foundry and replace the files in
`Data/modules/scene-architect/` with `module.json`, `README.md`, and the complete
`scripts/`, `styles/`, `templates/` and `fixtures/` directories from this checkout.
Restart Foundry, hard-refresh your browser and check the module version.
There is no runtime build step.

Alternatively, create the verified module archive:

```powershell
powershell -NoProfile -File tools/package-module.ps1
```

Extract `dist/scene-architect.zip` into that module directory. The archive has
`module.json` at its root. It excludes tests, dependencies and experiments.

For **Foundry's updater**, a published GitHub release tagged `v0.2.0-alpha.14` must
contain `scene-architect.zip` and `module.json`. A source push alone does not create
those assets and will cause a download “Not Found” error if the manifest points to
an unpublished release. Prepare the release assets before exposing that manifest.

## Intended flow

1. As GM, open **Scenes → Scene Architect**. Load the laboratory example, or enter
   a brief, select **Copy scene design request**, and send it to ChatGPT. Select
   **Import generated scene design** with the returned JSON. ChatGPT supplies room
   purposes, contents and a circulation style; Scene Architect deterministically
   chooses all geometry and advances directly to **Build draft scene** only when the
   compiled plan is complete and valid.
2. **Build draft scene**. This validates every wall and light first, then creates
   the scene, native walls, doors, purposeful lights and schematic reference
   background. It does not create prop Tiles.
3. **Export PNG reference** and **Copy map prompt**. Attach the PNG in ChatGPT with
   that prompt. Generate and download **one complete map image**.
4. Choose that image under **Import the map**, then **Preview the artwork**. Scene
   Architect automatically fits it to the full scene. Judge the theme, contents
   and framing here, not wall alignment: generated architecture can move away
   from the reference. Choose **Use this artwork and continue to scene fitting**.
   The original walls remain unchanged until the required fit in the next step.
5. Use **Fit the Foundry scene**. Choose **Copy complete scene-fit prompt** in the
   original map conversation. ChatGPT returns one wrapper containing geometry and
   lighting. Import it, inspect the combined overlay, and apply it. For an external
   image or different conversation, choose **Download comparison and copy prompt**,
   attach that PNG, and send the prompt copied by Scene Architect.
6. In Foundry, set scene darkness high enough to see the lights. Check their
   positions and effects, wall occlusion, doors, movement and token vision.
7. Reopen the wizard to reuse the saved original image or import a replacement.
   Applying again preserves all current native walls, doors, lights and Tiles.

The happy path uses five clipboard handoffs: scene request out, scene intent back,
map prompt out, complete scene-fit prompt out, and complete scene-fit JSON back.
You also attach one reference PNG and select one generated map image. The
fitted-image scene-fit path adds one comparison PNG attachment but no second text
exchange.

Settings and file selections save when you apply. Leaving the file input empty
reuses the saved source. The module always fits from the original image, avoiding
repeated resampling of an already fitted background.

## If a scene design cannot be compiled

The primary import accepts semantic scene intent, not authored geometry. Scene
Architect rejects malformed input, unsupported contract versions or light presets,
too many rooms, or contents that cannot fit without overlap. A failed import is
atomic: it returns no partial plan, preserves the current valid plan if one exists,
and never starts a plan-repair loop. Correct the scene-design JSON or revise the
brief and request a new design.

Current compilation limits are 20 requested rooms and 16 instances for each
feature declaration. The compiler supports linear and central-corridor circulation;
it chooses central-corridor by default for scenes with three or more rooms.

## Advanced: low-level plan JSON and correction

Expand **Advanced: import or edit low-level plan JSON** only when you intentionally
need direct control over coordinates, room rectangles, openings and feature
footprints. **Copy low-level plan request** preserves the earlier full-plan workflow
for compatibility with saved plans and specialist editing.

Scene Architect validates advanced low-level plan JSON before it creates anything.
If the plan has overlapping props, invalid room geometry, blocked openings, missing
light links or another structural problem:

1. Read the persistent **Advanced plan not accepted** message. It contains the exact first
   validation error; your rejected JSON is retained while the wizard stays open.
2. Select **Copy correction request**.
3. Return to the same ChatGPT conversation and paste the request. It includes the
   original rules, the exact error and the complete rejected plan, and asks for
   one corrected full JSON object without redesigning valid content.
4. Copy ChatGPT's complete corrected JSON.
5. Back in Scene Architect, select **Import corrected plan JSON**. The dialog is
   prefilled with the rejected candidate so you can also edit it manually.
6. Repeat the correction loop if another validation error appears. When the plan
   passes, the wizard returns to **Build draft scene**.

Scene Architect does not silently move, shrink or delete props because several
different fixes may be valid. It automates the feedback request and validates
every advanced low-level retry. To start over instead, use **Copy fresh low-level
plan request**.

## Fit the finished map

1. Apply the final map background.
2. In the original image-generation conversation, choose **Copy complete
   scene-fit prompt**. The prompt contains registered wall, passage, managed-light,
   and protected-light context. Do not attach the image again.
3. If the image was edited, imported externally, or generated elsewhere, choose
   **Download comparison and copy prompt**. Attach that exact PNG and paste the
   prompt copied by Scene Architect.
4. Import the one returned `scene-fit` JSON wrapper. Scene Architect validates the
   complete geometry and lighting objects independently. If either object fails,
   neither proposal is saved. Use **Copy complete correction request** to retain
   the full rejected response and exact domain-specific validator error.
5. Inspect the combined overlay, acknowledge any flagged items, and choose
   **Apply walls and managed lights**. Test the result in Foundry.

**Apply walls and managed lights replaces ALL walls and doors plus every
Scene Architect-managed light.** Manual and other-module lights are protected and
remain unchanged. The operation also preserves the background, Tiles, and tokens.
Imported doors start closed.

Independent backups retain prior walls and managed lights. Replacement and wall
restoration create new wall document IDs, so references from other modules may
need updating. Only one snapshot is retained for each domain. Export the scene in
Foundry if you need a longer history.

The combined apply rechecks the map frame, walls, managed lights, and protected
lights before mutation. Under unchanged signatures, a lighting failure after wall
replacement triggers compensating wall restoration. If another client changes the
scene or compensation fails, Scene Architect stops rather than overwriting the
changed state, preserves durable backups, and displays explicit recovery guidance.
This is guarded compensation, not a claim of cross-client transaction atomicity.

Analysis coordinates are normalized either to the unchanged generated source or
to the fitted fallback image. Source coordinates are transformed and clipped to
the visible scene locally. Fitted coordinates are rounded only to scene pixels,
never to grid squares. Diagonal segments are supported. The prompt includes an
image or generation identifier and dimensions which the returned JSON must preserve.
Changing the background path or scene dimensions invalidates the analysis. A newly
selected image must be applied first. Editing native walls after preview
requires another preview before applying. Editing native walls or lights after
copying a scene-fit prompt invalidates its registered prior, so copy or export a
fresh request before importing the returned JSON. Do not modify the background file in place:
import it again so its new path invalidates old analysis.

Validation checks schema, image identity, finite in-range coordinates, unique IDs,
nonzero lengths and overlapping spans, including solid walls covering doors or
passages. Registered requests also require every current wall and planned open
passage to be represented or explicitly removed; omissions are treated as proposed
removals and require explicit review. Unknown document fields are discarded.
The combined wrapper is limited to 2 MB. Geometry remains limited to 2000
segments, and lighting remains limited to 100 proposed lights. These checks do not
prove visual accuracy, connected rooms, leak-free vision, shader appearance, or
token-vision quality. Secret doors and plan-informed geometry are always marked
for review.

There is no API service or automatic model call. The same-chat path adds one text
exchange. The fallback adds one image-and-text exchange. The earlier laboratory
proof was a successful qualitative check on one mostly rectangular image, not a
reliability benchmark. Its experimental JSON lacks the production identifier:
request new JSON using this workflow.

## Purposeful lights

New semantic lights use one of six presets: `steady-lamp`,
`flickering-lamp`, `flame`, `magic-portal`, `pulsing-magic` or
`ambient-fill`. A non-ambient light must reference a visible feature, so its
native AmbientLight document is centred on the lamp, flame or portal that the map
prompt asks ChatGPT to draw. Ambient fill instead references a room and an explicit
point inside it.

Presets provide a complete starting configuration. For example, a magic portal
uses Foundry's `rainbowswirl` effect and an unreliable lamp uses `flicker` when
those animation keys are installed. Plans can supply bounded overrides for radius,
angle, colour, alpha, attenuation, luminosity, saturation, contrast, shadows,
animation speed, intensity and direction. Existing coordinate-based lights remain
supported. If a semantic preset's preferred animation is unavailable, Scene
Architect creates a steady light with the same radii and colour. An unavailable
explicit animation override still stops draft creation before Scene, Wall or
AmbientLight documents are written.

These lights are starting points, not visual acceptance. Map generation can move
the painted source, add visible lamps, or omit an intended source, and every
Foundry theme or world may display an effect differently. The required scene-fit
stage compares these managed lights with tangible emitters while fitting geometry
in the same exchange.

## Scene-fit lighting safety

The combined response still uses the dedicated lighting validator. It checks
request and image identity, coordinates, semantic preset,
`small`/`medium`/`large` spread, optional colour, evidence, source
correspondence, removals, runtime animation availability, and all managed source
IDs. A partial lighting object or geometry-only response cannot advance the
workflow.

The combined preview shows current and proposed light centres and radii alongside
current and proposed geometry. Solid inner circles are bright radii and patterned
outer circles are dim radii. Review every centre, preset, spread, resolved radius,
colour, animation, source change, and warning. A model can mistake reflections or
baked illumination for emitters. Only tangible lamps, flames, portals, and similar
sources should become native lights.

The apply operation replaces only lights carrying the Scene Architect ownership
flag. Manual and other-module lights are protected. **Restore previous managed
lights** provides one-level light undo independently of **Restore previous walls**.

Every request signs the current background fit, managed lights and protected
light context. Adding, moving, resizing, recolouring, reconfiguring or deleting any
native light after a request invalidates its proposal and requires fresh analysis.
A protected-context signature is freshness evidence only; it never grants Scene
Architect permission to replace that light.

ChatGPT chooses a normalized centre, semantic preset, spread class and optional
bounded colour. Scene Architect converts that intent to complete Foundry data.
`small`, `medium` and `large` multiply the preset's base bright/dim radii by
`0.75`, `1` and `1.5`, respectively. Runtime animation keys remain locally
validated. The static comparison does not simulate shader appearance, darkness,
wall occlusion or token vision.

After applying, set scene darkness high enough to inspect every source. Confirm
centre placement, bright and dim reach, animation choice, wall occlusion, darkness,
token vision and preservation of manual lights. This live Foundry check is the
visual acceptance gate.

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
   Preview and reapply the saved source; native geometry must stay fixed.
6. Request one complete scene fit, import it, and compare current and proposed
   walls and light radii in the combined overlay. Confirm that import alone changes
   no native documents. Apply and verify that the protected GM light remains
   unchanged.
7. Test doors and token vision, then use **Restore previous managed lights** and
   **Restore previous walls**. Check that each prior snapshot returns without
   overwriting the other domain, artwork, or Tiles.

To test the import mechanics before generating art, use the exported reference PNG
as the input image. Its labels are part of that test image and will remain visible;
this checks file handling and full-scene fitting only, not final visual quality.

Report the Foundry/module versions, the step that failed, expected versus actual
behaviour and any browser-console error. For image alignment feedback, distinguish
an overall shift/scale problem from individual rooms or doors being redrawn.

## Automatic fitting and manual edits

The initial fit maps the image's full rectangle to the scene's full rectangle.
A different aspect ratio stretches the image; both preview and confirmation warn
about this. Request the reference's aspect ratio and inspect the result. The wizard
does not expose manual scale or offset controls. Those global adjustments cannot
correct local changes in room shape; complete the required scene-fit stage, then
edit any remaining local differences with Foundry's wall controls.

The overlay always reads **live wall coordinates and door types**. Geometry
changes are advisory, not a requirement to undo your work. Exported references
also use live walls, but room fills, labels and numbered feature footprints still
come from the original plan. They do not reconstruct rooms from edited walls.

Native edits are stored by Foundry. **Download original plan JSON** exports the
original plan; it does not include your subsequent wall edits or imported map.
**Import / edit low-level plan JSON** and **Build a new scene from plan** start a
new scene and leave the previous scene intact. Use Foundry's scene export and copy
its referenced image files when transferring a finished scene.

The wizard supports one level, zero scene padding/grid shift, and default level
background transforms. New drafts use those settings. If changed externally,
reset them before previewing the map; wall and door edits remain valid.

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
Project data lives in `flags.scene-architect.plan`; the image source and full-scene
fit metadata are in `flags.scene-architect.map`. A revision marker rejects stale
saves from another wizard (best effort, not a distributed lock).

Analysis state uses `flags.scene-architect.geometryRequest`, `geometryProposal`
and `geometryBackup`, plus matching `lightingRequest`, `lightingProposal`, and
`lightingBackup` flags. The primary workflow creates and consumes both domains as
one scene-fit bundle. Independent flags preserve validator boundaries and recovery
snapshots.

Successful application writes `flags.scene-architect.sceneFit` with the exact map
frame. Replacing the map invalidates that marker and returns the workflow to
**Fit Foundry scene**. Manual wall or light edits after a successful fit remain
supported and do not clear completion. Do not run simultaneous scene-fit
operations from different GM clients. Scene signatures and the local operation
guard are best effort, not a server-side transaction.

If an upload fails, the current background stays in place. A background-update
failure attempts to restore it; the uploaded source/settings may already be saved
so you can retry. Server-side partial failures can require manual recovery.

## Limits

- Initial plans use rectangular rooms and orthogonal walls. You can edit native
  walls freely afterward; the module does not rebuild them on image import.
- Semantic scene generation supports bounded linear and central-corridor layouts.
  It guarantees structural validity, not a unique or artistically optimal layout.
- No built-in automatic tracing, image segmentation, per-asset imports or model
  API integration. Geometry analysis is a manual exchange followed by a reviewed
  JSON import.
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

Local verification for the current source: **73 unit tests and 106 browser assertions**
passed. Coverage includes coordinate-free scene-intent prompting, deterministic
compilation across both circulation styles and 1–20 requested rooms, atomic
capacity failure, advanced plan-validation correction and retry, full-map import,
exact output dimensions, live edited wall overlays, omission of overlays from the
uploaded background, automatic fit, saved-source reuse, preservation of native
edits and Tiles, cancelled application, upload failure and background rollback.
Retained legacy renderer checks also run.
Additional coverage includes analysis-image export, image identity, invalid/overlapping
geometry, final-geometry correction and retry, review acknowledgement, cancelled
replacement, stale previews, preservation of other scene documents, saved proposals,
restoration and partial write recovery.
Combined scene-fit coverage includes atomic geometry and lighting validation, one
same-chat wrapper prompt, one fallback comparison, a combined overlay, protected
light preservation, compensated lighting failure, frame-bound completion, and
independent one-level wall and managed-light restoration.
The reference and wizard screenshot were visually inspected.

Canvas rendering and PNG encoding/decoding run in a real browser. **Foundry host,
document and upload APIs are mocked.** Verification on the user's Foundry server
remains necessary.

Code: `scene-architect.js` owns the wizard; `plan-generator.js` compiles semantic
scene intent into validator-approved plans; `image-geometry.js` handles wall
analysis prompts, validation, overlays, replacement and recovery;
`image-lighting.js` handles managed/protected light registration, validation,
comparison, replacement and restoration; `scene-fit.js` composes both contracts
and guards the combined operation; `whole-map.js`
handles references, prompts and full-map rendering; `plan.js`, `geometry.js` and
`foundry-data.js` provide initial geometry and deterministic light configuration;
`project.js` saves project state. Legacy art modules are retained for compatibility.
The abandoned atlas experiment is outside the runtime package and is not part of
this workflow.
