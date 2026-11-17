# Blender 4.5 headless build of a skinned cadet body.
#
# Spike goal: replace the procedural capsule figure with one continuous human
# mesh, a real armature, automatic skin weights and a short walk action. The
# body is built from blended soft balls, then voxel-remeshed into a single
# watertight surface so the shoulders, hips, knees and wrists bend as skin
# rather than as separate primitives.
#
# Run:
#   blender -b --python scripts/blender/make_cadet.py
#
# Blender coordinates: +Z up, +Y forward. glTF exports Y-up, so the model faces
# -Z in three.js; the viewer rotates it to face the camera.

import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, 'public', 'models')
MEDIA = os.path.join(ROOT, 'docs', 'media')
os.makedirs(MODELS, exist_ok=True)
os.makedirs(MEDIA, exist_ok=True)

# ---------------------------------------------------------------- clean scene
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.metaballs,
              bpy.data.armatures, bpy.data.actions):
    for item in list(block):
        block.remove(item)

scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.fps = 30
scene.frame_start = 1
scene.frame_end = 30

# ---------------------------------------------------------------------- body
mball = bpy.data.metaballs.new('CadetBody')
mball.resolution = 0.012
mball.render_resolution = 0.008
mball.threshold = 0.6
body = bpy.data.objects.new('CadetBody', mball)
bpy.context.collection.objects.link(body)


def ball(x, y, z, r, stiffness=2.0):
    el = mball.elements.new()
    el.co = (x, y, z)
    el.radius = r
    el.stiffness = stiffness


# Hips and torso: a flat waist, a broad chest and deltoid caps give the tunic
# a human silhouette instead of a cylinder.
ball(0, 0, 0.88, 0.165)
ball(0, 0, 0.94, 0.160)
ball(0, 0, 1.02, 0.142)
ball(0, 0, 1.10, 0.150)
ball(0, 0.004, 1.18, 0.165)
ball(0, 0.006, 1.25, 0.180)
ball(0, 0, 1.32, 0.160)
ball(0.125, 0, 1.33, 0.095)
ball(-0.125, 0, 1.33, 0.095)


# neck and head
ball(0, 0.005, 1.40, 0.060)
ball(0, 0.005, 1.45, 0.055)
ball(0, 0.005, 1.555, 0.098)
ball(0, 0.018, 1.625, 0.105)
ball(0, 0.045, 1.545, 0.078)     # jaw
ball(0, 0.108, 1.605, 0.024)     # nose
ball(0.093, 0.012, 1.60, 0.026)  # ears
ball(-0.093, 0.012, 1.60, 0.026)

# arms, relaxed A-pose; the forearm tapers to a wrist that merges with the hand
for s in (1, -1):
    ball(s * 0.175, 0, 1.33, 0.078)
    for i in range(7):
        t = i / 6
        ball(s * (0.19 + 0.105 * t), 0, 1.31 - 0.25 * t, 0.066 - 0.013 * t)
    ball(s * 0.298, 0, 1.055, 0.050)
    for i in range(7):
        t = i / 6
        ball(s * (0.303 + 0.062 * t), 0, 1.035 - 0.195 * t, 0.048 - 0.010 * t)
    # wrist, palm and a mitten hand: four fingers as one volume, plus a thumb
    ball(s * 0.366, 0.005, 0.842, 0.043)
    ball(s * 0.372, 0.020, 0.795, 0.055)
    ball(s * 0.374, 0.055, 0.765, 0.034)
    # four fingers hanging under the palm, merged at the knuckles
    for f in range(4):
        fx = s * (0.346 + f * 0.019)
        ball(fx, 0.058, 0.728, 0.017)
        ball(fx, 0.047, 0.705, 0.014)
    ball(s * 0.342, 0.035, 0.775, 0.022)

