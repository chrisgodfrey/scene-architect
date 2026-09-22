---
title: Scene Architect v0.1 alpha
description: Foundry VTT v14 module for generating grid-exact scenes from structured layouts
---

A Foundry VTT v14 module prototype for the workflow:

**human brief → frontier web model → grid-exact JSON → deterministic Foundry
Scene → edit native walls → download PNG guide → frontier image model →
import artwork without moving geometry**

## What this alpha does

* Adds **Scene Architect** to the Scenes directory for GMs
* Builds a layout request you can paste into ChatGPT or another frontier web
  model
* Validates returned JSON against grid-exact rules
* Deterministically compiles rectangular spaces into perimeter walls
* Supports open passages, normal doors, secret doors, and Foundry
  proximity/window walls
* Supports extra wall, terrain, invisible, and ethereal barriers
* Creates a real Foundry v14 Scene with an exact pixel/grid canvas
* Creates real native Foundry Walls and Ambient Lights
* Uploads an exact SVG wireframe as the temporary scene background
* Lets you edit those walls with normal Foundry tools
* Exports an SVG art guide from the **live Foundry wall geometry**, so manual
  corrections are preserved
* Converts the live SVG geometry into a PNG guide that image models can inspect
  directly
* Copies an image-generation prompt that explicitly forbids scripts and
  programmatic drawing
* Imports the finished PNG, JPEG, or WebP as the scene's visual skin without
  moving walls or lights

## Art-generation workflow

After selecting **Build draft scene**:

1. Review the generated scene and adjust its native walls or doors if needed.
2. Select **Download PNG guide + copy image prompt** and save the PNG when
   prompted.
3. Upload the downloaded PNG directly to ChatGPT or another image model.
4. Paste the prompt that Scene Architect copied to your clipboard.
5. Generate and download the finished battlemap.
6. Return to Scene Architect and select **Import finished artwork**.

The PNG is generated from the scene's live Foundry wall geometry. Unlike an
archive containing SVG and JSON documents, it is presented directly to the
model as an image-generation reference. The copied prompt contains the room and
feature descriptions and explicitly instructs the model to generate raster
artwork rather than write code or redraw the map with vector primitives.

On browsers that support the File System Access API, Scene Architect opens a
native **Save As** picker. On other browsers, it stores the PNG in the Foundry
world data and displays a permanent download link.

The individual SVG, prompt, and JSON exports remain available under the
advanced section.

## Installation

### Install from the manifest

1. Open Foundry VTT's **Add-on Modules** tab.
2. Select **Install Module**.
3. Paste the following URL into **Manifest URL**:

   ```text
   https://raw.githubusercontent.com/chrisgodfrey/scene-architect/main/module.json
   ```

4. Select **Install**.
5. Enable **Scene Architect** in your world.
6. Open the Scenes sidebar and select **Scene Architect**.

### Install a release manually

1. Download `scene-architect.zip` from the
   [GitHub releases page](https://github.com/chrisgodfrey/scene-architect/releases).
2. Extract the archive into your Foundry user data folder so the manifest is
   located at `Data/modules/scene-architect/module.json`.
3. Restart Foundry.
4. Enable **Scene Architect** in your world.

Do not download GitHub's automatically generated source archives. The
`scene-architect.zip` release asset is packaged for Foundry.

## Updating

Modules installed from the manifest can be updated from Foundry's **Add-on
Modules** tab. Select **Check for Update** for Scene Architect after a new
release is published.

For a manual installation, download the new `scene-architect.zip` release asset
and replace the existing `Data/modules/scene-architect/` directory while
Foundry is stopped.

## Important

This is an **alpha built against the documented Foundry v14.365 public API**, but it has not been runtime-tested inside your specific Foundry installation yet. Make a world backup before using it in your main campaign world.

The deliberately important architectural rule is: **the artwork is not the source of truth. Foundry geometry is.**

## Current limitations

- Rectilinear room model only. Spaces are axis-aligned rectangles.
- The external web model proposes the structured layout; the module validates and compiles it.
- Features are guide annotations, not Foundry Tiles yet.
- Final AI artwork can still locally distort geometry. The Foundry walls remain correct; inspect imported artwork before play.
- No automatic round-trip from manually moved walls back into room rectangle definitions. The exported SVG *does* use live wall coordinates.
- No native AI/API integration by design.

## Likely v0.2 work

- Open an existing Scene Architect scene after closing the wizard.
- Alignment-check overlay after art import.
- Native room/feature editing palette.
- Export semantic masks (floor/wall/door/window/features) separately.
- Better light defaults and light preview.
- Feature → Tile placeholders.
- Support polygons/diagonal walls while retaining exact grid-edge constraints.
