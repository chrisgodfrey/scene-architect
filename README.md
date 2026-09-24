# Scene Architect

Scene Architect for Foundry VTT v14 creates **one coherently illustrated map with
editable native walls, doors and lights**. You exchange a layout request and a map
reference with ChatGPT manually. No API key, generator service or asset library is
required.

The module generates the initial Foundry geometry from a plan, exports a PNG
reference, and imports your finished map as a single background. Machinery,
pipes and scenery can flow across grid boundaries. It does not assemble separate
prop images or repeated texture tiles in the current wizard.

New layout plans can describe lights by purpose, such as a magic portal, flame,
flickering lamp, steady lamp or ambient fill. Scene Architect links non-ambient
lights to visible features, applies bounded defaults, and validates animation
effects against the installed Foundry runtime before creating a scene.

**Alignment is a starting point, not a guarantee.** An image generator can move or
redraw architecture and light sources despite the reference. You can ask ChatGPT
to analyse the finished image and separately import proposed geometry and native
lighting through optional review steps. Scene Architect itself does not run an
image detector. Review both results and make any remaining corrections in Foundry.

## Current build and installation

**0.2.0-alpha.9** adds an independently reviewable finished-map lighting pass.
It registers Scene Architect-managed and protected native lights, asks ChatGPT to
fit tangible emitters to the artwork, resolves semantic effects and bounded spread
into complete Foundry settings, and replaces only managed lights. The workflow
includes correction, labelled visual and textual review, stale-context protection,
rollback, backup and restore.

The release also retains the guided correction loop for rejected final geometry
introduced in alpha.8.

### Install or update in Foundry

1. Publish or update the module from Foundry's **Add-on Modules** screen.
2. For a first installation, choose **Install Module** and paste this manifest URL:

   ```text
   https://raw.githubusercontent.com/chrisgodfrey/scene-architect/main/module.json
   ```

3. Restart Foundry if it is running, then hard-refresh the browser.
4. Open **Add-on Modules** and confirm Scene Architect reports
   **0.2.0-alpha.9**.

