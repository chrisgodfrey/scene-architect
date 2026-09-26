---
title: Scene Architect
description: Build Foundry VTT scenes deterministically from server assets or compose generated artwork around authoritative geometry
---

Scene Architect for **Foundry VTT v14** owns the map's geometry. The
server-asset workflow automatically prepares a palette for a text-model design to build
the background, native walls, doors and lights deterministically. It needs no
image generation, model API key, asset-provider module or subscription.

**Describe → Design → Preview & create**

The existing generated-artwork workflow remains available. It treats a returned
image as an appearance layer and replaces protected architectural pixels before
creating the background and native documents.

## Development status

**0.3.0-alpha.4** is an experimental prerelease for Foundry testing. It adds
automatic asset selection and a brief-first interface to the deterministic
server-asset workflow introduced in alpha.3. New projects default to server assets;
existing artwork projects retain their original workflow.
Live alpha.2 creation, reopening, artwork updates, native doors and token vision
were verified in Foundry 14.368. Finished-map visual quality remains a separate gate.
The asset workflow also passed isolated live indexing, import, rendering,
creation, reopening and background-update checks. Saved and repeated PNGs matched
byte-for-byte; native documents and existing campaign scenes were preserved.
The module does not contact a model, install local inference software or upload
anything to an AI provider.

Structural correctness and visual quality are separate gates. Automated canvas
and geometry checks do not establish that a generated map looks convincing.
Live full-library loading and automatic preparation are verified, but they do not
establish automatic aesthetic quality or performance for every asset collection.

Alpha.2 fixes alpha.1 rejecting newly created scenes with fractional-pixel light
positions. Creation and comparison now use the installed Foundry coordinate-field
cleaners. Existing plans and artwork remain usable; no image regeneration is needed.

Alpha.3 also accepts near-matching artwork aspect ratios within 0.2%
without the earlier one-source-pixel limit. The preview discloses the small
proportional correction. This does not repair displaced painted doorways, vertical
wall faces or other artwork that disagrees with the reference.

## Using the brief-first workflow

Alpha.4 uses **Describe → Design → Preview & create**.
Connect your own licensed library once; purchased assets are not bundled.

1. Enter a scene name and description. Map dimensions are optional controls.
2. Connect your server asset folder once with **Browse folders** and **Connect
   library**. Later projects load that shared catalogue automatically.
3. Choose **Get AI design request**. Deterministic filename/path matching selects
   a bounded, varied shortlist for your brief, including materials and wall strips.
   Give the copied request to your preferred text AI.
4. Paste the complete response into **AI response JSON** and choose **Validate &
   preview**. Validation, local construction and asset rendering are one action.
   Invalid or stale responses remain editable; a correction request is provided.
5. Inspect the preview, confirm it, and choose **Create Scene**. No scene or
   rendered-image upload is made before this explicit step.

There is no mandatory per-image selection or calibration. The model chooses final
materials and furnishings from the shortlist. No additional inference call,
embedding service or provider-specific integration is introduced. Clipboard denial
leaves the request visible for manual copying instead of opening another dialog.

Automatic metadata records its origin honestly: filename footprints and estimated
library pixel density are not human-confirmed calibration. Full-frame proportions
and transparent padding are retained. Selection returns at most 36 candidates by
default and decodes no more than 64 candidates. Missing images, unsupported
dimensions, decode budgets and unavailable architectural roles produce explicit
recovery messages, not placeholder success. Sparse or opaque filenames limit
retrieval quality; inspect the result rather than assuming physical scale is exact.
Large-library preparation uses cooperative browser scheduling where available,
avoiding chained-timer delays in background tabs while retaining cancellation.

**Projects & advanced tools** contains library refresh, manual overrides, saved
projects, diagnostics and the generated-artwork workflow. Editing an automatic
entry removes automatic readiness until that override is reviewed. Older confirmed
palettes remain supported. Saved asset scenes retain their own palette and can be
rendered without loading the catalogue.

