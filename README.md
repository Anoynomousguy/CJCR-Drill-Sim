# CJCR Drill Sim

A desktop parade-drill planner for Canadian cadets. Lay out a parade square, set a platoon
strength, drag drill movements into a programme, and play the whole parade in 3D and 2D.

Set strength and the platoon dresses itself: sizing, files, ranks, squad intervals, the
platoon commander, the supernumerary WO rank, and the colour party are built from the
CJCR/CAF drill manual rules (Ch 2 sizing and ordering, Ch 7 platoon layout, Ch 8 colour
party). Heights are seeded and editable, so the same plan always forms up the same way.

## Features

- **69 movements** across foot drill, rifle drill (Lee-Enfield) and colour drill, each with
  the manual's command, count-by-count breakdown and reference. Commands are snapped to the
  correct foot and the standard pause is applied.
- **Per-person drill state**: posture, weapon state (order, slope, present, port, trail,
  grounded, reversed) and colour state (order, carry, slope, dip, let fly). Illegal
  transitions are flagged, along with marching off the square, colliding ranks and no room
  to wheel.
- **Auto-dressing**: arm's-length files with blank files where strength does not divide,
  open and close order, three/two/single ranks, Ch 7 squad intervals and commander
  placement, Ch 8 colour party. RIGHT DRESS is a real movement: heads and eyes right,
  corrective paces, EYES FRONT.
- **3D stage**: painted parade square with pace markings, articulated faceless cadets with
  tunic, belt, brassard, beret and cap badge, Lee-Enfield or colour on a pike with a
  rippling Canadian flag, Army/Sea/Air palettes, low/high detail, orbit plus front, flank,
  overhead and follow cameras.
- **2D plot**: top-down square with headings, trails, start ghosts, colour party and WO
  markers, ruler and fit/zoom.
- **Programme**: sortable cards with derived timings, duplicate/remove, undo/redo,
  expandable detail, validation list, timeline scrubbing from 0.25x to 2x.
- **Save/load**: JSON through the Electron menus and native dialogs (browser download
  fallback), plus autosave.

## Running it

```bash
npm install
npm run app      # build the renderer, then open the desktop window
npm run dev      # browser version on http://localhost:5173
```

`npm run app` passes `--no-sandbox` because Electron's SUID sandbox helper is not installed
root-owned on every Linux setup; remove that flag if your machine has it configured.

## Structure

```
electron/          window, menu, open/save dialogs (CommonJS, no second build step)
src/engine/        types, constants, movement catalogue, dressing, timeline simulation
src/state/         zustand store with undo/redo, autosave and JSON persistence
src/ui/            library, programme, inspector, transport
src/view2d/        canvas plan view
src/view3d/        three.js stage and procedural cadet figure
```

The drill model is declarative: movements become timed segments, and both views render the
same sampled snapshot, so the 2D plot and the 3D parade can never disagree.

## Notes

- Paces: quick and slow 75 cm, step out 85, step short 55, side 25, half 35, double 1 m.
  Cadence 120 / 60 / 180. Standard pause: two beats of quick time at the halt, two paces on
  the march.
- No third-party art assets are bundled. The cadets, rifles, colours and square are generated
  in code. three.js is MIT licensed.
- Unofficial training aid. Not affiliated with the Department of National Defence, the
  Canadian Cadet Organizations or the Canadian Armed Forces.
