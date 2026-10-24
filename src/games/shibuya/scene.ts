import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createCity, LAMP_COLORS, type LampSet } from './city';
import {
  CAR_RULES,
  type CarKind,
  type CarLight,
  carLight,
  carPose,
  countCars,
  createModel,
  LAYOUT,
  majorPhase,
  PED_CAPACITY,
  PED_RULES,
  type PedLight,
  pedLight,
  setCrossers,
  stepModel,
  TRAIN,
  trainPose
} from './model';

export type SimSnapshot = {
  phase: 1 | 2 | 3;
  carA: CarLight;
  carB: CarLight;
  ped: PedLight;
  cars: number;
  waiting: number;
  view: number;
};
export type SimController = {
  setView: (index: number) => void;
  // 1 回のスクランブルで渡る人数の目安を変える
  setCrossers: (crossers: number) => void;
  destroy: () => void;
};

type View = { label: string; position: [number, number, number]; target: [number, number, number] };

// 定点カメラ。最初の 1 つが初期視点（1.jpg 風の斜め俯瞰）。
export const VIEWS: View[] = [
  { label: '斜め俯瞰', position: [42, 60, 66], target: [-8, 2, -16] },
  { label: 'QFRONT 2F', position: [-11, 10, -27.5], target: [14, 0, 14] },
  { label: '歩行者目線', position: [10, 1.7, 13.5], target: [-19.6, 4.2, 9.2] },
  { label: '高架ホーム', position: [60.5, 10.6, 20], target: [-4, 1, -4] },
  { label: 'ワイド', position: [70, 170, 160], target: [0, 0, -10] }
];

const MAX_FRAME = 0.1;
const VIEW_DURATION = 1.4;
const CONTROLS = {
  minDistance: 6,
  maxDistance: 260,
  minPolarAngle: 0.15,
  maxPolarAngle: 1.55,
  // この距離より離れると、離れた分に比例してカメラの最低の高さが上がる
  lowViewDistance: 40,
  lowViewSlope: 0.55
};

const COLORS = {
  skyTop: '#3d7fd6',
  skyHorizon: '#d4e6f4',
  fog: 0xd4e6f4,
  wheel: 0x1c1c1f,
  glass: 0x1f2a36,
  light: 0xfff4d6,
  taxiLamp: 0xffe58a,
  busWindow: 0x22303d,
  skin: ['#f1c9a5', '#e6b48f', '#d9a27c', '#f5d3b5'],
  hair: ['#1d1a18', '#2b221c', '#3d2a1e', '#5a3b26', '#141414', '#7a5a3a'],
  shirt: [
    '#1f1f24',
    '#f2f2f0',
    '#2e3a55',
    '#8b8f96',
    '#c9b79c',
    '#3b4a3b',
    '#5a3e36',
    '#d9d3c7',
    '#a33b3b',
    '#2f6fa8',
    '#e0c14a',
    '#d887a3'
  ],
  pants: ['#1b1d22', '#2b3445', '#4b4f57', '#c8c1b2', '#3a3029', '#20262f']
};

const CAR_COLORS: Record<CarKind, { body: string[]; accent: string[] }> = {
  sedan: {
    body: [
      '#f4f4f2',
      '#1c1f24',
      '#9aa3ad',
      '#c8ccd0',
      '#2c3e66',
      '#7a1e24',
      '#e9e3d4',
      '#3d4b3a',
      '#f4f4f2',
      '#1c1f24'
    ],
    accent: ['#1c1f24']
  },
  taxi: { body: ['#1d2a4a', '#1d2a4a', '#f2c300', '#2e7d4f', '#e06c1c', '#ececea'], accent: ['#1c1f24'] },
  bus: { body: ['#f3f3ef', '#eef0ec'], accent: ['#c8202f', '#2f9e5b', '#c8202f'] }
};

type PartColor = 'body' | 'accent' | number;
type Part = {
  shape: 'box' | 'wheel';
  size: [number, number, number];
  offset: [number, number, number];
  color: PartColor;
};

const wheels = (x: number, z: number, d: number): Part[] =>
  [
    [x, z],
    [x, -z],
    [-x, z],
    [-x, -z]
  ].map(([px, pz]) => ({ shape: 'wheel', size: [d, d, 0.26], offset: [px, d / 2, pz], color: COLORS.wheel }));

