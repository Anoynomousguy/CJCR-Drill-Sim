# The anatomy behind the cadet rig

This is the working brief for `src/engine/gait.ts` and `src/view3d/figure.ts`.
It is deliberately written before the code: the joints, muscles and gait phases
below decide what the model is allowed to do. Nothing here is a cosmetic angle
picked by eye.

The short version: a body is a stack of levers moved by muscles across joints.
A pose is valid only when every joint is inside its range, every planted foot is
on the ground, and the pelvis is where the stance leg can actually hold it.

## 1. The skeleton is a chain of joints, not a set of boxes

| Joint | Type | What it does | Active range used here |
| --- | --- | --- | --- |
| Hip | ball and socket | flexion/extension, abduction/adduction, internal/external rotation | −28° extension to 120° flexion; 45° abduction; 15° internal / 35° external rotation |
| Knee | modified hinge | flexion/extension; a small automatic "screw-home" rotation at full extension | 0–140° flexion; never negative |
| Ankle (talocrural) | hinge | dorsiflexion/plantarflexion | −20° dorsiflexion to 50° plantarflexion |
| Subtalar | plane joint | inversion/eversion, the foot's roll over the ground | small, folded into the foot roll |
| MTP (ball of foot) | condyloid | toe extension when the heel rises | 0–60° extension |
| Shoulder | ball and socket | flexion/extension, abduction/adduction, rotation | −60° to 180° flexion; −45° to 180° abduction |
| Elbow | hinge | flexion/extension | 0–145° |
| Wrist | ellipsoid | flexion/extension, radial/ulnar deviation | −80° to 70° |
| Fingers: MCP / PIP / DIP | condyloid / hinge / hinge | flexion, extension, small abduction | MCP 0–90°, PIP 0–100–110°, DIP 0–80° |
| Thumb: CMC / MCP / IP | saddle / hinge / hinge | opposition, flexion, pinch | CMC opposition 50–70°, MCP 0–50°, IP 0–80° |
| Cervical spine | complex | rotation, flexion/extension | 45° rotation for eyes right; 50° flexion / 60° extension |
| Thoracic / lumbar | complex | rotation, flexion, side bend | ±45° thoracic rotation; −25° to 60° lumbar flexion |

The knee is the joint that exposes a bad rig fastest. It has one degree of
freedom in the sagittal plane and it does not bend backwards. In this model the
knee is solved as a true two-bone hinge: the femur and tibia are fixed lengths,
the knee is placed on the forward side of the hip-to-ankle line, and the flexion
angle comes from the law of cosines. A pose that would need a negative knee
angle is impossible by construction, not clamped after the fact.

The ankle is not a hinge between the shank and a rigid foot. The foot has two
parts and the heel, ball and toe contact the ground in sequence. That is why the
foot in this rig is split at the MTP joint and why the toe counter-rotates
against the shank during heel-off.

## 2. Muscles: origin, insertion, action

A muscle can only pull. It shortens, its belly thickens, and it moves the bone
at its insertion towards its origin. The rig models the 20 prime movers of the
joints it animates; each is a body between two bone-attached points, measured
every frame, so a shortening muscle visibly bulges.

| Muscle | Origin | Insertion | Action |
| --- | --- | --- | --- |
| Gluteus maximus | ilium, sacrum, sacrotuberous ligament | gluteal tuberosity, iliotibial band | hip extension, external rotation |
| Iliopsoas | lumbar vertebrae, iliac fossa | lesser trochanter | hip flexion, the strongest hip flexor |
| Rectus femoris | anterior superior iliac spine | tibial tuberosity via the patella | hip flexion **and** knee extension (two-joint) |
| Vastus lateralis | linea aspera of femur | patella, tibial tuberosity | knee extension |
| Vastus medialis | medial femur | patella, tibial tuberosity | knee extension; the oblique fibres stabilise the patella |
| Biceps femoris | ischial tuberosity, linea aspera | fibular head | hip extension, knee flexion, external rotation |
| Semitendinosus | ischial tuberosity | pes anserinus (medial tibia) | hip extension, knee flexion, internal rotation |
| Tibialis anterior | lateral tibia | medial cuneiform, first metatarsal | dorsiflexion, inversion; lifts the foot in swing |
| Gastrocnemius | femoral condyles | calcaneus via Achilles tendon | plantarflexion **and** knee flexion (two-joint) |
| Soleus | tibia, fibula | calcaneus via Achilles tendon | plantarflexion; the postural calf |
| Deltoid | clavicle, acromion, scapular spine | deltoid tuberosity | shoulder abduction, flexion, extension |
| Pectoralis major | sternum, clavicle, costal cartilages | intertubercular groove of humerus | adduction, internal rotation, flexion |
| Latissimus dorsi | thoracolumbar fascia, ilium, ribs | intertubercular groove | extension, adduction, internal rotation |
| Biceps brachii | scapula (supraglenoid tubercle, coracoid) | radial tuberosity | elbow flexion, supination |
| Triceps brachii | scapula, posterior humerus | olecranon | elbow extension |
| Brachioradialis | lateral humerus | radial styloid | elbow flexion, strongest with the forearm neutral |
| Trapezius | occiput, C7–T12 spinous processes | clavicle, acromion, scapular spine | elevates and retracts the shoulder |
| Erector spinae | sacrum, ilium | ribs, vertebrae | trunk extension, posture |
| Rectus abdominis | pubis | xiphoid, costal cartilages | trunk flexion, pelvic tilt |
| Sternocleidomastoid | sternum, clavicle | mastoid process | cervical rotation and flexion; turns the head first |

