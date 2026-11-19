import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GAIT_ANATOMY, type JointReading } from '../engine/anatomy';
import { UNIFORMS } from '../engine/constants';
import { sampleTimeline, type Timeline } from '../engine/simulate';
import { sampleStepPlan } from '../engine/steps';
import { useStore } from '../state/store';
import { createFigure, type Figure, type FigurePalette } from './figure';
import { applyDebugPose, DEBUG_POSE_CAMERA, readDebugPose } from './debugPose';

type Preset = 'front' | 'flank' | 'overhead' | 'follow';

export function Stage3D() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    figures: Map<string, Figure>;
    square: THREE.Group | null;
    paletteKey: string;
    preset: Preset;
    frame: (preset: Preset) => void;
  } | null>(null);

  const plan = useStore((s) => s.plan);
  const timeline = useStore((s) => s.timeline);
  const detail = useStore((s) => s.detail);
  const bodyMode = useStore((s) => s.body);
  const [anatomy, setAnatomy] = useState<{
    name: string;
    gait: string;
    angles: JointReading[];
    muscles: { name: string; activation: number; peak: number }[];
  } | null>(null);
  const hudClock = useRef(0);

  // --- scene setup (once) -------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    // `?pose=...` turns the stage into a full-size, fixed-camera rig viewer so
    // the extreme poses can be re-entered and re-measured straight from the app.
    const debugPose = readDebugPose();
    const debugPatched = new WeakSet<Figure>();
    if (debugPose) {
      const host = mount.closest('.stage3d');
      if (host instanceof HTMLElement) {
        host.style.cssText =
          'position:fixed;left:0;top:0;width:780px;height:880px;z-index:9999;background:#161d24';
      }
      const requestedBody = new URLSearchParams(window.location.search).get('body');
      if (requestedBody === 'uniform' || requestedBody === 'muscles') {
        useStore.getState().setBody(requestedBody);
      }
    }
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    // Soft PCF plus a tight shadow frustum: a 60 m frustum on a 2048 map gave
    // ~3 cm texels, so a forearm's shadow on a hip came out as a hard black
    // wedge that read as a torn flap of coat.
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#161d24');
    scene.fog = new THREE.Fog('#161d24', 55, 140);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    camera.position.set(0, 9, 22);

    const hemi = new THREE.HemisphereLight('#cfe3f5', '#2a2f2a', 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff3dc', 2.1);
    sun.position.set(22, 30, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 2.5;
    scene.add(sun);
    scene.add(new THREE.AmbientLight('#9fb4c4', 0.25));

    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(90, 48),
      new THREE.MeshStandardMaterial({ color: '#2c382c', roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.07;
    grass.receiveShadow = true;
    scene.add(grass);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 3;
    controls.maxDistance = 65;

    const frame = (preset: Preset) => {
      const state = useStore.getState();
      const sample = sampleTimeline(state.timeline, state.t);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const s of sample.soldiers) {
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minZ = Math.min(minZ, s.z);
        maxZ = Math.max(maxZ, s.z);
      }
      const hasBody = Number.isFinite(minX);
      const cx = hasBody ? (minX + maxX) / 2 : 0;
      const cz = hasBody ? (minZ + maxZ) / 2 : 0;
      const frontage = hasBody ? Math.max(6, maxX - minX) : 12;
      const depthspan = hasBody ? Math.max(4, maxZ - minZ) : 6;
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.4, camera.aspect));
      const needW = (frontage * 0.6) / Math.tan(hFov / 2);
      const needH = (depthspan * 0.78) / Math.tan(vFov / 2);
      const dist = Math.max(8, needW, needH);
      if (preset === 'front') {
        controls.target.set(cx, 1.15, cz);
        camera.position.set(cx - frontage * 0.16, Math.max(4.2, Math.min(11, dist * 0.28)), cz + dist * 0.98);
      } else if (preset === 'flank') {
        controls.target.set(cx, 1.15, cz);
        camera.position.set(cx + dist * 0.95, Math.max(4, Math.min(9.5, dist * 0.24)), cz + depthspan * 0.3);
      } else if (preset === 'overhead') {
        controls.target.set(cx, 0, cz);
        camera.position.set(cx + 0.01, Math.max(14, frontage * 1.05), cz + 0.01);
      } else {
        controls.target.set(cx, 1.1, cz);
        camera.position.set(cx + 2.2, Math.max(3.8, dist * 0.24), cz - Math.max(6, dist * 0.5));
      }
      controls.update();
    };

    apiRef.current = {
      renderer,
      scene,
      camera,
      controls,
      figures: new Map(),
      square: null,
      paletteKey: '',
      preset: 'front',
      frame,
    };

    if (import.meta.env.DEV) (window as unknown as { __cjcrStage?: unknown }).__cjcrStage = apiRef.current;
    frame('front');

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const api = apiRef.current;
        if (api) api.frame(api.preset);
      }, 150);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const state = useStore.getState();
      const api = apiRef.current;
      if (!api) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sample = sampleTimeline(state.timeline, state.t);
      for (const s of sample.soldiers) {
        const fig = api.figures.get(s.soldier.id);
        if (!fig) continue;
        fig.setMode(state.body);
        fig.setHeight(s.soldier.height);
        fig.setTransform(s.x, s.z, s.heading);
        if (debugPose) {
          fig.group.visible = s.soldier.id === sample.soldiers[0]?.soldier.id;
          // The figure resolves its pose inside animate(), so an override applied
          // after it is overwritten by the next frame. Wrap the call so the
          // extreme pose is the last word before the skeleton is read.
          if (!debugPatched.has(fig)) {
            debugPatched.add(fig);
            const original = fig.animate.bind(fig);
            fig.animate = (anim) => {
              original(anim);
              applyDebugPose(fig, debugPose);
            };
          }
        }
        const dressing = sample.title.toLowerCase().includes('dress');
        const stepPlan = sample.steps?.[s.soldier.id];
        const step = stepPlan ? sampleStepPlan(stepPlan, sample.progress) : undefined;
        const dressT = sample.progress;
        fig.animate({
          from: sample.from,
          to: sample.to,
          u: sample.u,
          gait: s.gait,
          stride: s.stride,
          role: s.soldier.role,
          code: s.code,
          time: now / 1000,
          eyes: dressing
            ? sample.to.eyes
            : sample.u > 0.45
              ? sample.to.eyes
              : sample.from.eyes,
          headdress: sample.u > 0.5 ? sample.to.headdress : sample.from.headdress,
          dressing,
          dressT,
          // Right dress turns the head on TWO, after the check pace.
          // The commander orders the dressing and watches it; he does not
          // dress with the ranks, so his head stays front.
          eyesAmount: dressing
            ? s.soldier.role === 'commander'
              ? 0
              : Math.max(0, Math.min(1, (dressT - 0.2) / 0.18))
            : 1,
          // EYES FRONT after a right dress cuts the raised arm on ONE.
          armFromDress:
            sample.prevType === 'rightDress' && sample.title === 'Eyes front'
              ? Math.max(0, 1 - sample.progress / 0.5)
              : undefined,
          feet: step
            ? { left: step.left, right: step.right, hipY: step.hipY }
            : sample.turnBody
              ? { left: sample.turnBody.left, right: sample.turnBody.right, hipY: sample.turnBody.hipY }
              : undefined,
          armCut: stepPlan?.armsAt?.(sample.progress) ?? 0,
          saluteArm: sample.saluteArm,
          turn: sample.turn,
          rifle: sample.rifle,
        });
        fig.tick(dt, now / 1000);
      }
      if (state.body !== 'uniform' && now - hudClock.current > 160) {
        hudClock.current = now;
        const lead = sample.soldiers[0];
        const fig = lead ? api.figures.get(lead.soldier.id) : undefined;
        if (lead && fig) {
          setAnatomy({
            name: lead.soldier.name,
            gait: lead.gait,
            angles: fig.getAngles(),
            muscles: fig.getMuscles().slice(0, 4),
          });
        }
      }
      if (debugPose && sample.soldiers.length) {
        const lead = api.figures.get(sample.soldiers[0].soldier.id);
        if (lead) {
          const cam = DEBUG_POSE_CAMERA[debugPose];
          const offset = new THREE.Vector3(cam.x, 0, cam.z).applyQuaternion(lead.group.quaternion);
          const origin = lead.group.position;
          api.camera.position.set(origin.x + offset.x, cam.y, origin.z + offset.z);
          api.controls.target.set(origin.x, cam.lookY, origin.z);
        }
      }
      if (api.preset === 'follow' && sample.soldiers.length) {
        let cx = 0;
        let cz = 0;
        for (const s of sample.soldiers) {
          cx += s.x;
          cz += s.z;
        }
        cx /= sample.soldiers.length;
        cz /= sample.soldiers.length;
        const delta = new THREE.Vector3(cx, 0, cz).sub(api.controls.target);
        api.controls.target.add(delta);
        api.camera.position.add(delta);
      }
      api.controls.update();
      api.renderer.render(api.scene, api.camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
      apiRef.current = null;
    };
  }, []);

  // --- parade square -----------------------------------------------------
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    if (api.square) {
      api.scene.remove(api.square);
      api.square.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
    const group = buildSquare(plan.settings.squareWidth, plan.settings.squareDepth);
    api.square = group;
    api.scene.add(group);
  }, [plan.settings.squareWidth, plan.settings.squareDepth]);

  // --- figures -----------------------------------------------------------
  const palette = UNIFORMS[plan.settings.uniform] as FigurePalette;
  const rosterKey = timeline.soldiers
    .map((s) => `${s.id}:${s.height.toFixed(2)}:${s.rifle ? 1 : 0}:${s.colour ? 1 : 0}`)
    .join('|');
  const paletteKey = `${plan.settings.uniform}|${detail}`;

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const rebuild = api.paletteKey !== paletteKey || api.figures.size !== timeline.soldiers.length;
    if (rebuild) {
      for (const fig of api.figures.values()) {
        api.scene.remove(fig.group);
        fig.dispose();
      }
      api.figures.clear();
    }
    for (const soldier of timeline.soldiers) {
      if (!api.figures.has(soldier.id)) {
        const fig = createFigure({ palette, detail }, soldier.rifle, soldier.colour);
        fig.setHeight(soldier.height);
        api.scene.add(fig.group);
        api.figures.set(soldier.id, fig);
      }
    }
    for (const [id, fig] of api.figures) {
      if (!timeline.soldiers.some((s) => s.id === id)) {
        api.scene.remove(fig.group);
        fig.dispose();
        api.figures.delete(id);
      }
    }
    api.paletteKey = paletteKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey, paletteKey]);

  // frame the body on first load and whenever its size changes
  const bodyKey = `${timeline.soldiers.length}|${plan.settings.squareWidth}|${plan.settings.squareDepth}|${plan.settings.strength}`;
  useEffect(() => {
    const id = setTimeout(() => apiRef.current?.frame('front'), 40);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    api.figures.forEach((fig) => fig.setMode(bodyMode));
    if (bodyMode === 'uniform') setAnatomy(null);
  }, [bodyMode]);

  return (
    <div className="stage3d">
      <div ref={mountRef} className="stage3d-canvas" />
      {bodyMode !== 'uniform' && anatomy && (
        <div className="anatomy-hud">
          <div className="anatomy-head">
            <span>Anatomy</span>
            <b>{anatomy.name.replace(' · marker', '')}</b>
          </div>
          <ul>
            {anatomy.angles.slice(0, 12).map((a, i) => {
              const span = a.max - a.min;
              const pct = Math.max(0, Math.min(100, ((a.value - a.min) / span) * 100));
              return (
                <li key={`${a.joint}-${a.side ?? 'c'}-${i}`}>
                  <span className="joint-name">
                    {a.label.replace('flexion', '').replace('plantarflexion', 'plantar')}
                    {a.side ? ` ${a.side}` : ''}
                  </span>
                  <span className="rom">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  <span className="joint-val">{a.value}°</span>
                </li>
              );
            })}
          </ul>
          {bodyMode === 'muscles' && anatomy.muscles.length > 0 && (
            <div className="anatomy-muscles">
              <div className="anatomy-sub">Driving this phase</div>
              {anatomy.muscles.map((m) => (
                <div className="muscle-row" key={m.name}>
                  <span>{m.name}</span>
                  <span className="muscle-bar">
                    <i style={{ width: `${Math.round(m.activation * 100)}%` }} />
                  </span>
                  <em>{Math.round(m.activation * 100)}%</em>
                </div>
              ))}
            </div>
          )}
          <p className="anatomy-note">{GAIT_ANATOMY[anatomy.gait as keyof typeof GAIT_ANATOMY]?.note}</p>
        </div>
      )}
      <div className="stage3d-tools">
        <div className="seg">
          <button onClick={() => apiRef.current?.frame('front')}>Front</button>
          <button onClick={() => apiRef.current?.frame('flank')}>Flank</button>
          <button onClick={() => apiRef.current?.frame('overhead')}>Overhead</button>
          <button onClick={() => apiRef.current?.frame('follow')}>Follow</button>
        </div>
        <span className="stage3d-hint">drag to orbit · scroll to zoom</span>
      </div>
    </div>
  );
}

