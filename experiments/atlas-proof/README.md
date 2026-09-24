# Fixed-atlas feasibility experiment

Stopped at the user's request on 2026-09-24. The experiment was incomplete;
no feasibility or reliability conclusion was established. The module now uses
one complete map with editable Foundry geometry. These prompts are historical
experiment notes and are not shipped or used by the module.

This experiment is isolated from the module UI and published release.

Protocol fixed before generation:

- Three independent laboratory packs; two built-in image-generation calls per pack.
- Identical prompts across trials; no references to earlier generated packs.
- Materials: square atlas, 2×2 equal cells in order surround-rock, wall-stone,
  floor-1-stone, floor-2-metal. Crop at the midlines, without manual correction.
- Props: square atlas, 3×3 equal cells in order restraint-bed, instantiator,
  steam-engine, medical-bed, broken-construct, well-stairs, vapour, empty, empty.
- Props request real alpha and 12% clear padding within each cell.
- Importer may automatically trim transparent margins within each fixed prop cell.
  It may not move a cell boundary, reassign a slot, erase pixels, remove opaque
  backgrounds, or repair a generation. No retakes for the primary test.
- Render the existing laboratory plan: exactly three restraint beds, two medical
  beds, two constructs and four other feature instances, with original geometry.
- Inspect slot identities, cropping, alpha, stray content, material repeats and
  assembled scenes. Pixel checks establish technical properties, not semantic identity.
- Success means all required assets import and look usable without user repair.
  Three samples provide preliminary feasibility evidence, not a measured production
  reliability estimate. Built-in imagegen results do not establish identical behavior
  in the user's ChatGPT interface.

Generated images and derived inspection outputs live under the ignored
`test-output/atlas-proof/` directory. Prompts are stored alongside this protocol.