Two-joint muscles are the interesting ones. Rectus femoris shortens at the hip
when the thigh lifts but lengthens again at the knee if the knee folds;
gastrocnemius is stretched by dorsiflexion and by knee extension. A rig that
moves a muscle as one rigid capsule cannot show this. This one measures both
ends every frame and scales the belly from the real distance.

### What the muscles do in a step

- **Initial contact (0–2%).** Hip extensors, knee flexors and ankle dorsiflexors
  are active to place the foot; the heel lands first, the knee is nearly straight.
- **Loading response (2–12%).** The knee flexes about 15° while the quadriceps
  control it eccentrically. Gluteus medius and the hip abductors stop the pelvis
  dropping on the swing side.
- **Mid-stance (12–30%).** The body passes over the foot. The hip extends, the
  knee extends, the calf begins to take the load.
- **Terminal stance (30–50%).** The heel rises. Gastrocnemius and soleus
  plantarflex the ankle and the MTP joint extends so the toes stay on the ground.
- **Pre-swing (50–60%).** The hip flexors start, the knee flexes, the foot leaves
  the ground.
- **Initial swing (60–73%).** Iliopsoas and tibialis anterior lift and clear the
  foot; the knee is at its most flexed.
- **Mid-swing (73–87%).** The knee extends; the hamstrings begin to decelerate
  the shank.
- **Terminal swing (87–100%).** Hamstrings and quadriceps prepare the leg for the
  next contact; the ankle dorsiflexes to clear the toe.

## 3. How a human walks

A gait cycle is the time from one heel strike to the next heel strike of the
same foot. In normal walking the stance phase is about 60% of the cycle and the
swing phase about 40%; running inverts that (stance about 40%, with a flight
phase). The two feet overlap in double support for roughly 10% at each end of
stance. The model uses a duty factor per gait and derives stance and swing from
it.

The four foot rockers, in order:

1. **Heel rocker.** The heel strikes, the foot is dorsiflexed (toe up), and the
   ankle plantarflexes as the foot comes flat.
2. **Ankle rocker.** The foot is flat; the shank rotates over the ankle while
   the foot stays still on the ground.
3. **Forefoot rocker.** The heel lifts and the foot pivots over the ball; the
   MTP joint extends so the toes remain flat.
4. **Toe rocker.** The foot leaves the ground over the toe, the knee flexes and
   the leg swings.

The pelvis is not a rigid box. It rotates about 8° to the side of the swinging
leg, lists about 4–5° over the stance leg, and shifts 2.5–5 cm towards the foot
carrying the weight. The thorax counter-rotates so the shoulders stay square.
The arms swing in the opposite phase to the leg on the same side: left leg
forward, right arm forward. Vertical pelvis movement is a consequence of the
legs, not a separate sine wave: it is highest near mid-stance and lowest around
double support, and its size depends on step length and knee flexion.

The numbers in `gait.ts`:

| Gait | Step | Duty (stance) | Cadence | Speed | Swing knee | Toe-off ankle |
| --- | --- | --- | --- | --- | --- | --- |
| Slow time | 0.75 m | 0.60 | 60 ppm | 0.75 m/s | up to 58° | 32° plantarflexion |
| Quick time | 0.75 m | 0.58 | 120 ppm | 1.5 m/s | up to 65° | 32° |
| Double time | 1.00 m | 0.42 | 180 ppm | 3.0 m/s | up to 92° | 32° |
| Mark time | 0 | 0.56 | 120 ppm | 0 | up to 86° | 18° |

`gaitTargets()` produces foot targets, not joint angles. The knee and hip angles
are then solved from those targets. A planted foot's world position is
independent of the phase: the stance foot moves backwards through body space at
exactly the speed the body moves forwards, so the audit measures 0.00 cm of
drift. This is the single most important difference from the old model, which
swung the legs with sines and let the feet slide.

## 4. The hand and the rifle

The hand has four fingers with three phalanges each and a thumb with a
metacarpal and two phalanges. Flexion is not uniform: the MCP joints flex about
90°, the PIP joints about 100–110°, and the DIP joints about 80°. The fingers
also form a cascade — the index and middle reach further than the little finger
— and the thumb rotates across the palm (opposition) to meet them.