function buildSquare(width: number, depth: number): THREE.Group {
  const group = new THREE.Group();
  const canvas = document.createElement('canvas');
  const px = 18;
  canvas.width = Math.round(width * px);
  canvas.height = Math.round(depth * px);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a4f57';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // asphalt grain
  for (let i = 0; i < 2600; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const a = 0.03 + Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    ctx.fillRect(x, y, 2, 2);
  }
  // one metre grid
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  for (let m = 1; m < width; m += 1) {
    ctx.beginPath();
    ctx.moveTo(m * px, 0);
    ctx.lineTo(m * px, canvas.height);
    ctx.stroke();
  }
  for (let m = 1; m < depth; m += 1) {
    ctx.beginPath();
    ctx.moveTo(0, m * px);
    ctx.lineTo(canvas.width, m * px);
    ctx.stroke();
  }
  // painted boundary
  ctx.strokeStyle = 'rgba(240,240,232,0.8)';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
  // centre cross and marks
  ctx.strokeStyle = 'rgba(240,240,232,0.5)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2 - 18, canvas.height / 2);
  ctx.lineTo(canvas.width / 2 + 18, canvas.height / 2);
  ctx.moveTo(canvas.width / 2, canvas.height / 2 - 18);
  ctx.lineTo(canvas.width / 2, canvas.height / 2 + 18);
  ctx.stroke();
  // distance ticks every five metres
  ctx.fillStyle = 'rgba(240,240,232,0.55)';
  ctx.font = `${Math.round(px * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
  for (let m = 5; m < width; m += 5) {
    ctx.fillRect(m * px - 1, 10, 2, 14);
    ctx.fillRect(m * px - 1, canvas.height - 24, 2, 14);
    ctx.fillText(`${m}`, m * px + 5, 34);
  }
  for (let m = 5; m < depth; m += 5) {
    ctx.fillRect(10, m * px - 1, 14, 2);
    ctx.fillRect(canvas.width - 24, m * px - 1, 14, 2);
    ctx.fillText(`${m}`, 32, m * px - 5);
  }
  ctx.fillStyle = 'rgba(240,240,232,0.4)';
  ctx.font = `${Math.round(px * 0.34)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(
    `CJCR PARADE SQUARE  ${width.toFixed(1)} × ${depth.toFixed(1)} m`,
    canvas.width / 2 - px * 2.9,
    canvas.height - px * 1.6,
  );
  ctx.fillStyle = 'rgba(240,240,232,0.32)';
  ctx.fillText('FRONT', canvas.width / 2 - px * 1.5, 56);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0.02 }),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.receiveShadow = true;
  group.add(surface);

  const kerb = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.35, 0.09, depth + 0.35),
    new THREE.MeshStandardMaterial({ color: '#7d7f78', roughness: 1 }),
  );
  kerb.position.y = -0.055;
  kerb.receiveShadow = true;
  group.add(kerb);

  return group;
}