// 車は +x 向きを前としてパーツを並べる
const CAR_PARTS: Record<CarKind, Part[]> = {
  sedan: [
    { shape: 'box', size: [4.4, 0.62, 1.74], offset: [0, 0.6, 0], color: 'body' },
    { shape: 'box', size: [2.3, 0.52, 1.58], offset: [-0.25, 1.17, 0], color: COLORS.glass },
    { shape: 'box', size: [2.05, 0.08, 1.6], offset: [-0.3, 1.46, 0], color: 'body' },
    { shape: 'box', size: [0.06, 0.16, 1.5], offset: [2.2, 0.74, 0], color: COLORS.light },
    ...wheels(1.38, 0.78, 0.64)
  ],
  taxi: [
    { shape: 'box', size: [4.6, 0.64, 1.74], offset: [0, 0.62, 0], color: 'body' },
    { shape: 'box', size: [2.4, 0.56, 1.58], offset: [-0.15, 1.22, 0], color: COLORS.glass },
    { shape: 'box', size: [2.15, 0.08, 1.6], offset: [-0.2, 1.53, 0], color: 'body' },
    { shape: 'box', size: [0.3, 0.2, 0.55], offset: [0.1, 1.67, 0], color: COLORS.taxiLamp },
    { shape: 'box', size: [0.06, 0.16, 1.5], offset: [2.3, 0.76, 0], color: COLORS.light },
    ...wheels(1.45, 0.78, 0.64)
  ],
  bus: [
    { shape: 'box', size: [10.5, 2.6, 2.48], offset: [0, 1.75, 0], color: 'body' },
    { shape: 'box', size: [9.6, 0.95, 2.52], offset: [-0.2, 2.2, 0], color: COLORS.busWindow },
    { shape: 'box', size: [0.08, 1.3, 2.2], offset: [5.25, 2.15, 0], color: COLORS.busWindow },
    { shape: 'box', size: [10.52, 0.22, 2.52], offset: [0, 1.1, 0], color: 'accent' },
    { shape: 'box', size: [8.5, 0.3, 2.1], offset: [-0.5, 3.2, 0], color: 0xd9dcdf },
    ...wheels(3.6, 1.08, 0.95)
  ]
};

type PedPart = { shape: 'box' | 'ball'; size: [number, number, number]; offset: [number, number, number] };
type PedPartKey = 'pants' | 'shirt' | 'skin' | 'hair';
const PED_PARTS: Record<PedPartKey, PedPart> = {
  pants: { shape: 'box', size: [0.34, 0.82, 0.22], offset: [0, 0.41, 0] },
  shirt: { shape: 'box', size: [0.44, 0.62, 0.27], offset: [0, 1.12, 0] },
  skin: { shape: 'ball', size: [0.24, 0.27, 0.25], offset: [0, 1.57, 0] },
  hair: { shape: 'ball', size: [0.26, 0.17, 0.27], offset: [0, 1.65, -0.015] }
};
const PED_SCALE = 1.08;

const drawCanvas = (width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const skyTexture = () =>
  drawCanvas(4, 256, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, COLORS.skyTop);
    gradient.addColorStop(0.75, COLORS.skyHorizon);
    gradient.addColorStop(1, COLORS.skyHorizon);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
  });

// 山手線風の車両側面（銀色の車体に緑の帯と窓・ドア）
const trainSideTexture = () =>
  drawCanvas(512, 96, (ctx) => {
    ctx.fillStyle = '#d3d7da';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#9aa0a5';
    ctx.fillRect(0, 86, 512, 10);
    ctx.fillStyle = '#2d3a44';
    for (let i = 0; i < 4; i++) {
      const doorX = 40 + i * 120;
      ctx.fillStyle = '#5bb04a';
      ctx.fillRect(doorX - 4, 10, 40, 80);
      ctx.fillStyle = '#2d3a44';
      ctx.fillRect(doorX + 4, 18, 24, 34);
      ctx.fillRect(doorX + 4, 56, 24, 28);
      if (i < 3) {
        ctx.fillRect(doorX + 46, 18, 70, 32);
      }
    }
    ctx.fillStyle = '#5bb04a';
    ctx.fillRect(0, 2, 512, 5);
  });