A power grip around a rifle is not a fist with straight fingers. The palm lies
along the stock, the thumb wraps on one side, and the fingers curl around the
other. In the rig the hand is oriented from the rifle's own axis: the wrist is
offset one palm's thickness from the barrel, the back of the hand faces away
from the stock, and the fingers close to about 92% of their range. A free hand
keeps about 20% flexion, which is what a relaxed hand at attention looks like.

The finger joints are real groups in the mesh, so the grip is visible in every
mode: uniform, x-ray, skeleton and muscle.

## 5. Turning

A person does not rotate as one rigid piece. The sequence is:

1. the eyes and head lead the turn;
2. the chest rotates before the pelvis;
3. the weight shifts onto the inside foot;
4. that foot pivots on its ball, heel slightly raised;
5. the outside foot lifts and steps around;
6. the pelvis catches up and the body settles.

In the rig, `turnPose(rate)` produces the head lead (up to 18°), chest lead (up
to 11°), pelvic lag (up to 7°), lateral lean and list into the turn, a 9° heel
raise on the pivot foot and a 2.8 cm lift on the stepping foot. The pelvis is
also shifted towards the pivot foot. The rate is smoothed from the heading
change, so a halted turn has a beginning, a pivot and a settle instead of a
snap. The audit checks the inside foot and the sign of every lead.

## 6. Why this is still a procedural rig

I evaluated the free modelling route before writing the geometry:

- **Blender + Rigify** can build a human metarig, skin it and export glTF 2.0.
  It is the right tool for a hero character.
- **MakeHuman** produces CC0 human meshes with a skeleton and shape sliders.
- **three.js `SkinnedMesh`** can load a glTF skeleton and blend weights.

Those are good options for a single detailed character. This app generates
24–90 cadets at runtime, each with its own height, uniform, weapon and drill
state, and it has to switch between uniform, x-ray, skeleton and muscle layers
on the same body. A downloaded skinned mesh would still need the same joint
model to drive it, and the failure the user saw was not the surface: it was that
the feet slid, the knees floated and the turns were rigid. Replacing the mesh
first would have hidden the same bad motion inside a nicer surface.

So the rig stays procedural and the motion was rebuilt from the anatomy. The
Blender/Rigify → glTF route remains the natural next step if a sculpted surface
with skin weights is wanted; the gait model and the joint solver would drive it
unchanged.

## 7. Sources

- PM&R KnowledgeNow, *Biomechanics of Normal Gait* — stance subphases, the heel
  rocker, knee flexion in loading, hip abductor role:
  https://now.aapmr.org/biomechanics-normal-gait
- *Step-by-step insight into gait analysis: a narrative review unlocking knee
  biomechanics*, PMC — 60/40 stance/swing, heel strike to toe-off, knee
  kinematics: https://pmc.ncbi.nlm.nih.gov/articles/PMC13418446
- *Finger Kinematics during Human Hand Grip and Release*, PMC — MCP/PIP/DIP
  motion in grip and release: https://pmc.ncbi.nlm.nih.gov/articles/PMC10296280
- *The Normal Active Range of Motion of the Index, Middle, Ring, and Little
  Fingers*, PMC — measured MCP, PIP and DIP ranges:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11436331
- *Hip Anatomy and Biomechanics Relevant to Hip Replacement*, NCBI Bookshelf —
  hip range in gait, 35–45° late-swing flexion, ~8° pelvic rotation and ~5°
  frontal list: https://www.ncbi.nlm.nih.gov/books/NBK565771/
- *Normal Gait*, Musculoskeletal Key — the seven gait events and the four
  stance periods: https://musculoskeletalkey.com/normal-gait/
- OpenStax, *Anatomy and Physiology 2e* — joint types, muscle origins,
  insertions and actions: https://openstax.org/books/anatomy-and-physiology-2e
- *Manual of Drill and Ceremonial* (A-DH-201-000/PT-000), Chapters 3, 7 and 8 —
  pace length, cadence and the drill commands the animation has to serve.

## 8. Measured result

`npm test` runs the gait audit over 240 phases per gait. At the time of writing:

| Gait | Support | Pelvis bob | Max hip | Knee range | Max ankle | Foot drift | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Halt | 100% | 0.0 cm | 0° | 0–0° | 0° | 0.00 cm | 1.00 |
| Slow | 100% | 12.4 cm | 37° | 0–58° | 32° | 0.00 cm | 0.94 |
| Quick | 100% | 11.6 cm | 39° | 0–65° | 32° | 0.00 cm | 0.96 |
| Double | 84% support (flight) | 10.8 cm | 60° | 0–92° | 32° | 0.00 cm | 0.98 |
| Mark time | 100% | 2.2 cm | 56° | 11–86° | 18° | 0.00 cm | 1.00 |

The bob is large because the manual's 75 cm pace is long relative to the 0.87 m
leg: at contact the forward foot is 0.44 m ahead of the hip. Real walking
absorbs some of that with pelvic rotation and a longer effective leg; the model
keeps the contact honest rather than shortening the step and letting the foot
slide. The audit treats a planted foot moving by even 0.5 cm as a failure.