This changes the workflow, not the geometry engine: rooms are still connected,
non-overlapping rectangles. Circular lighthouses and curved architecture are not
implemented. Live checks cover the new folder picker and automatic request
preparation; full scene lifecycle checks for the engine are retained from alpha.3.

## Earlier alpha.3 manual workflow

These steps describe the previous release. After updating to alpha.4, use the
brief-first workflow above; per-image selection is optional under advanced tools.

1. Put licensed PNG, JPEG or WebP assets anywhere under Foundry's Data directory.
   A folder such as `assets/map-library` is convenient, not mandatory. The module
   uses Foundry's data file browser; it cannot browse a path on the client computer.
2. Open **Scenes → Scene Architect** as GM. New projects default to **Server assets**.
   Enter a Data-relative asset root and choose **Index folder and save shared catalogue**.
   Subfolders are traversed without assuming a provider-specific layout. Indexing
   reads names, not image pixels. Progress and cancellation are available.
3. Load the shared catalogue on another client with **Load shared catalogue**.
   Search by filename/folder words and add up to 64 assets to a palette. Select at
   least one repeating material and one horizontal wall strip, plus optional props.
4. Review each asset's role and full-image width in grid cells. Height remains
   proportional; transparent padding is retained. Filename dimensions are only
   hints. Set a wall strip's vertical center from 0 to 1, usually 0.5, and confirm
   each entry. Use smaller source images if the used palette exceeds 64 megapixels.
5. Enter the brief and scene dimensions, then **Copy scene design request**. Send
   the text to your preferred LLM and paste its complete JSON with **Import scene
   design**. The request includes asset IDs and calibrated footprints, not image
   files or their server paths. One round trip is the normal path, not a guarantee.
6. Invalid JSON or geometry leaves the current plan unchanged. Use **Copy asset
   design correction request** to repair the response. If you change the brief,
   dimensions or palette after copying, copy a fresh request first.
7. Build the local geometry, then **Render server assets**. Inspect material scale,
   joins, furniture and circulation. Confirm inspection before creating a scene.
   Only the exact inspected background PNG is uploaded; originals are not modified.
8. Reopen a saved project to render its saved palette snapshot without loading the
   catalogue. Background updates preserve native documents and door states. New
   layouts create new scenes rather than silently replacing existing geometry.

Catalogue JSON is sharded into bounded files in the world's `scene-architect`
folder. A world setting points to the completed manifest. Failed or cancelled
operations do not publish a partial index, although unreferenced shard files can
remain; the module never deletes arbitrary server files. Re-index after adding or
renaming assets. Search uses deterministic filename/path ranking, not embeddings.
The loaded catalogue resides in browser memory, so large libraries still have a
memory and network cost. Index resource limits fail explicitly rather than
silently truncating the library.

Asset plans use connected, non-overlapping rectangular rooms and calibrated props.
The module checks overlapping props and doorway clearance; it does not certify
every possible token route or artistic composition. Door thresholds are static
artwork; native doors control movement, vision and light. Advanced joins, outdoor
dressing and animated door leaves are future work. Replacing a source image at the
same path can change later renders; preserve source files for repeatability.

## Using generated artwork

1. Open **Scenes → Scene Architect** as GM. Select **Generated artwork** and
   **Start selected workflow**, then enter the scene brief and canvas size.
   Copy the scene-design request to a model and import its coordinate-free JSON.
   Alternatively load a representative example.
2. Build the architectural preview. Scene Architect validates and places rooms,
   openings, major anchors and lights locally. This does not create a Foundry
   scene yet. Inspect the plan before requesting artwork.
3. Export the render handoff. Attach the reference PNG and send the accompanying
   prompt to a frontier multimodal image model. The handoff contains the complete
   scene, room purposes, visual direction, dressing and important relationships.
   Request one full-frame artwork image, not a set of individual prop assets.
4. Select the returned PNG, JPEG or WebP and preview the **final composite**.
   Scene Architect restores the protected architecture. Reject incorrect framing,
   invented walls inside rooms, misplaced important features or unsuitable art.
   No image-to-wall fitting or geometry response is needed.