const trainEndTexture = () =>
  drawCanvas(128, 160, (ctx) => {
    ctx.fillStyle = '#d3d7da';
    ctx.fillRect(0, 0, 128, 160);
    ctx.fillStyle = '#1e2a33';
    ctx.fillRect(12, 20, 104, 64);
    ctx.fillStyle = '#5bb04a';
    ctx.fillRect(0, 96, 128, 18);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(14, 120, 18, 10);
    ctx.fillRect(96, 120, 18, 10);
  });

const lightUp = (set: LampSet, light: CarLight) => {
  set.green.color.copy(light === 'green' ? LAMP_COLORS.green : LAMP_COLORS.off);
  set.yellow.color.copy(light === 'yellow' ? LAMP_COLORS.yellow : LAMP_COLORS.off);
  set.red.color.copy(light === 'red' ? LAMP_COLORS.red : LAMP_COLORS.off);
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export const createShibuyaSim = (parent: HTMLElement, onChange: (snapshot: SimSnapshot) => void): SimController => {
  const model = createModel({ warmUp: 30, crossers: PED_RULES.crossersInitial });
  const disposables: { dispose: () => void }[] = [];

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const sky = skyTexture();
  disposables.push(sky);
  scene.background = sky;
  scene.fog = new THREE.Fog(COLORS.fog, 180, 540);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 1500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = CONTROLS.minDistance;
  controls.maxDistance = CONTROLS.maxDistance;
  controls.minPolarAngle = CONTROLS.minPolarAngle;
  controls.maxPolarAngle = CONTROLS.maxPolarAngle;
  controls.zoomSpeed = 0.8;
  controls.rotateSpeed = 0.6;
  const first = VIEWS[0];
  camera.position.set(...first.position);
  controls.target.set(...first.target);
  controls.update();

  scene.add(new THREE.HemisphereLight('#dcebff', '#a49684', 1.5));
  const sun = new THREE.DirectionalLight('#fff3e0', 2.6);
  sun.position.set(70, 160, 110);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.4;
  scene.add(sun);
  scene.add(sun.target);

  const city = createCity();
  scene.add(city.group);

  // ---------------- 車（車種・パーツごとの InstancedMesh）
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const wheelGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  wheelGeometry.rotateX(Math.PI / 2);
  const ballGeometry = new THREE.SphereGeometry(0.5, 10, 8);
  disposables.push(boxGeometry, wheelGeometry, ballGeometry);

  const partMatrix = (offset: [number, number, number], size: [number, number, number]) =>
    new THREE.Matrix4().compose(new THREE.Vector3(...offset), new THREE.Quaternion(), new THREE.Vector3(...size));

  type CarMesh = { mesh: THREE.InstancedMesh; local: THREE.Matrix4; color: PartColor };
  const buildCarMeshes = (kind: CarKind): CarMesh[] =>
    CAR_PARTS[kind].map((part) => {
      const material = new THREE.MeshStandardMaterial({
        color: typeof part.color === 'number' ? part.color : 0xffffff,
        roughness: part.color === COLORS.glass || part.color === COLORS.busWindow ? 0.25 : 0.5,
        metalness: 0.1
      });
      const mesh = new THREE.InstancedMesh(
        part.shape === 'wheel' ? wheelGeometry : boxGeometry,
        material,
        CAR_RULES.maxCars
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      disposables.push(material, mesh);
      return { mesh, local: partMatrix(part.offset, part.size), color: part.color };
    });
  const carKinds: CarKind[] = ['sedan', 'taxi', 'bus'];
  const carMeshes: Record<CarKind, CarMesh[]> = {
    sedan: buildCarMeshes('sedan'),
    taxi: buildCarMeshes('taxi'),
    bus: buildCarMeshes('bus')
  };

  const base = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();

  const syncCars = () => {
    const counts: Record<CarKind, number> = { sedan: 0, taxi: 0, bus: 0 };
    for (const lane of model.lanes) {
      for (const car of lane.cars) {
        const p = carPose(lane, car);
        quaternion.setFromAxisAngle(up, p.yaw);
        base.compose(position.set(p.x, 0, p.z), quaternion, scale.set(1, 1, 1));
        const index = counts[car.kind]++;
        const palette = CAR_COLORS[car.kind];
        for (const part of carMeshes[car.kind]) {
          instance.multiplyMatrices(base, part.local);
          part.mesh.setMatrixAt(index, instance);
          if (part.color === 'body')
            part.mesh.setColorAt(index, tint.set(palette.body[car.look % palette.body.length]));
          if (part.color === 'accent') {
            part.mesh.setColorAt(index, tint.set(palette.accent[car.look % palette.accent.length]));
          }
        }
      }
    }
    for (const kind of carKinds) {
      for (const part of carMeshes[kind]) {
        part.mesh.count = counts[kind];
        part.mesh.instanceMatrix.needsUpdate = true;
        if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
      }
    }
  };

  // ---------------- 歩行者（体のパーツごとの InstancedMesh）
  type PedMesh = { mesh: THREE.InstancedMesh; local: THREE.Matrix4; palette: string[] };
  const pedKeys: PedPartKey[] = ['pants', 'shirt', 'skin', 'hair'];
  const pedMeshes: PedMesh[] = pedKeys.map((key) => {
    const part = PED_PARTS[key];
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(part.shape === 'ball' ? ballGeometry : boxGeometry, material, PED_CAPACITY);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    disposables.push(material, mesh);
    return { mesh, local: partMatrix(part.offset, part.size), palette: COLORS[key] };
  });

  // 見た目（服の色など）は人ごとの look から決める。入れ替わったときだけ色を塗り直す。
  const pedLooks = new Array<number>(PED_CAPACITY).fill(-1);
  const syncPeds = () => {
    model.peds.forEach((ped, i) => {
      quaternion.setFromAxisAngle(up, ped.heading);
      const s = ped.height * PED_SCALE;
      base.compose(position.set(ped.x, 0, ped.z), quaternion, scale.set(s, s, s));
      const recolor = pedLooks[i] !== ped.look;
      pedLooks[i] = ped.look;
      pedMeshes.forEach((part, k) => {
        instance.multiplyMatrices(base, part.local);
        part.mesh.setMatrixAt(i, instance);
        if (!recolor) return;
        const pick = Math.floor(ped.look / (k * 7 + 1)) % part.palette.length;
        part.mesh.setColorAt(i, tint.set(part.palette[pick]));
      });
    });
    for (const part of pedMeshes) {
      // 人数を減らしたときに、使わなくなった分を描かないようにする
      part.mesh.count = model.peds.length;
      part.mesh.instanceMatrix.needsUpdate = true;
      if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    }
  };

  // ---------------- 高架を走る電車
  const sideTexture = trainSideTexture();
  const endTexture = trainEndTexture();
  const sideMaterial = new THREE.MeshStandardMaterial({ map: sideTexture, roughness: 0.4, metalness: 0.2 });
  const endMaterial = new THREE.MeshStandardMaterial({ map: endTexture, roughness: 0.4 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: '#9ea5ab', roughness: 0.6 });
  const bogieMaterial = new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.8 });
  const carGeometry = new THREE.BoxGeometry(2.9, 3.4, TRAIN.carLength);
  const bogieGeometry = new THREE.BoxGeometry(2.4, 0.7, TRAIN.carLength - 3);
  disposables.push(sideTexture, endTexture, sideMaterial, endMaterial, roofMaterial, bogieMaterial, carGeometry);
  disposables.push(bogieGeometry);
  // 線路がカーブしているので、1 両ずつ線路の上に置く
  const trainCars = model.trains.map(() =>
    Array.from({ length: TRAIN.cars }, (_, i) => {
      const offset = ((TRAIN.cars - 1) / 2 - i) * (TRAIN.carLength + TRAIN.carGap);
      const car = new THREE.Group();
      const body = new THREE.Mesh(carGeometry, [
        sideMaterial,
        sideMaterial,
        roofMaterial,
        bogieMaterial,
        endMaterial,
        endMaterial
      ]);
      body.position.y = LAYOUT.railY + 0.7 + 1.7;
      body.castShadow = true;
      const bogie = new THREE.Mesh(bogieGeometry, bogieMaterial);
      bogie.position.y = LAYOUT.railY + 0.35;
      car.add(body, bogie);
      scene.add(car);
      return { car, offset };
    })
  );
  const syncTrains = () => {
    model.trains.forEach((train, i) => {
      for (const { car, offset } of trainCars[i]) {
        car.visible = train.state !== 'away';
        if (!car.visible) continue;
        const p = trainPose(train, offset);
        car.position.set(p.x, 0, p.z);
        car.rotation.y = Math.atan2(p.dx, p.dz);
      }
    });
  };

  // ---------------- 信号と大型ビジョン
  const syncSignals = (time: number) => {
    lightUp(city.lamps.A, carLight(model.signal, 'A'));
    lightUp(city.lamps.B, carLight(model.signal, 'B'));
    const ped = pedLight(model.signal);
    const blinkOn = ped === 'green' || (ped === 'flash' && Math.floor(time * 2) % 2 === 0);
    city.lamps.pedGreen.color.copy(blinkOn ? LAMP_COLORS.green : LAMP_COLORS.off);
    city.lamps.pedRed.color.copy(ped === 'red' ? LAMP_COLORS.red : LAMP_COLORS.off);
    for (const material of city.screens) material.uniforms.uTime.value = time;
  };

  // ---------------- 定点カメラの切り替え
  const transition = {
    active: false,
    t: 0,
    fromPosition: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toPosition: new THREE.Vector3(),
    toTarget: new THREE.Vector3()
  };
  let view = 0;
  const setView = (index: number) => {
    const next = VIEWS[index];
    if (!next) return;
    view = index;
    transition.active = true;
    transition.t = 0;
    transition.fromPosition.copy(camera.position);
    transition.fromTarget.copy(controls.target);
    transition.toPosition.set(...next.position);
    transition.toTarget.set(...next.target);
  };
  // ドラッグやホイールで操作したら切り替えのアニメーションをやめる
  const onControlStart = () => {
    transition.active = false;
  };
  controls.addEventListener('start', onControlStart);

  const updateCamera = (dt: number) => {
    if (transition.active) {
      transition.t = Math.min(1, transition.t + dt / VIEW_DURATION);
      const k = easeInOut(transition.t);
      camera.position.lerpVectors(transition.fromPosition, transition.toPosition, k);
      controls.target.lerpVectors(transition.fromTarget, transition.toTarget, k);
      if (transition.t >= 1) transition.active = false;
    }
    // 遠くから地面すれすれに見ると建物の壁しか見えないので、離れるほど低い角度に下げられないようにする
    const distance = camera.position.distanceTo(controls.target);
    const minHeight = Math.max(0, (distance - CONTROLS.lowViewDistance) * CONTROLS.lowViewSlope);
    controls.maxPolarAngle = Math.min(CONTROLS.maxPolarAngle, Math.acos(Math.min(1, minHeight / distance)));
    controls.update(dt);
  };

  // ---------------- 画面表示用の状態
  let last: SimSnapshot | null = null;
  let carCount = countCars(model);
  let countTimer = 0;
  const emit = (dt: number) => {
    countTimer -= dt;
    if (countTimer <= 0) {
      countTimer = 0.5;
      carCount = countCars(model);
    }
    const next: SimSnapshot = {
      phase: majorPhase(model.signal),
      carA: carLight(model.signal, 'A'),
      carB: carLight(model.signal, 'B'),
      ped: pedLight(model.signal),
      cars: carCount,
      waiting: model.peds.reduce((sum, ped) => sum + (ped.state === 'wait' ? 1 : 0), 0),
      view
    };
    if (
      last &&
      last.phase === next.phase &&
      last.carA === next.carA &&
      last.carB === next.carB &&
      last.ped === next.ped &&
      last.cars === next.cars &&
      last.view === next.view &&
      Math.abs(last.waiting - next.waiting) < 5
    ) {
      return;
    }
    last = next;
    onChange(next);
  };

  const resize = () => {
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(parent);
  resize();

  const onKeyDown = (event: KeyboardEvent) => {
    const index = Number(event.key) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= VIEWS.length) return;
    setView(index);
  };
  window.addEventListener('keydown', onKeyDown);

  let frame = 0;
  let previous = performance.now();
  let time = 0;
  const loop = (now: number) => {
    const dt = Math.min((now - previous) / 1000, MAX_FRAME);
    previous = now;
    time += dt;
    stepModel(model, dt);
    syncCars();
    syncPeds();
    syncTrains();
    syncSignals(time);
    updateCamera(dt);
    renderer.render(scene, camera);
    emit(dt);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  return {
    setView,
    setCrossers: (crossers: number) => setCrossers(model, crossers),
    destroy: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      controls.removeEventListener('start', onControlStart);
      controls.dispose();
      city.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
};
