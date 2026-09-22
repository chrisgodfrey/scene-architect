---
title: Scene Architect v0.1 alpha
description: Foundry VTT v14 module for generating grid-exact scenes from structured layouts
---

A Foundry VTT v14 module prototype for deterministic scene geometry:

**human brief → frontier web model → grid-exact JSON → deterministic Foundry
Scene → edit native walls, doors, windows and lights**

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
* Exports the plan JSON and live SVG geometry for use in other tools
* Provides an explicitly experimental PNG handoff for external image generators
* Optionally imports external artwork as an unmanaged background

## Deterministic workflow

After selecting **Build draft scene**:

1. Review the generated scene and adjust its native walls or doors if needed.
2. Edit walls, doors, windows and lights using Foundry's native tools.
3. Use the generated wireframe as a planning background or export the live SVG
   and plan JSON for another mapmaking workflow.

## Experimental artwork handoff

General-purpose image generators do not reliably preserve exact externally
supplied geometry. They may move walls and doors, alter room dimensions, invent
or remove passages, introduce perspective, or bake a conflicting grid into the
image. Scene Architect does not claim to correct those failures.

The optional **Experimental artwork handoff** can export a PNG guide and prompt,
then import a returned image as an unmanaged background. Use it only when you
accept that the result may not align with Foundry's geometry. Always inspect the
background against the movement grid and native walls before play.

On browsers that support the File System Access API, the PNG export opens a
native **Save As** picker. On other browsers, Scene Architect stores the PNG in
the Foundry world data and displays a permanent download link.

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

Scene Architect guarantees only the deterministic Foundry documents it creates.
External image-generation behavior is outside that guarantee.

## Current limitations

* Rectilinear room model only. Spaces are axis-aligned rectangles
* The external web model proposes the structured layout; the module validates
  and compiles it
* Features are guide annotations, not Foundry Tiles yet
* External artwork is unmanaged and may not match the scene geometry
* No automatic round trip from manually moved walls back into room rectangle
  definitions. The exported SVG uses live wall coordinates
* No native AI or image-generation API integration by design

## Likely v0.2 work

* Open an existing Scene Architect scene after closing the wizard
* Native room and feature editing palette
* Export semantic masks for floors, walls, doors, windows and features
* Better light defaults and light preview
* Feature-to-Tile placeholders
* Support polygons and diagonal walls while retaining exact grid-edge
  constraints