5. Create the scene after inspecting the composite. The background uses the
   composite; native walls, doors and lights use the original deterministic plan.
   Reopening a compatible saved scene can update its background without replacing
   native documents.
6. Test doors, movement, wall occlusion, darkness, light effects and token vision
   in Foundry. A browser mock does not prove live Foundry behavior.

The model is replaceable. There is no API key, provider SDK, local GPU, Python
image-generation service, ComfyUI, ControlNet, asset library or second mapmaking
application in this optional path.

## Structural authority

[The geometry compiler](scripts/geometry.js) remains the single wall-segment
authority. The same segments drive native Foundry documents, structural masks and
the final raster. Room perimeters and explicit barriers remain grid-aligned;
openings come from the plan, never from image pixels.

[Architectural regions](scripts/architecture.js) describe binary protected bands
around those segments and all openings. The band depth is half the visual wall
width plus configurable padding, in grid cells. At output resolution the mask is
rounded outwards to whole pixels. Every pixel inside the protected core is
replaced completely; source-image drift cannot contribute there.

[The compositor](scripts/artwork-compositor.js) restores narrow floor margins,
wall surfaces, corners, controlled structural shadows, thresholds and jambs.
Stone, wood and metal wall treatments are available. It does not assemble
furniture or tile every room with deterministic floor textures. Unprotected
room interiors retain the imported appearance.

There is deliberately no pixel-to-geometry transformation. If a model paints a
wall deep inside an unprotected room, the compositor cannot recognize or remove
it. Reject that artwork. Increasing the protected padding can absorb nearby drift
but may erase more dressing and expose wider deterministic floor bands.

### Coordinate spaces and image size

- Plans use grid cells. Rooms and architectural boundaries use integer cell
  coordinates; anchor footprints and native light centres may be fractional.
- Native documents and architectural raster descriptors use scene pixels:
  `pixel = cell * gridSize`, with origin at the canvas's top-left.
- Imported-image coordinates map once to the entire scene canvas. There is no
  crop, offset, inferred alignment or geometry adjustment.
- Matching-aspect images at other resolutions are deterministically scaled to the
  requested output. The correction permits at most 0.2% relative aspect
  error, with a visible preview notice for the small horizontal/vertical scale
  difference. For example, 1403 x 1121 fits a 2800 x 2240 canvas with about 0.125%
  aspect correction. Nothing is cropped; larger differences still fail.
- Original sources are retained separately from composites. Reapplying uses the
  original source, not an already composited background.

Structural settings live in `plan.rendering`, independently of legacy art
manifest settings:

```json
{
  "version": 1,
  "wallWidth": 0.18,
  "bandPadding": 0.3,
  "material": "stone"
}
```

Wall width accepts 0.08–0.35 cells; padding accepts 0.1–0.65 cells. Settings are
validated before rendering. A settings change requires a new preview.

### Doors, secret doors and lights

Ordinary doors use clear structural apertures, thresholds and jambs, without a
permanently painted door leaf. Native Foundry door state controls movement and
vision independently. Open passages remain clear. Windows receive a sill.

Secret doors render as continuous ordinary wall, without debug marks. Their
GM-visible native door provides interaction. Opening a secret door does not
animate a hole in the static background; check this trade-off in play.

Native lighting comes from semantic presets and deterministic positions. Baked
lighting is stylistic and never relocates a native light. Presets are
`steady-lamp`, `flickering-lamp`, `flame`, `magic-portal`, `pulsing-magic` and
`ambient-fill`. `flickering-lamp` uses Foundry's `torch` animation. Existing
coordinate-based lights and bounded overrides remain supported.

Plan light centres may fall between pixels. Native creation and later position
checks use the same Foundry `AmbientLight` field cleaners, preserving its coordinate
precision without changing the plan. Actual document positions are compared exactly;
this is not a tolerance that permits moved lights.

An unavailable preset animation retains the existing steady-light fallback;
an unavailable explicit animation override fails before creating documents.
Inspect effects in the installed Foundry runtime.