# legs: thicker thighs and calves, with a real boot volume at the bottom
for s in (1, -1):
    ball(s * 0.085, 0, 0.875, 0.118)
    for i in range(9):
        t = i / 8
        ball(s * (0.093 + 0.014 * t), 0, 0.85 - 0.36 * t, 0.103 - 0.032 * t)
    ball(s * 0.105, 0, 0.485, 0.070)
    for i in range(8):
        t = i / 7
        ball(s * (0.105 + 0.004 * t), 0, 0.465 - 0.345 * t, 0.068 - 0.022 * t)
    ball(s * 0.107, 0, 0.115, 0.052)
    ball(s * 0.107, 0.035, 0.075, 0.058)   # heel/instep
    ball(s * 0.107, 0.095, 0.060, 0.056)   # forefoot
    ball(s * 0.107, 0.155, 0.050, 0.048)   # toe box
    ball(s * 0.107, 0.195, 0.042, 0.032)   # tip
    # a flat-ish sole, part of the same skin so it can never leave the boot
    ball(s * 0.107, 0.015, 0.028, 0.048, 3.2)
    ball(s * 0.107, 0.085, 0.026, 0.052, 3.2)
    ball(s * 0.107, 0.160, 0.030, 0.044, 3.2)

bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.convert(target='MESH')
body = bpy.context.object
bpy.ops.object.shade_smooth()

# One watertight surface from the blended balls, then decimate to a game-ready
# density. The remesh is what makes the mesh skin-continuous across joints.
rem = body.modifiers.new('Remesh', 'REMESH')
rem.mode = 'VOXEL'
rem.voxel_size = 0.009
bpy.ops.object.modifier_apply(modifier=rem.name)

# Voxel remeshing leaves a faint staircase; relax it before decimating so the
# tunic catches light as cloth rather than as corduroy.
sm = body.modifiers.new('Smooth', 'SMOOTH')
sm.factor = 0.55
sm.iterations = 10
bpy.ops.object.modifier_apply(modifier=sm.name)

dec = body.modifiers.new('Decimate', 'DECIMATE')
dec.ratio = 0.22
bpy.ops.object.modifier_apply(modifier=dec.name)
bpy.ops.object.shade_smooth()

bpy.context.view_layer.update()
zmin = min((body.matrix_world @ v.co).z for v in body.data.vertices)
body.location.z -= zmin
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
print('BODY verts', len(body.data.vertices), 'faces', len(body.data.polygons))

# ------------------------------------------------------------------ materials
def material(name, color, roughness=0.78):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    mat.diffuse_color = (*color, 1.0)
    return mat

skin = material('Skin', (0.66, 0.45, 0.30), 0.7)
tunic = material('Tunic', (0.18, 0.23, 0.115), 0.88)
tunicLight = material('TunicLight', (0.23, 0.28, 0.15), 0.85)
trousers = material('Trousers', (0.075, 0.085, 0.060), 0.9)
boots = material('Boots', (0.030, 0.028, 0.024), 0.5)
beret = material('Beret', (0.13, 0.17, 0.095), 0.95)
gold = material('Badge', (0.62, 0.48, 0.16), 0.4)
eye = material('Eye', (0.035, 0.026, 0.020), 0.45)
shirt = material('Shirt', (0.42, 0.43, 0.33), 0.8)
for mat in (skin, tunic, trousers, boots):
    body.data.materials.append(mat)

for poly in body.data.polygons:
    c = poly.center
    z = c.z
    if z > 1.42 or (abs(c.x) > 0.315 and z < 0.87):
        poly.material_index = 0          # head, neck and hands
    elif z < 0.155:
        poly.material_index = 3          # boots
    elif z < 0.835:
        poly.material_index = 2          # trousers
    else:
        poly.material_index = 1          # tunic

