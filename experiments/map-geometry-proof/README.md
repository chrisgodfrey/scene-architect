# Finished-image geometry proof

One sample, analysed on 2026-09-24 using the user's downloaded laboratory image
(`ChatGPT Image Sep 24, 2026, 09_50_34 AM.png`, 1355 × 1161 pixels).

The model visually estimated wall-centre and doorway positions from the original
PNG, with one close-up of the lower-left passage. `generate.mjs` records those
estimates and converts them to normalized coordinates. It does **not** implement
a general image detector or call a model/API. The original plan supplied room and
door semantics, and serves as the comparison baseline; its coordinates were not
used as the proposed coordinates.

Run `node experiments/map-geometry-proof/generate.mjs` after copying the source to
`test-output/geometry-proof/source.png`, then run `render.ps1` for static overlays.
The HTML viewer contains the source image and toggles original/proposed overlays.
All image outputs and experimental JSON are in ignored `test-output/geometry-proof/`.

The main boundaries visibly follow the artwork more closely than the original
plan. This is a qualitative assessment on one known, mostly rectangular map.
It is not an independent accuracy measurement or evidence of repeatable quality
across other maps or ChatGPT sessions.

Two items remain explicitly marked for review:

- The lower-left passage has jamb-like features but is obscured by dark stone,
  machinery and pipes. Its classification as open uses original intent.
- The northern threshold is visible, but its classification as secret is inherited
  from the original plan and cannot be recovered from appearance alone.

The JSON stores arbitrary normalized segment endpoints; it is not constrained to
integer grid coordinates. There are 22 blocking segments, including two ordinary
doors and one secret door, plus one candidate open passage. Local validation checks
finite in-range coordinates, nonzero segments, unique IDs and expected door counts.
These checks do not establish visual accuracy, playability or leak-free vision.

No module code, world data, walls or release were changed. Alpha.3 does not import
this experimental schema. An eventual importer would need optional preview,
explicit application, preservation/restoration of existing geometry, and a clear
review path for uncertain openings.