## Major anchors and soft dressing

Generated-artwork requests use `scene-intent` version 2. Version 1 intents and existing
low-level plans remain supported. The model supplies meanings and relationships,
not footprints:

```json
{
  "id": "restraint-bed",
  "role": "major-anchor",
  "type": "bed",
  "description": "Iron restraint bed; head/front faces the machine",
  "size": "medium",
  "count": 3,
  "facing": "instantiator"
}
```

A target such as `instantiator` must be a singleton major anchor in the same room.
Optional `placement: "centered"` puts a singleton at its room centre. Facing is
interpreted geometrically: north is 0 degrees, clockwise about the footprint
centre. Missing or ambiguous targets, cycles, unsupported relations, overlaps,
blocked doorways and unsatisfiable placement fail explicitly.

This is a small relation set, not a general spatial language. Layout generation
still uses bounded linear or central-corridor layouts. It is deterministic, not
an optimal packing or architectural composition solver.

`soft-dressing` instead preserves type, description and count in the room's
`dressing` list without coordinates or asset assignments. A dressing group may
contain up to 200 items. Use major anchors for gameplay-critical objects and
visible sources that need native lights, not every chair, bottle or paper.
Version 2 allows at most 20 requested rooms, 64 feature groups per room and
16 major-anchor instances per room.

The reference labels rooms `R#` and anchors `A#`, with front arrows. The prompt
explains amber protected bands, cyan openings and blue anchor regions. Labels,
colours and masks belong only to the handoff/debug views, never to final
architectural rendering. Artwork which reproduces annotations in unprotected
regions still needs rejection.

## Saved scenes and compatibility

Opening an old scene does not modify it. Its original plan, art assignments and
legacy fitting backups remain available. The primary workflow no longer consumes
geometry/light proposals or requires a fitting approval.

An update is allowed only when native walls, dimensions, grid and managed light
positions match the deterministic plan. Door open/locked state may change.
Independent GM lights and unrelated Tiles are not rewritten. If the scene was
fitted or edited, create a **new scene from the original plan** instead; the old
scene stays intact. This is an intentional change from alpha.15's free-fit path.
Older generated prop Tiles should also be kept in the old scene rather than
silently removed.

Scene flags retain the plan, original source, composite metadata and a revision
marker. Sources and composites are uploaded to
`worlds/<world-id>/scene-architect/`. Previous uploads are not automatically deleted.
Pre-scene draft data contains the model, not image bytes; a local file may need
reselection after closing or refreshing.

Failed uploads must not replace the current background. Background/save failures
attempt guarded restoration and report recovery errors. Revision checks are
best-effort stale-write protection, not a server-side distributed transaction.
Avoid simultaneous updates from multiple GM clients.

### Retained legacy components

- [Plan validation](scripts/plan.js), [room generation](scripts/plan-generator.js),
  [native adapters](scripts/foundry-data.js) and
  [project persistence](scripts/project.js) remain reusable authorities.
- [Image geometry](scripts/image-geometry.js),
  [image lighting](scripts/image-lighting.js) and
  [combined scene fitting](scripts/scene-fit.js) remain deprecated compatibility
  libraries with tests, not normal scene-creation stages.
- [Whole-map fitting](scripts/whole-map.js) and the
  [old asset renderer](scripts/renderer.js) retain compatibility helpers.
  The new [render handoff](scripts/render-handoff.js) and compositor replace
  their primary-workflow roles.

## Installation and local packaging

Back up your world and test this prerelease in a separate world first.
In Foundry's **Add-on Modules**, update Scene Architect, or install it using this
version-specific manifest:

```text
https://github.com/chrisgodfrey/scene-architect/releases/download/v0.3.0-alpha.4/module.json
```

