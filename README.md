---
title: Scene Architect
description: Compose frontier-model artwork around authoritative Foundry VTT architecture
---

Scene Architect for **Foundry VTT v14** owns the map's geometry. An external
multimodal image model supplies appearance, not coordinates. The returned image
is an intermediate layer: Scene Architect replaces protected architectural pixels
before creating the background and native walls, doors and lights.

**Describe → Build → Generate Artwork → Import Artwork → Create Scene → Play**

## Development status

**0.3.0-alpha.1** is an experimental prerelease for Foundry testing. It starts a
new development line after **0.2.0-alpha.15**. Live Foundry integration and
finished-map visual quality still require acceptance testing.
The module does not contact a model, install local inference software or upload
anything to an AI provider.

Structural correctness and visual quality are separate gates. Automated canvas
and geometry checks do not establish that a generated map looks convincing.
The earlier individually assembled asset-pack experiment is not this architecture
and is not evidence of visual success.

## Using the workflow

1. Open **Scenes → Scene Architect** as GM. Enter the scene brief and canvas size.
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
application in this path.

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
- Matching-aspect images are deterministically scaled to the requested output.
  Rounding tolerance is at most one source pixel and 0.2% relative aspect error;
  materially incompatible dimensions fail instead of being stretched.
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

An unavailable preset animation retains the existing steady-light fallback;
an unavailable explicit animation override fails before creating documents.
Inspect effects in the installed Foundry runtime.

## Major anchors and soft dressing

New requests use `scene-intent` version 2. Version 1 intents and existing
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
https://github.com/chrisgodfrey/scene-architect/releases/download/v0.3.0-alpha.1/module.json
```

Restart Foundry, hard-refresh the browser and confirm **0.3.0-alpha.1**.
The [prerelease](https://github.com/chrisgodfrey/scene-architect/releases/tag/v0.3.0-alpha.1)
also provides the module ZIP for manual installation.
There is no runtime build step. To package a local checkout:

```powershell
powershell -NoProfile -File tools\package-module.ps1
```

The local packager verifies the runtime files and writes
`dist/scene-architect.zip` with the manifest at its root. It excludes experiments,
tests and dependencies. Extract into `Data/modules/scene-architect/`, restart
Foundry and hard-refresh the browser. Confirm version **0.3.0-alpha.1**.

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
