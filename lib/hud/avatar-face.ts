'use client';

import * as THREE from 'three';

/**
 * Procedural holographic face rig.
 *
 * The head is sculpted from a sphere by gaussian displacement (brow ridge,
 * eye sockets, nose, cheekbones, lips, chin), then articulated with real
 * eye mechanics rather than looping tweens:
 *
 *  · saccades      — eyes jump to a target in ~90ms with a small overshoot
 *                    and a variable dwell time, like a real visual system
 *  · blinks        — fast close (70ms), short hold, slower open (150ms),
 *                    occasionally doubled, and coupled to saccades
 *  · vestibulo-ocular — eyes lead the head when the gaze direction changes
 *  · pupil         — dilates with cognitive load (thinking) and speech
 *  · breathing     — 0.22Hz chest + head bob, shoulders, micro sway
 *  · expression    — brow raise/furrow, squint, jaw + lip shaping driven by
 *                    the live microphone envelope (or a synthetic envelope
 *                    while the assistant is synthesising speech)
 */

export type AvatarMode = 'idle' | 'listening' | 'thinking' | 'speaking';

const INK = new THREE.Color('#8ff6ff');
const LIME = new THREE.Color('#b6ff3b');

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  step(dt: number, stiffness = 120, damping = 18) {
    const force = (this.target - this.value) * stiffness - this.velocity * damping;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** Layered sine "noise" — cheap, smooth, and never repeats visibly. */
function wobble(t: number, seed: number) {
  return (
    Math.sin(t * 0.71 + seed) * 0.55 +
    Math.sin(t * 1.63 + seed * 2.3) * 0.3 +
    Math.sin(t * 3.11 + seed * 4.7) * 0.15
  );
}

/* ------------------------------------------------------------------ */
/*  geometry                                                           */
/* ------------------------------------------------------------------ */

type Bump = {
  at: [number, number, number];
  radius: number;
  amount: number;
  dir: [number, number, number];
};

function sculptHead(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const bumpPoint = new THREE.Vector3();
  const bumpDir = new THREE.Vector3();

  const bumps: Bump[] = [
    // brow ridge
    { at: [0.19, 0.3, 0.7], radius: 0.26, amount: 0.055, dir: [0, 0.25, 1] },
    { at: [-0.19, 0.3, 0.7], radius: 0.26, amount: 0.055, dir: [0, 0.25, 1] },
    // eye sockets (pushed back)
    { at: [0.19, 0.17, 0.78], radius: 0.17, amount: -0.075, dir: [0, 0, 1] },
    { at: [-0.19, 0.17, 0.78], radius: 0.17, amount: -0.075, dir: [0, 0, 1] },
    // nose bridge + tip
    { at: [0, 0.22, 0.85], radius: 0.1, amount: 0.05, dir: [0, 0, 1] },
    { at: [0, 0.02, 0.9], radius: 0.09, amount: 0.115, dir: [0, -0.1, 1] },
    { at: [0, -0.07, 0.86], radius: 0.075, amount: 0.06, dir: [0, 0, 1] },
    // cheekbones
    { at: [0.34, 0.06, 0.6], radius: 0.24, amount: 0.05, dir: [0.3, 0, 1] },
    { at: [-0.34, 0.06, 0.6], radius: 0.24, amount: 0.05, dir: [-0.3, 0, 1] },
    // philtrum + lips
    { at: [0, -0.19, 0.82], radius: 0.15, amount: 0.045, dir: [0, 0, 1] },
    // chin + jaw corners (a bare ellipsoid reads as an egg, not a face)
    { at: [0, -0.44, 0.62], radius: 0.2, amount: 0.06, dir: [0, 0.2, 1] },
    { at: [0.3, -0.34, 0.42], radius: 0.24, amount: 0.075, dir: [0.75, -0.15, 0.6] },
    { at: [-0.3, -0.34, 0.42], radius: 0.24, amount: 0.075, dir: [-0.75, -0.15, 0.6] },
    // temples (pulled in)
    { at: [0.55, 0.32, 0.35], radius: 0.24, amount: -0.035, dir: [1, 0, 0] },
    { at: [-0.55, 0.32, 0.35], radius: 0.24, amount: -0.035, dir: [-1, 0, 0] },
  ];

  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    normal.copy(vertex).normalize();

    // ellipsoid base: slightly narrower across, taller than deep
    vertex.x *= 0.8;
    vertex.y *= 0.9;
    vertex.z *= 0.84;

    // jaw taper below the cheek line
    const below = Math.max(0, -vertex.y);
    const taper = 1 - 0.22 * Math.pow(Math.min(1, below / 0.9), 1.8);
    vertex.x *= taper;
    vertex.z *= 1 - 0.1 * Math.pow(Math.min(1, below / 0.9), 1.7);

    // occiput flattening
    if (vertex.z < -0.35) vertex.z = -0.35 + (vertex.z + 0.35) * 0.72;

    for (const bump of bumps) {
      bumpPoint.set(bump.at[0], bump.at[1], bump.at[2]);
      const distance = vertex.distanceTo(bumpPoint);
      if (distance > bump.radius) continue;
      const falloff = Math.exp(-(distance * distance) / (2 * (bump.radius * 0.42) ** 2));
      bumpDir.set(bump.dir[0], bump.dir[1], bump.dir[2]).normalize();
      vertex.addScaledVector(bumpDir, bump.amount * falloff);
    }

    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function hologramMaterial(uniforms: {
  uTime: { value: number };
  uGlow: { value: number };
  uOpacity: { value: number };
}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uGlow: uniforms.uGlow,
      uOpacity: uniforms.uOpacity,
      uInk: { value: INK.clone() },
      uLime: { value: LIME.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDir = normalize(cameraPosition - world.xyz);
        vLocal = position;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGlow;
      uniform float uOpacity;
      uniform vec3 uInk;
      uniform vec3 uLime;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;

      void main() {
        float fresnel = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDir)), 0.0, 1.0), 2.1);
        float sweep = smoothstep(0.0, 0.16, abs(fract(vLocal.y * 0.75 - uTime * 0.09) - 0.5) - 0.28);
        float scan = 0.5 + 0.5 * sin(vLocal.y * 320.0 - uTime * 3.0);
        float grid = smoothstep(0.86, 1.0, max(abs(fract(vLocal.x * 42.0) - 0.5), abs(fract(vLocal.y * 42.0) - 0.5)));

        vec3 base = mix(vec3(0.012, 0.07, 0.095), uInk * 0.65, fresnel);
        base += uInk * scan * 0.05;
        base += uLime * uGlow * fresnel * 0.5;
        base += uInk * grid * 0.06;
        base *= 0.85 + sweep * 0.5;

        float alpha = (0.14 + fresnel * 0.85 + scan * 0.05 + sweep * 0.06) * uOpacity;
        gl_FragColor = vec4(base, clamp(alpha, 0.0, 1.0));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/* ------------------------------------------------------------------ */
/*  rig                                                                */
/* ------------------------------------------------------------------ */

export interface AvatarRigOptions {
  canvas: HTMLCanvasElement;
  onReady?: () => void;
  /** called if the render loop throws, so the host can swap in a still */
  onError?: (error: unknown) => void;
}

export function createAvatarRig({ canvas, onReady, onError }: AvatarRigOptions) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  // 2x DPR with MSAA on a live canvas is the most expensive thing on the page.
  // 1.5 still looks sharp on a hologram that is deliberately soft-edged.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
  camera.position.set(0, 0.02, 3.1);

  const uniforms = {
    uTime: { value: 0 },
    uGlow: { value: 0 },
    uOpacity: { value: 1 },
  };

  /* ---------------- head ---------------- */
  const headPivot = new THREE.Group();
  scene.add(headPivot);

  // 64x64 (≈8k quads) reads identical at this projection scale and cuts the
  // vertex bill by more than half versus 96x96.
  const headGeometry = new THREE.SphereGeometry(1, 64, 64);
  sculptHead(headGeometry);

  const headMaterial = hologramMaterial(uniforms);
  const head = new THREE.Mesh(headGeometry, headMaterial);
  // Slightly narrower than tall — a uniform sphere reads as a mannequin. This
  // is set before the surface probe below, so eyes/brows/mouth are raycast onto
  // the *scaled* face and stay seated on it.
  head.scale.set(0.465, 0.475, 0.475);
  headPivot.add(head);

  const wireframe = new THREE.Mesh(
    headGeometry,
    new THREE.MeshBasicMaterial({
      color: INK,
      wireframe: true,
      transparent: true,
      opacity: 0.045,
      depthWrite: false,
    }),
  );
  wireframe.scale.set(0.465 * 1.004, 0.475 * 1.004, 0.475 * 1.004);
  headPivot.add(wireframe);

  /* ---------------- face surface probe ----------------
   * The skull is sculpted procedurally, so facial features are placed by
   * raycasting onto the finished surface instead of hard-coded depths —
   * eyes, brows and mouth always sit exactly on the face. */
  headPivot.updateMatrixWorld(true);
  const probeRay = new THREE.Raycaster();
  const probeFrom = new THREE.Vector3();
  const probeDir = new THREE.Vector3(0, 0, -1);

  const faceSurfaceZ = (x: number, y: number, fallback: number) => {
    probeFrom.set(x, y, 2);
    probeRay.set(probeFrom, probeDir);
    const hit = probeRay.intersectObject(head, false)[0];
    return hit ? hit.point.z : fallback;
  };

  /* ---------------- eyes ---------------- */
  type Eye = {
    root: THREE.Group;
    iris: THREE.Group;
    lid: THREE.Mesh;
    lidLower: THREE.Mesh;
    glare: THREE.Mesh;
    pupil: THREE.Mesh;
  };

  const eyeWhite = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#d6feff'),
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  const irisMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#5ff4e0'),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const pupilMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#04161b'),
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const glareMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#eaffff'),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const lidMaterial = hologramMaterial(uniforms);
  const lashMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#0b3b46'),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  // Proportion pass: the previous 0.062 globe with a 0.028 iris left a wide
  // ring of white around a small disc, which reads as googly rather than human.
  // A smaller globe, squashed vertically into an almond, with a larger iris is
  // what makes the face legible.
  const eyeRadius = 0.052;

  const EYE_X = 0.113;
  const EYE_Y = 0.074;

  const buildEye = (side: -1 | 1): Eye => {
    const root = new THREE.Group();
    // seat the eyeball just under the sculpted socket so the surface frames it
    root.position.set(side * EYE_X, EYE_Y, faceSurfaceZ(side * EYE_X, EYE_Y, 0.345) - 0.05);

    const ball = new THREE.Mesh(new THREE.SphereGeometry(eyeRadius, 32, 32), eyeWhite);
    // squash the globe into an almond opening instead of a full sphere
    ball.scale.set(1, 0.82, 1);
    root.add(ball);

    const iris = new THREE.Group();
    // Sit the iris ON the globe surface, not inside it: at 0.93r the disc was
    // buried under the translucent sclera and read as a tiny pinprick pupil.
    iris.position.z = eyeRadius * 1.02;

    const irisDisc = new THREE.Mesh(new THREE.CircleGeometry(0.031, 32), irisMaterial);
    iris.add(irisDisc);

    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.0135, 24), pupilMaterial);
    pupil.position.z = 0.0015;
    iris.add(pupil);

    const glare = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), glareMaterial);
    glare.position.set(-0.012, 0.012, 0.0035);
    iris.add(glare);

    iris.position.x = side * 0.002;
    root.add(iris);

    // upper lid: hemispherical shell that swings down over the iris.
    // rotation.x = -0.62 sits the rim just above the iris (open); adding
    // +0.95 rad closes it fully.
    const lid = new THREE.Mesh(
      new THREE.SphereGeometry(eyeRadius * 1.07, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.55),
      lidMaterial,
    );
    lid.rotation.x = -0.52;
    root.add(lid);

    // lower lid: the complementary bottom cap, swinging up on a blink
    const lidLower = new THREE.Mesh(
      new THREE.SphereGeometry(eyeRadius * 1.06, 32, 14, 0, Math.PI * 2, Math.PI * 0.66, Math.PI * 0.34),
      lidMaterial,
    );
    lidLower.rotation.x = 0.05;
    root.add(lidLower);

    // lash line reads as a defined upper lid edge
    const lash = new THREE.Mesh(new THREE.TorusGeometry(eyeRadius * 0.93, 0.0032, 6, 24, Math.PI), lashMaterial);
    lash.position.set(0, 0.006, eyeRadius * 0.58);
    root.add(lash);

    headPivot.add(root);
    return { root, iris, lid, lidLower, glare, pupil };
  };

  const eyeLeft = buildEye(-1);
  const eyeRight = buildEye(1);

  /* ---------------- brows ---------------- */
  const browMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#9ff8ff'),
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  const buildBrow = (side: -1 | 1) => {
    const browPoint = (x: number, y: number) =>
      new THREE.Vector3(x, y, faceSurfaceZ(x, y, 0.36) + 0.007);
    const curve = new THREE.CatmullRomCurve3([
      browPoint(side * 0.052, 0.158),
      browPoint(side * 0.112, 0.172),
      browPoint(side * 0.166, 0.158),
    ]);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.011, 6, false), browMaterial);
    headPivot.add(mesh);
    return mesh;
  };

  const browLeft = buildBrow(-1);
  const browRight = buildBrow(1);

  /* ---------------- mouth ---------------- */
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, -0.156, faceSurfaceZ(0, -0.156, 0.355) + 0.012);
  headPivot.add(mouthGroup);

  const cavityMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#01161b'),
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  // Wider and flatter: a round cavity with a taller axis reads as a surprised
  // "o" rather than a resting mouth.
  const cavity = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32), cavityMaterial);
  cavity.scale.set(1.9, 0.62, 1);
  cavity.position.z = -0.004;
  mouthGroup.add(cavity);

  const lipMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#a6f7ff'),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });

  const upperLip = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0085, 8, 28, Math.PI), lipMaterial);
  upperLip.rotation.z = Math.PI;
  upperLip.scale.set(1.85, 0.5, 1);
  upperLip.position.set(0, 0.014, 0.002);
  mouthGroup.add(upperLip);

  const lowerLip = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.0095, 8, 28, Math.PI), lipMaterial);
  lowerLip.rotation.z = 0;
  lowerLip.scale.set(1.8, 0.56, 1);
  lowerLip.position.set(0, -0.008, 0.002);
  mouthGroup.add(lowerLip);

  /* ---------------- neck + shoulders ---------------- */
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = -0.52;
  headPivot.add(bodyGroup);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.16, 0.34, 24, 1, true),
    hologramMaterial(uniforms),
  );
  neck.position.y = -0.02;
  bodyGroup.add(neck);

  const shoulders = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 40, 20, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.32),
    hologramMaterial(uniforms),
  );
  shoulders.position.y = -0.34;
  shoulders.scale.set(1.25, 0.8, 0.72);
  bodyGroup.add(shoulders);

  /* ---------------- scan plane ---------------- */
  const scanPlane = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.62, 64),
    new THREE.MeshBasicMaterial({
      color: LIME,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  scanPlane.rotation.x = Math.PI / 2;
  headPivot.add(scanPlane);

  /* ---------------- state ---------------- */
  const state: {
    mode: AvatarMode;
    audio: number;
    pointerX: number;
    pointerY: number;
    hover: boolean;
  } = { mode: 'idle', audio: 0, pointerX: 0, pointerY: 0, hover: false };

  const headYaw = new Spring();
  const headPitch = new Spring();
  const headRoll = new Spring();
  const eyeYaw = new Spring();
  const eyePitch = new Spring();
  const browRaise = new Spring();
  const browFurrow = new Spring();
  const squint = new Spring();
  const jaw = new Spring();
  const smile = new Spring();

  let blinkTimer = rand(1.5, 3.5);
  let blinkProgress = 0;
  let blinkPhase: 'idle' | 'closing' | 'hold' | 'opening' = 'idle';
  let doubleBlink = false;

  let saccadeTimer = rand(0.4, 1.6);
  let gazeX = 0;
  let gazeY = 0;
  let gazeTargetX = 0;
  let gazeTargetY = 0;

  let pointerIdleFor = 0;
  let lastPointer = { x: 0, y: 0 };
  let elapsed = 0;
  let speechEnvelope = 0;
  let nodTimer = rand(3, 7);
  let nodPhase = 0;

  const onPointerMove = (event: PointerEvent) => {
    lastPointer = {
      x: (event.clientX / window.innerWidth - 0.5) * 2,
      y: (event.clientY / window.innerHeight - 0.5) * 2,
    };
    pointerIdleFor = 0;
    state.pointerX = lastPointer.x;
    state.pointerY = lastPointer.y;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });

  /* ---------------- resize ---------------- */
  let width = 0;
  let height = 0;
  const resize = () => {
    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect || rect.width < 4 || rect.height < 4) return;
    width = rect.width;
    height = rect.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // keep the whole head in frame on tall and square containers
    camera.position.z = 3.1 - Math.min(0.35, Math.max(0, (1 - camera.aspect) * 0.3));
    camera.updateProjectionMatrix();
  };

  const observer = new ResizeObserver(resize);
  if (canvas.parentElement) observer.observe(canvas.parentElement);
  resize();

  /* ---------------- loop ---------------- */
  let raf = 0;
  let last = performance.now();

  const update = (dt: number) => {
    elapsed += dt;
    uniforms.uTime.value = elapsed;
    pointerIdleFor += dt;

    const mode = state.mode;
    const speaking = mode === 'speaking';
    const thinking = mode === 'thinking';
    const listening = mode === 'listening';

    /* -------- gaze target -------- */
    saccadeTimer -= dt;
    let wantX = gazeTargetX;
    let wantY = gazeTargetY;

    if (pointerIdleFor < 4) {
      // follow the operator
      wantX = state.pointerX * 0.85;
      wantY = state.pointerY * 0.6;
    } else if (saccadeTimer <= 0) {
      const wide = Math.random() > 0.78;
      saccadeTimer = wide ? rand(1.6, 3.4) : rand(0.35, 1.4);
      if (thinking) {
        // gaze aversion: up and to the operator's right while reasoning
        wantX = rand(0.25, 0.7);
        wantY = rand(-0.55, -0.2);
      } else if (listening) {
        wantX = rand(-0.25, 0.25);
        wantY = rand(-0.1, 0.18);
      } else if (wide) {
        wantX = rand(-0.7, 0.7);
        wantY = rand(-0.4, 0.4);
      } else {
        wantX = rand(-0.3, 0.3);
        wantY = rand(-0.18, 0.18);
      }
      gazeTargetX = wantX;
      gazeTargetY = wantY;
      // saccades are often followed by a blink
      if (Math.random() > 0.72) blinkTimer = Math.min(blinkTimer, 0.12);
    }

    // eye saccade with slight overshoot, faster than the head
    const saccadeRate = 26 + 22 * Math.min(1, Math.abs(wantX - gazeX) * 4);
    gazeX += (wantX - gazeX) * Math.min(1, saccadeRate * dt);
    gazeY += (wantY - gazeY) * Math.min(1, saccadeRate * dt);

    /* -------- head follow (lags the eyes) -------- */
    const idleWander = pointerIdleFor > 4 ? 1 : 0.35;
    const targetYaw =
      gazeX * 0.3 * idleWander + wobble(elapsed * 0.6, 1.7) * 0.014 * idleWander;
    const targetPitch =
      -gazeY * 0.2 * idleWander + wobble(elapsed * 0.45, 4.1) * 0.012 * idleWander;
    const targetRoll =
      (listening ? 0.05 : thinking ? -0.045 : 0.015) +
      wobble(elapsed * 0.32, 7.3) * 0.02;

    headYaw.target = targetYaw;
    headPitch.target = targetPitch;
    headRoll.target = targetRoll;

    const nodEnvelope =
      mode === 'speaking' || listening ? Math.max(0, Math.sin(elapsed * 1.7)) ** 6 : 0;
    const nod = nodEnvelope * 0.035;

    headPivot.rotation.y = headYaw.step(dt, 42, 12);
    headPivot.rotation.x = headPitch.step(dt, 38, 11) + nod;
    headPivot.rotation.z = headRoll.step(dt, 30, 10);

    // breathing: chest + head bob + shoulder rise
    const breath = Math.sin(elapsed * 1.38);
    headPivot.position.y = 0.045 + breath * 0.008 - (speaking ? 0.004 : 0);
    headPivot.position.z = breath * 0.006;
    bodyGroup.scale.setScalar(1 + breath * 0.012);
    shoulders.position.y = -0.34 + breath * 0.012;

    /* -------- blinks -------- */
    blinkTimer -= dt;
    if (blinkTimer <= 0 && blinkPhase === 'idle') {
      blinkPhase = 'closing';
      doubleBlink = Math.random() > 0.86;
    }

    if (blinkPhase === 'closing') {
      blinkProgress += dt / 0.075;
      if (blinkProgress >= 1) {
        blinkProgress = 1;
        blinkPhase = 'hold';
        blinkTimer = doubleBlink ? 0.06 : 0.035;
      }
    } else if (blinkPhase === 'hold') {
      if (blinkTimer <= 0) {
        blinkPhase = 'opening';
        blinkTimer = 0.15;
      }
    } else if (blinkPhase === 'opening') {
      blinkProgress -= dt / 0.15;
      if (blinkProgress <= 0) {
        blinkProgress = 0;
        blinkPhase = 'idle';
        blinkTimer = doubleBlink ? 0.12 : rand(1.8, 5.4);
        if (doubleBlink) doubleBlink = false;
      }
    }

    // thinking suppresses blinking, listening blinks a little more
    if (blinkPhase === 'idle' && thinking) blinkTimer += dt * 1.4;

    /* -------- expression targets -------- */
    browRaise.target = listening ? 0.85 : thinking ? 0.15 : speaking ? 0.3 + speechEnvelope * 0.25 : 0.2;
    browFurrow.target = thinking ? 0.9 : 0;
    squint.target = thinking ? 0.35 : speaking ? 0.12 : 0.04;
    smile.target = listening ? 0.35 : speaking ? 0.25 : 0.1;

    const raised = browRaise.step(dt, 60, 14);
    const furrow = browFurrow.step(dt, 55, 14);
    const squinted = squint.step(dt, 50, 13);
    const smiled = smile.step(dt, 45, 13);

    browLeft.position.y = raised * 0.012 + furrow * -0.006;
    browRight.position.y = raised * 0.012 - furrow * 0.006;
    browLeft.rotation.z = -0.08 - furrow * 0.16 + raised * 0.04;
    browRight.rotation.z = 0.08 + furrow * 0.16 - raised * 0.04;
    browLeft.position.x = furrow * 0.006;
    browRight.position.x = -furrow * 0.006;

    /* -------- pupils -------- */
    const cognitiveLoad = (thinking ? 0.55 : 0) + speechEnvelope * 0.25 + (state.hover ? 0.1 : 0);
    const pupilScale = 1.0 + cognitiveLoad * 0.42;
    eyeLeft.pupil.scale.setScalar(pupilScale);
    eyeRight.pupil.scale.setScalar(pupilScale);
    irisMaterial.opacity = 0.85 + cognitiveLoad * 0.15;

    /* -------- eyes -------- */
    const blink = blinkProgress;
    const lidOpen = 1 - blink * 0.94 - squinted * 0.1;
    [eyeLeft, eyeRight].forEach((eye, index) => {
      const side = index === 0 ? -1 : 1;
      // iris tracks gaze; eyes lead the head slightly
      eye.iris.position.x = gazeX * 0.026 + headYaw.value * -0.02 + side * 0.002;
      eye.iris.position.y = -gazeY * 0.018 + headPitch.value * 0.02;
      eye.iris.position.z = eyeRadius * 0.93 - Math.abs(gazeX) * 0.004;

      // lid shells swing closed around the eyeball
      const closed = 1 - Math.min(1, Math.max(0, lidOpen));
      eye.lid.rotation.x = -0.62 + closed * 0.95;
      eye.lidLower.rotation.x = 0.05 - closed * 0.6;
    });

    /* -------- mouth / speech -------- */
    if (speaking) {
      // real microphone envelope when audio is flowing, otherwise a shaped
      // envelope that reads as speech while the reply is being synthesised
      const synthetic = Math.max(
        0,
        Math.sin(elapsed * 12.4) * 0.45 + Math.sin(elapsed * 7.1 + 1.3) * 0.35 + 0.3,
      );
      const source = state.audio > 0.012 ? state.audio * 3.4 : synthetic * 0.55;
      speechEnvelope += (Math.min(1, source) - speechEnvelope) * Math.min(1, dt * 18);
    } else if (listening) {
      speechEnvelope += (state.audio * 2.2 - speechEnvelope) * Math.min(1, dt * 12);
    } else {
      speechEnvelope += (0 - speechEnvelope) * Math.min(1, dt * 10);
    }

    jaw.target = speechEnvelope * 0.075;
    const jawOpen = jaw.step(dt, 150, 20);

    mouthGroup.position.y = -0.163 - jawOpen * 0.55;
    cavity.scale.set(1.5 + smiled * 0.25, 0.5 + jawOpen * 12 + smiled * 0.2, 1);
    upperLip.position.y = 0.014 + jawOpen * 0.12;
    upperLip.scale.y = 0.62 + smiled * 0.1;
    lowerLip.position.y = -0.008 - jawOpen * 1.5;
    lowerLip.scale.y = 0.7 + jawOpen * 6;
    upperLip.position.x = 0;
    lowerLip.position.x = 0;
    mouthGroup.rotation.z = smile.value * 0.02;

    /* -------- scan plane + glow -------- */
    const scanY = ((elapsed * 0.22) % 1) * 1.0 - 0.5;
    scanPlane.position.y = scanY;
    const scanFade = 1 - Math.abs(scanY) * 1.2;
    (scanPlane.material as THREE.MeshBasicMaterial).opacity = 0.05 + Math.max(0, scanFade) * 0.2;

    uniforms.uGlow.value =
      (thinking ? 0.9 : speaking ? 0.75 : listening ? 0.55 : 0.25) + speechEnvelope * 0.3;

    // head settles when the pointer leaves
    if (state.hover) state.hover = false;

    renderer.render(scene, camera);
  };

  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // rAF is throttled in background tabs, but a hidden/offscreen host can
    // still be scheduled by some engines — skip the draw entirely.
    if (typeof document !== 'undefined' && document.hidden) {
      raf = requestAnimationFrame(loop);
      return;
    }
    try {
      update(dt);
    } catch (error) {
      cancelAnimationFrame(raf);
      console.error('[hud] avatar render loop halted', error);
      onError?.(error);
      return;
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  onReady?.();

  return {
    setMode(mode: AvatarMode) {
      state.mode = mode;
      uniforms.uGlow.value = mode === 'speaking' ? 0.8 : 0.4;
    },
    setAudio(level: number) {
      state.audio = level;
    },
    setHover(value: boolean) {
      state.hover = value;
    },
    /**
     * Power-aware rendering: drop the drawing buffer resolution before dropping
     * frames. A 1.0x buffer on a 400px hologram still reads as sharp; a janky
     * 60fps one does not.
     */
    setQuality(profile: 'full' | 'balanced' | 'saver') {
      const ratio = profile === 'saver' ? 1 : profile === 'balanced' ? 1.25 : Math.min(window.devicePixelRatio || 1, 1.5);
      const current = renderer.getPixelRatio();
      if (Math.abs(current - ratio) < 0.01) return;
      renderer.setPixelRatio(ratio);
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      renderer.dispose();
      headGeometry.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
          else material.dispose();
        }
      });
    },
  };
}

export type AvatarRigHandle = ReturnType<typeof createAvatarRig>;
