// Standalone spike viewer for the Blender skinned cadet.
// Open http://127.0.0.1:5173/skinned.html while the dev server is running.
//
// This is deliberately not part of the parade stage: the point is to judge the
// skinned body and its walk clip on their own before deciding how to merge the
// mesh into the procedural rig.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const container = document.getElementById('viewer');
if (!container) throw new Error('viewer container missing');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1114);
scene.fog = new THREE.Fog(0x0b1114, 8, 22);

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 0.1, 60);
camera.position.set(2.8, 1.55, 3.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.92, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.6;
controls.maxDistance = 8;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new THREE.HemisphereLight(0xb9ced2, 0x1b221a, 1.35);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff0d6, 2.6);
key.position.set(3.5, 5.5, 4.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 16;
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 4;
key.shadow.camera.bottom = -1;
scene.add(key);

const rim = new THREE.DirectionalLight(0x7e9fb4, 1.1);
rim.position.set(-4, 3, -3);
scene.add(rim);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(7, 64),
  new THREE.MeshStandardMaterial({ color: 0x20282a, roughness: 1, metalness: 0 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(14, 28, 0x3c4a4c, 0x263033);
grid.position.y = 0.001;
scene.add(grid);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.95, 1.0, 64),
  new THREE.MeshBasicMaterial({ color: 0x566a5a, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.002;
scene.add(ring);

const loading = document.createElement('div');
loading.style.cssText =
  'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:12px ui-sans-serif;color:#93a59a;letter-spacing:.08em;text-transform:uppercase';
loading.textContent = 'Loading cadet…';
document.body.appendChild(loading);

let mixer: THREE.AnimationMixer | null = null;

new GLTFLoader().load(
  '/models/cadet.glb',
  (gltf) => {
    loading.remove();
    const model = gltf.scene;
    // Blender's +Y forward becomes glTF -Z; turn it to face the viewer.
    model.rotation.y = Math.PI;
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        const material = object.material;
        if (material instanceof THREE.MeshStandardMaterial) material.envMapIntensity = 0.6;
      }
    });
    scene.add(model);
    if (gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(model);
      const walk = gltf.animations.find((clip) => /walk/i.test(clip.name)) ?? gltf.animations[0];
      mixer.clipAction(walk).play();
    }
  },
  undefined,
  (error) => {
    loading.textContent = 'Could not load /models/cadet.glb';
    loading.style.color = '#d59a86';
    console.error(error);
  },
);

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  mixer?.update(dt);
  controls.update();
  renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