The [GitHub release](https://github.com/chrisgodfrey/scene-architect/releases/tag/v0.2.0-alpha.9)
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

For **Foundry's updater**, a published GitHub release tagged `v0.2.0-alpha.9` must
contain `scene-architect.zip` and `module.json`. A source push alone does not create
those assets and will cause a download “Not Found” error if the manifest points to
an unpublished release. Prepare the release assets before exposing that manifest.

## Intended flow

1. As GM, open **Scenes → Scene Architect**. Load the laboratory example, or enter
   a brief, **Copy layout request**, send it to ChatGPT and **Import / edit plan JSON**
   with the returned layout. If validation rejects the plan, use **Copy correction
   request** in the same ChatGPT conversation, then **Import corrected plan JSON**.
   Scene Architect retains the rejected JSON and exact error while the wizard stays
   open, and validates every corrected response again.
2. **Build draft scene**. This validates every wall and light first, then creates
   the scene, native walls, doors, purposeful lights and schematic reference
   background. It does not create prop Tiles.
3. **Export PNG reference** and **Copy map prompt**. Attach the PNG in ChatGPT with
   that prompt. Generate and download **one complete map image**.
4. Choose that image under **Import and align the map**, then **Preview alignment**.
   Yellow lines are current walls, blue lines are ordinary doors, and purple lines
   are secret doors. Toggle the overlay off to inspect the artwork alone.
5. If necessary, change **Scale (%)**, **Horizontal offset** or **Vertical offset**,
   then preview again. **Apply map background** saves the source and alignment and
   replaces the background. The coloured overlay is never baked into the map.
6. Optionally use **Fit geometry to the finished artwork**. Start with **Copy
   same-chat geometry prompt** if you are still in the conversation that generated
   the unchanged map. Otherwise use the fitted-image fallback described below.
   You can also go directly to **View scene** and use Foundry's wall controls.
7. Optionally use **Fit native lights to visible emitters**. Start with **Copy
   same-chat lighting prompt** when the current conversation generated the unchanged
   map, or export the fitted lighting comparison. Import and preview the complete
   proposal, then apply it only after checking centres, bright/dim radii, effects,
   removals and warnings.
8. In Foundry, set scene darkness high enough to see the lights. Check their
   positions and effects, wall occlusion, doors, movement and token vision.
9. Reopen the wizard to reuse the saved original image or import a replacement.
   Applying again preserves all current native walls, doors, lights and Tiles.

Settings and file selections save when you apply. Leaving the file input empty
reuses the saved source. The module always fits from the original image, avoiding
repeated resampling of an already fitted background.

## If ChatGPT returns an invalid plan

Scene Architect validates imported plan JSON before it creates anything. If the
plan has overlapping props, invalid room geometry, blocked openings, missing
light links or another structural problem:

1. Read the persistent **Plan not accepted** message. It contains the exact first
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
every retry. To start over instead, use **Copy fresh layout request instead**.

## Optional: analyse the finished map and import geometry

1. **Apply map background** first, including any overall scale or position changes.
2. If the unchanged downloaded image came from the current ChatGPT conversation,
   select **Copy same-chat geometry prompt** and send it in that conversation.
   Scene Architect includes a compact registered prior containing the current
   Foundry wall vectors, planned open passages, room rectangles and feature
   centres. ChatGPT can compare stable source IDs with the earlier source image
   instead of rediscovering anonymous rooms. Scene Architect then applies the
   saved scale and offsets locally. You do not attach the image again.
3. The same-chat path is a convenience, not a guaranteed OpenAI capability. Use
   the **Fallback: attach the exact fitted image** workflow when you edited the
   image, changed conversations, imported an external map, or ChatGPT cannot inspect
   its earlier output. Select **Export registered comparison image**, attach that
   exact file, then select **Copy fitted-image analysis prompt**. The export places
   thin labelled cyan wall vectors and dashed orange passage vectors over the
   unchanged fitted artwork. They are translucent priors, not evidence that a
   boundary is visible and are never applied to the scene background.
4. Ask ChatGPT to return the complete geometry JSON. Every returned segment
   identifies the source vectors it preserved, moved, changed, split or merged;
   added segments use no source ID, and removed vectors are listed explicitly.
   Scene Architect rejects unknown or conflicting source IDs. If ChatGPT omits
   source bookkeeping, Scene Architect imports the complete network with a
   mandatory review warning instead of making you regenerate it. Paste
   the result into **Geometry JSON**, or
   choose a JSON file, then **Import geometry for review**. A selected file takes
   priority over pasted text. This saves the proposal and previews it; no walls change.
5. If validation rejects the geometry, read the persistent **Geometry not accepted**
   message and select **Copy geometry correction request**. Send it in the same
   ChatGPT conversation, then paste the complete corrected response and select
   **Import corrected geometry JSON**. The request includes the original registered
   analysis contract, exact validator error and rejected response. The rejected JSON
   remains in the wizard for manual editing, and native walls stay unchanged.
6. Compare **Proposed geometry**, **Current geometry**, **Both** or **Artwork only**
   using the overlay selector and **Preview geometry**. Proposed walls are mint,
   doors pink and uncertain/plan-informed segments dashed orange. Dashed open
   passages are review guides and create no blocking walls.
7. Inspect the listed review notes and orange markers. Acknowledge review if any
   segments are flagged, then **Apply proposed geometry** and confirm replacement.
8. Test doors, movement and vision in Foundry. Adjust any remaining inaccuracies.
   **Restore previous walls** returns to the snapshot taken before the last geometry
   operation; the current walls then become the next restore snapshot.

**Apply proposed geometry replaces ALL walls and doors in the scene**, including
manual edits and walls created by other modules. This avoids leaving old geometry
blocking the proposed doorways. It preserves the background, lights, Tiles and
tokens. Imported doors start closed. Restore also replaces all current walls,
including edits made after applying. Both actions explicitly explain this before
you confirm.

The backup retains prior wall coordinates, settings, door states and custom flags.
Replacement and restoration create new document IDs, so references to specific
wall IDs in other modules may need updating. Only one restore snapshot is retained;
export the scene in Foundry if you need a longer history. A durable backup is saved
before applying. Partial failures attempt to remove staged walls and restore any
deleted originals; failed recovery leaves the snapshot available for restoration.

Analysis coordinates are normalized either to the unchanged generated source or
to the fitted fallback image. Source coordinates are transformed and clipped to
the visible scene locally. Fitted coordinates are rounded only to scene pixels,
never to grid squares. Diagonal segments are supported. The prompt includes an
image or generation identifier and dimensions which the returned JSON must preserve.
Changing the background path or scene dimensions invalidates the analysis. Unsaved
image/alignment changes must be applied first. Editing native walls after preview
requires another preview before applying. Editing native walls after copying an
analysis prompt invalidates its registered prior, so copy or export a fresh request
before importing the returned JSON. Do not modify the background file in place:
import it again so its new path invalidates old analysis.

Validation checks schema, image identity, finite in-range coordinates, unique IDs,
nonzero lengths and overlapping spans, including solid walls covering doors or
passages. Registered requests also require every current wall and planned open
passage to be represented or explicitly removed; omissions are treated as proposed
removals and require explicit review. Unknown document fields are discarded.
Limits: 1 MB of JSON and 2000 segments. These checks do not prove visual
accuracy, connected rooms or leak-free vision. Secret doors and plan-informed
geometry are always marked for review.

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
supported. An unavailable requested effect stops draft creation before Scene,
Wall or AmbientLight documents are written instead of creating an inert light.

These lights are starting points, not visual acceptance. Map generation can move
the painted source, add visible lamps, or omit an intended source, and every
Foundry theme or world may display an effect differently. Applying analysed
geometry never replaces or moves light documents. Use the independent finished-map
lighting workflow when the artwork and native lights differ.

## Optional: fit native lights to the finished map

1. Apply the final map background and any scale or offset changes first.
2. In the original image-generation conversation, choose **Copy same-chat lighting
   prompt**. It sends registered managed-light and protected-light context while
   asking ChatGPT to inspect the image already in that conversation; do not attach
   the image again.
3. If the image was edited, imported externally, generated in another conversation,
   or unavailable to ChatGPT, choose **Export light comparison image**. Attach that
   exact file, then choose **Copy fitted-image lighting prompt**. Labels beginning
   `M` identify Scene Architect-managed lights; labels beginning `P` identify
   protected lights.
4. Import the complete returned lighting JSON. Scene Architect validates the
   request/image identity, coordinates, semantic preset, `small`/`medium`/`large`
   spread, optional colour, evidence, source correspondence, removals, runtime
   animation availability, and all managed source IDs. Limits are 1 MB and 100
   proposed lights.
5. If validation fails, choose **Copy lighting correction request**. The request
   includes the exact validator error, rejected response, original registered
   contract and untrusted-data boundary. Import the complete corrected object; a
   patch or partial fragment is not accepted.
6. Compare **Current**, **Proposed**, **Both**, or **Artwork only**. Solid inner
   circles are bright radii and patterned outer circles are dim radii. Labels and
   the text list provide the same information without relying on colour alone.
7. Review every centre, preset, spread, resolved bright/dim radius, colour,
   animation, evidence, source change and warning. A model can mistake reflections
   or baked illumination for emitters; only tangible lamps, flames, portals and
   similar sources should become native lights.
8. Choose **Apply managed lights**. Scene Architect replaces only lights carrying
   its generated ownership flag. Manual and other-module lights are protected and
   remain unchanged. Walls, the background, Tiles and tokens also remain unchanged.
9. Use **Restore previous managed lights** for one-level undo. Lighting backup and
   restoration are separate from wall backup and restoration.

Every request signs the current background, alignment, managed lights and protected
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
   Try a small image offset, preview and reapply; native geometry must stay fixed.
6. Export the analysis image, request geometry, import it and compare the overlays.
   Confirm that import alone changes no walls. Review the markers and apply.
7. Request finished-map lighting, import it, and compare current and proposed
   centres plus radii. Confirm that import alone changes no native lights. Apply,
   verify the protected GM light remains unchanged, then **Restore previous managed
   lights**.
8. Test doors and token vision, then **Restore previous walls**. Check the prior
   geometry and door states return while artwork, lights and Tiles stay unchanged.

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

Analysis state uses `flags.scene-architect.geometryRequest`, `geometryProposal`
and `geometryBackup`. Proposals and backups survive closing/reopening the wizard.
Do not run simultaneous geometry operations from different GM clients; scene checks
and the local operation guard are best effort, not a server-side transaction.

Lighting analysis uses separate `lightingRequest`, `lightingProposal` and
`lightingBackup` flags. A valid proposal survives reopening until its background,
alignment, managed lights or protected context changes. Applying or restoring
lights clears the consumed request/proposal and retains a one-level managed-light
backup. Lighting operations have their own local guard and never call the wall
transaction.

If an upload fails, the current background stays in place. A background-update
failure attempts to restore it; the uploaded source/settings may already be saved
so you can retry. Server-side partial failures can require manual recovery.

## Limits

- Initial plans use rectangular rooms and orthogonal walls. You can edit native
  walls freely afterward; the module does not rebuild them on image import.
- No built-in automatic tracing, image segmentation, per-asset imports or API generation.
  Geometry analysis is a manual exchange followed by a reviewed JSON import.
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

Local verification for the current source: **59 unit tests and 93 browser assertions**
passed. Coverage includes plan-validation correction and retry, full-map import,
exact output dimensions, live edited
wall overlays, omission of overlays from the uploaded background, offsets,
saved-source reuse, preservation of native edits and Tiles, cancelled application,
upload failure and background rollback. Retained legacy renderer checks also run.
Additional coverage includes analysis-image export, image identity, invalid/overlapping
geometry, final-geometry correction and retry, review acknowledgement, cancelled
replacement, stale previews, preservation of other scene documents, saved proposals,
restoration and partial write recovery.
Finished-map lighting coverage includes managed/protected registration, same-chat
source transforms, semantic spread resolution, correction and retry, labelled
visual and textual review, stale protected-context rejection, managed-only
replacement, rollback and one-level restoration.
The reference and wizard screenshot were visually inspected.

Canvas rendering and PNG encoding/decoding run in a real browser. **Foundry host,
document and upload APIs are mocked.** Verification on the user's Foundry server
remains necessary.

Code: `scene-architect.js` owns the wizard; `image-geometry.js` handles wall
analysis prompts, validation, overlays, replacement and recovery;
`image-lighting.js` independently handles managed/protected light registration,
validation, comparison, correction, replacement and restoration; `whole-map.js`
handles references, prompts and full-map rendering; `plan.js`, `geometry.js` and
`foundry-data.js` provide initial geometry and deterministic light configuration;
`project.js` saves project state. Legacy art modules are retained for compatibility.
The abandoned atlas experiment is outside the runtime package and is not part of
this workflow.