Restart Foundry, hard-refresh the browser and confirm **0.3.0-alpha.4**.
The [prerelease](https://github.com/chrisgodfrey/scene-architect/releases/tag/v0.3.0-alpha.4)
also provides the module ZIP for manual installation.
There is no runtime build step. To package a local checkout:

```powershell
powershell -NoProfile -File tools\package-module.ps1
```

The local packager verifies the runtime files and writes
`dist/scene-architect.zip` with the manifest at its root. It excludes experiments,
tests and dependencies. Extract into `Data/modules/scene-architect/`, restart
Foundry and hard-refresh the browser. Confirm version **0.3.0-alpha.4**.

Existing library settings, saved projects and palette snapshots are retained.
Prepare a fresh AI design request to use an expanded library; an existing request
continues to reference its original palette.

If alpha.1 failed with "Managed light positions differ", reopen the local draft,
reselect the original artwork, preview it again and retry **Create Scene**.
Do not move or delete native lights to bypass the check.

The packaging command does not publish a release. Release maintainers must upload
and publish the matching assets before updating the public main-branch manifest.
The earlier alpha.15 is a different workflow and should not be used to assess
these source changes.

## Verification and visual acceptance

With Node 22+ and the repository's development dependencies:

```powershell
npm ci
npm test
npm run test:browser
```

The browser harness uses an isolated headless Chromium/Edge profile. Set
`SCENE_ARCHITECT_BROWSER` if needed. Outputs go to ignored `test-output/`.
Tests exercise real canvas rasterization and PNG encoding/decoding, but Foundry
host, document and upload APIs are mocked.
The browser mock applies coordinate-field cleaning during light creation and tests
creation, reopening and artwork updates with fractional-pixel plan lights.
Near-matching artwork tests cover the reported 1403 x 1121 dimensions, the exact
0.2% acceptance boundary, full-frame corner preservation, preview disclosure and
reapplication without native-document changes.

Alpha.4 passed 169 Node tests and 267 browser checks. The asset checks cover
catalogue shards, calibrated metadata, stale requests, explicit failure paths,
deterministic rendering and project persistence. A separate live Foundry 14.368
pass verified native creation and updates, door collisions and client reload
without changing existing scenes. Alpha.4 adds real-template guided-flow,
automatic selection, inferred calibration, cancellation and background-scheduler
regressions. Live Foundry tests verified folder selection and request preparation.
A 315,374-image catalogue loaded in 8.3 seconds, followed by a 36-image cold
preparation in 4.7 seconds in the tested browser. This is one measured environment,
not a latency guarantee. Automatic preparation and the library switch preserved
the current draft and existing scenes.

Structural checks cover exact native/raster coordinates, full protected-band
source exclusion, opening clearance, secret concealment, dimensions, repeatable
pixels, immutable inputs, anchor relationships, source reuse and failure paths.
Synthetic sources are test data, not frontier-model visual proof.

Before calling this architecture successful, generate and inspect these three
representative scenes using their supplied semantic fixtures:

| Scene | Visual acceptance checks |
|-------|--------------------------|
| [Instantiator laboratory](fixtures/intents/laboratory.json) | Six rooms plus circulation; dark stone/steampunk tone; one major machine; three restraint beds actually face it; side machinery, medical beds and access chamber remain distinct. |
| [Civic interior](fixtures/intents/civic.json) | Furniture density, repeated rooms, corridors, readable exact doorways and coherent architectural surfaces. |
| [Bathhouse](fixtures/intents/bathhouse.json) | Rich materials and atmosphere survive composition; unusual furnishing and bath regions remain readable without perspective or new barriers. |

For every scene, inspect clean source and composite side by side at play scale.
Check seams, erased furniture, floor-band colour mismatch, extra walls outside
protected bands, missing/shifted anchors, annotation leakage and secret-door
concealment. Then verify native alignment, door interaction, movement, lighting
and token vision in Foundry v14. Human aesthetic approval is still required.

Input limits are 30 MB and 40 megapixels; output/reference limits are 8192 pixels
per side and 24 megapixels. One level, zero padding/grid shift and untransformed
backgrounds are supported. Polygonal rooms, automatic art rejection, animated
door art and provider API automation are outside this development scope.
