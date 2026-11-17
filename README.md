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
- **Anatomy**: the cadet is a bone-by-bone skeleton (skull, mandible, cervical and thoracic
  spine, ribs, sternum, clavicles, scapulae, pelvis, humerus, radius and ulna, hand bones,
  femur, patella, tibia, fibula, foot) with a muscle layer over it. Switch the body between
  uniform, x-ray, skeleton and muscles, and read the live joint angles for the front-right
  marker in the corner of the stage. Every joint is clamped to its physiological range.
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

## Anatomy

Poses are joint motion, not arbitrary rotation. The hip, knee, ankle, shoulder, elbow,
wrist, cervical spine, thoracic spine and pelvis are each driven through `src/engine/anatomy.ts`,
which holds their active ranges of motion and the drill targets that sit inside them:

| Joint | Range | Drill use |
| --- | --- | --- |
| Hip flexion | −20° to 120° | 28° quick march, 45° double march, 90° mark time |
| Knee flexion | 0° to 140° | 0–5° quick and slow march, 90–95° mark time and double |
| Ankle plantarflexion | −20° to 50° | 18° quick march toe, 30° slow march |
| Shoulder flexion | −60° to 180° | ±26° arm swing, 90° salute |
| Shoulder abduction | −45° to 180° | 90° right dress (unarmed), adduction across the body at port |
| Elbow flexion | 0° to 145° | 22° swing, 90° double march, 45° salute |
| Cervical rotation | ±80° | 45° eyes right |
| Thoracic rotation | ±45° | 6° with eyes right, ±3.5° counter-rotation in the step |

Knee height is a consequence of those angles rather than a number picked by eye. Mark time
lifts the thigh to horizontal — 90° of hip flexion and 90° of knee flexion — because the
manual asks for the thigh parallel to the ground. Quick march instead swings a nearly
straight leg from the hip (28° of flexion, 4° of knee flexion, 18° of plantarflexion), which
clears the foot about 30 cm without raising the knee. Double march combines 45° of hip
flexion with 95° of knee flexion. The neck turns 45° for eyes right while the shoulders stay
square; the head counter-rotates against the thoracic twist so the gaze stays steady through
the step.

### Rifle and colour carriage

A carried rifle is placed as a frame, not glued to a hand: a butt position and a barrel axis
in chest space, with the hands on the named grips — the small of the butt, the balance and the
upper band. At the order the butt stands on the square and the right hand takes the upper band
where a straight arm falls (0.90 m up the rifle); at the slope the barrel passes through the
hollow of the left shoulder, the butt sits in the left hand at the hip and the right arm is
free; at the present and the port the left hand is at the balance above the right hand at the
small of the butt. Every grip is checked against the 51 cm reach of the arm and the rifle's
1.13 m length. The colour is carried the same way on its 2.15 m pike.

### Checks

`npm test` runs the numeric check over the real rig:

- every gait's leading leg exactly on its manual target — 28/4/18 quick, 20/3/30 slow,
  45/95/10 double, 90/90/12 mark time — with the trailing leg on its recovery angles;
- 720 sampled phases per gait, all inside the joint ranges, plus every clamp exercised
  beyond its limit;
- the figure is built, animated and read back through `getAngles()` for every weapon,
  colour and gait combination, and each live angle must sit inside its range;
- every rifle and colour grip must lie on its frame, inside the weapon, and inside the
  shoulder-to-wrist reach; the live rifle axis must pass within 6 cm of the left shoulder
  at the slope.

## Notes

- Paces: quick and slow 75 cm, step out 85, step short 55, side 25, half 35, double 1 m.
  Cadence 120 / 60 / 180. Standard pause: two beats of quick time at the halt, two paces on
  the march.
- No third-party art assets are bundled. The cadets, rifles, colours and square are generated
  in code. three.js is MIT licensed.
- Unofficial training aid. Not affiliated with the Department of National Defence, the
  Canadian Cadet Organizations or the Canadian Armed Forces.