# ------------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new('CadetRig')
arm = bpy.data.objects.new('CadetRig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name)
    b.head = head
    b.tail = tail
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    return b

bone('pelvis', (0, 0, 0.87), (0, 0, 1.00))
bone('spine', (0, 0, 1.00), (0, 0, 1.15), 'pelvis', True)
bone('chest', (0, 0, 1.15), (0, 0, 1.33), 'spine', True)
bone('neck', (0, 0, 1.37), (0, 0, 1.45), 'chest')
bone('head', (0, 0, 1.45), (0, 0, 1.72), 'neck', True)
for s, side in ((1, 'L'), (-1, 'R')):
    bone(f'shoulder.{side}', (0, 0, 1.33), (s * 0.175, 0, 1.33), 'chest')
    bone(f'upper_arm.{side}', (s * 0.175, 0, 1.33), (s * 0.298, 0, 1.06), f'shoulder.{side}')
    bone(f'forearm.{side}', (s * 0.298, 0, 1.06), (s * 0.366, 0.005, 0.842), f'upper_arm.{side}', True)
    bone(f'hand.{side}', (s * 0.366, 0.005, 0.842), (s * 0.374, 0.08, 0.745), f'forearm.{side}', True)
    bone(f'thigh.{side}', (s * 0.09, 0, 0.875), (s * 0.105, 0, 0.485), 'pelvis')
    bone(f'shin.{side}', (s * 0.105, 0, 0.485), (s * 0.107, 0, 0.115), f'thigh.{side}', True)
    bone(f'foot.{side}', (s * 0.107, 0, 0.115), (s * 0.107, 0.13, 0.045), f'shin.{side}', True)
    bone(f'toe.{side}', (s * 0.107, 0.13, 0.045), (s * 0.107, 0.21, 0.04), f'foot.{side}', True)

bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
print('BODY parented, vertex groups', len(body.vertex_groups))

# ---------------------------------------------------------------- accessories
def skinned_to(obj, bone_name):
    """Rigidly bind an accessory to one bone (beret, belt, eyes, badge).

    Bake the object transform into the mesh first. An armature modifier reads
    vertices in armature space; if an accessory keeps its own origin, a bone
    rotation swings it around the wrong point (the sole left the boot, the cap
    hovered).
    """
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    # Parent with an armature deform (not a plain object parent). The glTF
    # exporter only writes a skin for armature children; a plain object parent
    # exports the accessory frozen at its rest pose.
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE')

accessories = []


def rounded_box(name, size, location, mat, bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mod = obj.modifiers.new('Bevel', 'BEVEL')
    mod.width = bevel
    mod.segments = 2
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(mat)
    return obj


# Beret, pulled down over the brow, with a small gold badge at the front.
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.0, location=(0, 0, 1.663))
hat = bpy.context.object
hat.name = 'Beret'
hat.scale = (0.150, 0.160, 0.058)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.object.shade_smooth()
hat.data.materials.append(beret)
skinned_to(hat, 'head')
accessories.append(hat)

bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.105, depth=0.020, location=(0, 0, 1.626))
brim = bpy.context.object
brim.name = 'BeretBrim'
brim.scale = (1.0, 1.08, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
brim.data.materials.append(beret)
skinned_to(brim, 'head')
accessories.append(brim)

bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.016, location=(0, 0.165, 1.645))
badge = bpy.context.object
badge.name = 'Badge'
badge.data.materials.append(gold)
skinned_to(badge, 'head')
accessories.append(badge)

# Eyes and a mouth line below the beret.
for side in (1, -1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=10, radius=0.011, location=(side * 0.031, 0.099, 1.608))
    orb = bpy.context.object
    orb.name = f'Eye.{side}'
    orb.data.materials.append(eye)
    skinned_to(orb, 'head')
    accessories.append(orb)

mouth = rounded_box('Mouth', (0.045, 0.012, 0.007), (0, 0.104, 1.565), eye, 0.003)
skinned_to(mouth, 'head')
accessories.append(mouth)

# Collar and shirt opening at the neck.
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.084, depth=0.048, location=(0, 0.004, 1.425))
collar = bpy.context.object
collar.name = 'Collar'
collar.scale = (1.0, 0.82, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
collar.data.materials.append(tunicLight)
skinned_to(collar, 'chest')
accessories.append(collar)

shirt_v = rounded_box('ShirtV', (0.052, 0.02, 0.075), (0, 0.082, 1.395), shirt, 0.006)
skinned_to(shirt_v, 'chest')
accessories.append(shirt_v)

# Tunic buttons.
for i, (z, y) in enumerate(((1.30, 0.165), (1.22, 0.187), (1.14, 0.170), (1.06, 0.150))):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.009, location=(0, y, z))
    button = bpy.context.object
    button.name = f'Button.{i}'
    button.data.materials.append(gold)
    skinned_to(button, 'chest')
    accessories.append(button)

