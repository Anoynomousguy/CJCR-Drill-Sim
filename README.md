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
  spine, ribs, sternum, clavicles, scapulae, pelvis, humerus, radius and ulna, hand and finger
  bones, femur, patella, tibia, fibula, split foot) with a dynamic muscle layer over it.
  Switch between uniform, x-ray, skeleton and muscles, and read the live joint angles for the
  front-right marker in the corner of the stage. Every joint is clamped to its physiological
  range.
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

Poses are joint motion, not arbitrary rotation. `src/engine/gait.ts` is a contact-driven gait
model: a planted foot is fixed to the ground, the knee is a real two-bone hinge, the ankle
rolls heel → flat → ball → toe with the MTP joint, and the pelvis height is solved from the
leg that is carrying the weight. `src/view3d/figure.ts` puts that on the bone rig, with
articulated fingers and a muscle layer that measures each origin-to-insertion length every
frame and bulges as it shortens.

The full biology brief — joint types and ranges, the 20 muscles and their actions, the four
foot rockers, finger mechanics and the sequence of a turn — is in
[docs/ANATOMY.md](docs/ANATOMY.md).

| Joint | Range | What the model does |
| --- | --- | --- |
| Hip flexion | −28° to 120° | 39° quick time, 60° double, 56° mark time; 26° extension at toe-off |
| Knee flexion | 0° to 140° | 2° contact, 15° loading, 36–38° toe-off, 65° swing quick, 92° double |
| Ankle plantarflexion | −20° to 50° | −11° heel strike, 0° foot flat, 32° toe-off |
| MTP extension | 0° to 60° | matches the shank at heel-off so the toes stay flat |
| Shoulder flexion | −60° to 180° | ±20° swing quick, ±30° double; a carrying arm is fixed at its grip |
| Elbow flexion | 0° to 145° | 18–28° quick, 72–88° double |
| Cervical rotation | ±80° | 45° eyes right |
| Pelvic rotation / list | ±45° / ±15° | 4° rotation, 4° list, 2.8 cm sway in quick time |

At attention the feet are 30° apart, heels together, and the legs are straight because the
pelvis sits exactly at the height the stance leg can hold. Mark time lifts the thigh to 55°
with 85° of knee flexion, not an impossible 90/90. During the step the pelvis rotates
towards the swinging leg and lists over the stance leg; the shoulders counter-rotate; the
free arm swings opposite its leg. The neck turns 45° for eyes right while the shoulders stay
square.

### Rifle and colour carriage

A carried rifle is placed as a frame, not glued to a hand: a butt position and a barrel axis
in chest space, with the hands on the named grips — the small of the butt, the balance and the
upper band. At the order the butt stands on the square and the right hand takes the upper band
where a straight arm falls (0.90 m up the rifle); at the slope the barrel passes through the
hollow of the left shoulder and the butt sits in the left hand in front of and in line with the
centre of the left shoulder, the left forearm parallel to the ground, the right arm free; at the
present and the port the left hand is at the balance above the right hand at the small of the
butt. Every grip is checked against the 51 cm reach of the arm and the rifle's
1.13 m length. The colour is carried the same way on its 2.15 m pike.

### Checks

`npm test` runs 35 checks, including:

- every planted foot inside its leg's reach, every knee bending forward, and every sampled
  joint inside its range of motion at 240 phases per gait;
- the planted foot's world position held to 0.00 cm through stance — no skating;
- the live rig read back for all 10 weapon states, 6 colour states and 4 gaits, with each
  angle inside its limit;
- the heel → flat → ball → toe sequence, the MTP joint staying flat during heel-off, the
  mark-time knee lift, and the fingers curling around a carried rifle;
- the live rifle frames at the order, present and port, and the slope axis passing within
  6 cm of the left shoulder;
- the turn's head lead, chest lead and pelvic lag.

`npm run build` compiles the renderer.

## Notes

- Paces: quick and slow 75 cm, step out 85, step short 55, side 25, half 35, double 1 m.
  Cadence 120 / 60 / 180. Standard pause: two beats of quick time at the halt, two paces on
  the march.
- No third-party art assets are bundled. The cadets, rifles, colours and square are generated
  in code. three.js is MIT licensed.
- Unofficial training aid. Not affiliated with the Department of National Defence, the
  Canadian Cadet Organizations or the Canadian Armed Forces.