# Belt at the waist, fitted over the tunic, with a square brass buckle.
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.158, depth=0.045, location=(0, 0, 0.912))
belt = bpy.context.object
belt.name = 'Belt'
belt.scale = (1.0, 0.73, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
belt.data.materials.append(boots)
skinned_to(belt, 'pelvis')
accessories.append(belt)

buckle = rounded_box('Buckle', (0.055, 0.018, 0.036), (0, 0.122, 0.912), gold, 0.005)
skinned_to(buckle, 'pelvis')
accessories.append(buckle)

# Join the rigid accessories into the skinned body. Kept separate, the glTF
# exporter writes them as unskinned children frozen at the rest pose; joined,
# there is one mesh and one skin, and the soles actually move with the boots.
bpy.ops.object.select_all(action='DESELECT')
for obj in (body, *accessories):
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body = bpy.context.object
print('BODY joined verts', len(body.data.vertices), 'groups', len(body.vertex_groups))

# --------------------------------------------------------------- walk action
arm.animation_data_create()
action = bpy.data.actions.new('Walk')
arm.animation_data.action = action
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'

D = math.pi / 180
frames = {
    1:  {'thigh.L': 24, 'shin.L': -6, 'thigh.R': -18, 'shin.R': -28,
         'upper_arm.L': -14, 'upper_arm.R': 14, 'forearm.L': -12, 'forearm.R': -18},
    8:  {'thigh.L': 4, 'shin.L': -22, 'thigh.R': 4, 'shin.R': -8,
         'upper_arm.L': 0, 'upper_arm.R': 0, 'forearm.L': -14, 'forearm.R': -14},
    15: {'thigh.L': -18, 'shin.L': -28, 'thigh.R': 24, 'shin.R': -6,
         'upper_arm.L': 14, 'upper_arm.R': -14, 'forearm.L': -18, 'forearm.R': -12},
    22: {'thigh.L': 4, 'shin.L': -8, 'thigh.R': 4, 'shin.R': -22,
         'upper_arm.L': 0, 'upper_arm.R': 0, 'forearm.L': -14, 'forearm.R': -14},
}
frames[30] = dict(frames[1])
for frame, poses in frames.items():
    scene.frame_set(frame)
    for name, deg in poses.items():
        pb = arm.pose.bones.get(name)
        if not pb:
            continue
        pb.rotation_euler.x = deg * D
        pb.keyframe_insert('rotation_euler', frame=frame)
    pelvis = arm.pose.bones.get('pelvis')
    if pelvis:
        pelvis.location.y = 0.018 if frame in (1, 15, 30) else -0.006
        pelvis.keyframe_insert('location', frame=frame)
bpy.ops.object.mode_set(mode='OBJECT')
for fc in action.fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = 'BEZIER'

scene.frame_set(1)

# ------------------------------------------------------------------- preview
bpy.ops.mesh.primitive_plane_add(size=5, location=(0, 0, -0.004))
plane = bpy.context.object
plane.name = 'PreviewGround'
plane.data.materials.append(material('Ground', (0.10, 0.11, 0.12), 1.0))

cam_data = bpy.data.cameras.new('Camera')
cam = bpy.data.objects.new('Camera', cam_data)
bpy.context.collection.objects.link(cam)
cam.location = (2.05, 3.05, 1.55)
cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.lens = 62
scene.camera = cam

scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.cavity_type = 'BOTH'
scene.render.resolution_x = 760
scene.render.resolution_y = 900
scene.render.film_transparent = False
scene.world.color = (0.035, 0.045, 0.055)
scene.render.filepath = os.path.join(MEDIA, 'skinned-cadet.png')
bpy.ops.render.render(write_still=True)
print('PREVIEW', scene.render.filepath)

# ---------------------------------------------------------------------- glTF
bpy.ops.object.select_all(action='DESELECT')
for obj in (body, arm):
    obj.select_set(True)
bpy.context.view_layer.objects.active = arm
scene.frame_set(1)
out = os.path.join(MODELS, 'cadet.glb')
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=True,
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_frame_range=True,
    export_bake_animation=True,
)
print('GLB', out, os.path.getsize(out))
