import * as THREE from 'three';
import {
  type BoxPart,
  createModel,
  type GameStatus,
  isGrounded,
  isSliding,
  jump,
  laneX,
  type Model,
  moveLane,
  type Obstacle,
  obstacleBoxes,
  pauseModel,
  RULES,
  resumeModel,
  score,
  slide,
  startModel,
  stepModel,
  TRAIN
} from './model';

export type GameSnapshot = { status: GameStatus; distance: number; score: number; coins: number; speedLevel: number };
export type GameController = { start: () => void; pause: () => void; resume: () => void; destroy: () => void };

// 本家の見た目に合わせ、プレイヤーを画面下寄り・地平線を画面上1/3付近に置く低めの視点。
const CAMERA = {
  fov: 60,
  height: 6,
  back: 11,
  lookAhead: 20,
  lookHeight: 0,
  followX: 9,
  followY: 4,
  jumpFollow: 0.4,
  // 屋根に乗ったとき、足場の高さにどれだけ追従するか
  groundFollow: 0.85,
  // 加速したときに一瞬広げる画角
  speedUpFov: 9
};

const SWIPE_THRESHOLD = 28;
const SLEEPER_SPACING = 1.6;
const WALL_SEGMENT = 48;
const SCENERY_PERIOD = 64;
const LAMP_SPACING = 16;
const VIEW_BEHIND = 12;
const MAX_COINS = 400;
const COLORS = {
  skyTop: '#2c79dc',
  skyHorizon: '#cfe8fb',
  fog: 0xcfe3f5,
  ground: 0x6f3b30,
  sleeper: 0x3a2320,
  plate: 0x9aa2b8,
  rail: 0xd3d8e0,
  sidewalk: 0xdccdb4,
  grass: 0x79c25a,
  lamp: 0x4c4f5c,
  lampLight: 0xfff1b8,
  trunk: 0x7a5236,
  leaves: 0x4caf50,
  trainBody: '#8e8499',
  trainBand: '#7b2c48',
  trainRoof: 0xa79db0,
  bogie: 0x2c2a33,
  post: 0x5a5f69,
  coin: 0xffc21a,
  skin: 0xf3c79e,
  hoodie: 0xf4f4f4,
  vest: 0x3f74c4,
  jeans: 0x34496e,
  cap: 0xe03131,
  hair: 0x4a2c1d,
  shoe: 0xff8a1f,
  shadow: 0x000000
};

const snapshot = (model: Model): GameSnapshot => ({
  status: model.status,
  distance: Math.floor(model.distance),
  score: score(model),
  coins: model.coinCount,
  speedLevel: model.speedLevel
});

const sameSnapshot = (a: GameSnapshot, b: GameSnapshot) =>
  a.status === b.status &&
  a.distance === b.distance &&
  a.score === b.score &&
  a.coins === b.coins &&
  a.speedLevel === b.speedLevel;

// 見た目を毎回変えないよう、装飾の配置には固定シードの乱数を使う。
const createRandom = (initial: number) => {
  let seed = initial;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
};

type Placement = { position: THREE.Vector3; scale?: THREE.Vector3; color?: number };

// 前方へ無限に続いて見えるよう、一定間隔で並ぶ物体を InstancedMesh にまとめ、走行距離の剰余でずらす。
const createRepeating = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  spacing: number,
  offsets: Placement[]
) => {
  const rows = Math.ceil((RULES.spawnAhead + VIEW_BEHIND) / spacing) + 1;
  const mesh = new THREE.InstancedMesh(geometry, material, rows * offsets.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const unit = new THREE.Vector3(1, 1, 1);
  const color = new THREE.Color();
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (const offset of offsets) {
      position.set(offset.position.x, offset.position.y, offset.position.z + VIEW_BEHIND - row * spacing);
      matrix.compose(position, rotation, offset.scale ?? unit);
      mesh.setMatrixAt(index, matrix);
      if (offset.color !== undefined) mesh.setColorAt(index, color.set(offset.color));
      index++;
    }
  }
  mesh.frustumCulled = false;
  return { mesh, spacing };
};

type Drawer = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const drawSky: Drawer = (ctx, width, height) => {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, COLORS.skyTop);
  gradient.addColorStop(0.42, COLORS.skyHorizon);
  gradient.addColorStop(1, COLORS.skyHorizon);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
};

const drawStripes =
  (a: string, b: string, stripes: number): Drawer =>
  (ctx, width, height) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = b;
    const step = width / stripes;
    for (let i = -1; i < stripes + 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(i * step, height);
      ctx.lineTo((i + 1) * step, height);
      ctx.lineTo((i + 2) * step, 0);
      ctx.lineTo((i + 1) * step, 0);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, width, height);
  };

const GRAFFITI_WORDS = ['RUSH', 'SUB', 'YO!', 'GO', 'WOW', 'RUN', 'ZAP'];
const GRAFFITI_COLORS = ['#ff4f9a', '#35c7ff', '#ffd23f', '#7ee04a', '#ff7a2f', '#b76bff'];

// 線路沿いの壁。コンクリート地に、ふち取りした文字と塗りつぶしの丸でグラフィティ風に描く。
const drawGraffitiWall: Drawer = (ctx, width, height) => {
  const random = createRandom(11);
  ctx.fillStyle = '#b8aea2';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#a39889';
  for (let x = 0; x < width; x += 64) ctx.fillRect(x, 0, 3, height);
  ctx.fillStyle = '#d7cfc3';
  ctx.fillRect(0, 0, width, height * 0.12);
  const pieces = 6;
  for (let i = 0; i < pieces; i++) {
    const cx = ((i + 0.5) / pieces) * width + (random() - 0.5) * 80;
    const color = GRAFFITI_COLORS[Math.floor(random() * GRAFFITI_COLORS.length)];
    const accent = GRAFFITI_COLORS[Math.floor(random() * GRAFFITI_COLORS.length)];
    ctx.fillStyle = accent;
    for (let j = 0; j < 5; j++) {
      ctx.beginPath();
      ctx.arc(cx + (random() - 0.5) * 220, height * (0.3 + random() * 0.5), 10 + random() * 26, 0, Math.PI * 2);
      ctx.fill();
    }
    const word = GRAFFITI_WORDS[Math.floor(random() * GRAFFITI_WORDS.length)];
    ctx.save();
    ctx.translate(cx, height * 0.62);
    ctx.rotate((random() - 0.5) * 0.3);
    ctx.font = `900 ${height * 0.55}px "Arial Black", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#1f1a2e';
    ctx.strokeText(word, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(word, 0, 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(word, 0, -4);
    ctx.restore();
  }
};

const drawWindows: Drawer = (ctx, width, height) => {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const cols = 4;
  const rows = 8;
  const cellW = width / cols;
  const cellH = height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 3 === 0 ? '#9fc4e8' : '#6f8fb8';
      ctx.fillRect(c * cellW + cellW * 0.18, r * cellH + cellH * 0.2, cellW * 0.64, cellH * 0.55);
    }
  }
};

// 電車の側面。窓の列・ドア・下部の帯を描く（長さ方向が横になる）。
const drawTrainSide: Drawer = (ctx, width, height) => {
  ctx.fillStyle = COLORS.trainBody;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.trainBand;
  ctx.fillRect(0, height * 0.8, width, height * 0.2);
  ctx.fillStyle = '#5e5569';
  ctx.fillRect(0, height * 0.76, width, height * 0.04);
  const windows = 7;
  for (let i = 0; i < windows; i++) {
    const x = ((i + 0.15) / windows) * width;
    const w = width / windows - (0.3 * width) / windows;
    const door = i === 2 || i === 5;
    ctx.fillStyle = '#2b2838';
    ctx.fillRect(x, height * 0.18, w, door ? height * 0.6 : height * 0.34);
    ctx.fillStyle = '#6e8fae';
    ctx.fillRect(x + 4, height * 0.2, w - 8, door ? height * 0.24 : height * 0.3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, height * 0.05, width, height * 0.04);
};

// 電車の正面。本家のように大きな窓と縁取り、左右のライトを描く。走ってくる電車はライトを点ける。
const drawTrainFront =
  (lit: boolean): Drawer =>
  (ctx, width, height) => {
    ctx.fillStyle = COLORS.trainBody;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COLORS.trainBand;
    ctx.fillRect(0, height * 0.8, width, height * 0.2);
    ctx.fillStyle = '#1f1a2e';
    ctx.beginPath();
    ctx.roundRect(width * 0.08, height * 0.08, width * 0.84, height * 0.56, 36);
    ctx.fill();
    const glass = ctx.createLinearGradient(0, height * 0.12, 0, height * 0.6);
    glass.addColorStop(0, '#d8f4ff');
    glass.addColorStop(1, '#7cc5e8');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.roundRect(width * 0.14, height * 0.13, width * 0.72, height * 0.46, 26);
    ctx.fill();
    ctx.strokeStyle = '#1f1a2e';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(width * 0.55, height * 0.55);
    ctx.lineTo(width * 0.72, height * 0.2);
    ctx.stroke();
    ctx.fillStyle = lit ? '#fff6a8' : '#f0a24a';
    for (const x of [0.13, 0.87]) {
      ctx.beginPath();
      ctx.ellipse(width * x, height * 0.72, width * 0.05, height * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!lit) return;
    ctx.fillStyle = 'rgba(255,246,168,0.35)';
    for (const x of [0.13, 0.87]) {
      ctx.beginPath();
      ctx.arc(width * x, height * 0.72, width * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }
  };

const drawCoinFace: Drawer = (ctx, width, height) => {
  ctx.fillStyle = '#ffc21a';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e58a00';
  ctx.lineWidth = width * 0.07;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, width * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffe070';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? width * 0.26 : width * 0.11;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius);
  }
  ctx.fill();
  ctx.strokeStyle = '#e58a00';
  ctx.lineWidth = width * 0.025;
  ctx.stroke();
};

type Joint = { group: THREE.Group; angle: number };
type Pose = {
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  shoulderL: number;
  shoulderR: number;
  elbowL: number;
  elbowR: number;
  lean: number;
  bob: number;
};

export const createSubwayRushGame = (
  parent: HTMLElement,
  onChange: (snapshot: GameSnapshot) => void
): GameController => {
  const model = createModel();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  parent.appendChild(renderer.domElement);

  const disposables: { dispose: () => void }[] = [];
  const texture = (width: number, height: number, draw: Drawer) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) draw(ctx, width, height);
    const created = new THREE.CanvasTexture(canvas);
    created.colorSpace = THREE.SRGBColorSpace;
    created.anisotropy = 4;
    disposables.push(created);
    return created;
  };
  const material = (color: number, map?: THREE.Texture) => {
    const created = new THREE.MeshLambertMaterial({ color, map: map ?? null });
    disposables.push(created);
    return created;
  };
  const box = (w: number, h: number, d: number) => {
    const created = new THREE.BoxGeometry(w, h, d);
    disposables.push(created);
    return created;
  };

  const scene = new THREE.Scene();
  scene.background = texture(4, 256, drawSky);
  scene.fog = new THREE.Fog(COLORS.fog, 70, RULES.spawnAhead);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a6a5a, 1.7));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  // 地面・線路（z 方向に一様なものは固定、枕木と柱だけを流す）
  const trackWidth = RULES.laneWidth * 3;
  const wallX = trackWidth / 2 + 1.35;
  const ground = new THREE.Mesh(box(wallX * 2, 0.2, 400), material(COLORS.ground));
  ground.position.set(0, -0.1, -150);
  scene.add(ground);
  for (const side of [-1, 1]) {
    const sidewalk = new THREE.Mesh(box(6, 0.4, 400), material(COLORS.sidewalk));
    sidewalk.position.set(side * (wallX + 3), 0, -150);
    const grass = new THREE.Mesh(box(40, 0.2, 400), material(COLORS.grass));
    grass.position.set(side * (wallX + 26), 0, -150);
    scene.add(sidewalk, grass);
  }
  const railGeometry = box(0.12, 0.14, 400);
  const railMaterial = material(COLORS.rail);
  for (const lane of [-1, 0, 1]) {
    for (const side of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial);
      rail.position.set(lane * RULES.laneWidth + side, 0.12, -150);
      scene.add(rail);
    }
  }
  const laneOffsets = (y: number, dx = 0) =>
    [-1, 0, 1].map((lane) => ({ position: new THREE.Vector3(lane * RULES.laneWidth + dx, y, 0) }));
  const sleepers = createRepeating(box(2.2, 0.1, 0.45), material(COLORS.sleeper), SLEEPER_SPACING, laneOffsets(0.03));
  const plates = createRepeating(box(0.3, 0.06, 0.3), material(COLORS.plate), SLEEPER_SPACING, [
    ...laneOffsets(0.1, -0.55),
    ...laneOffsets(0.1, 0.55)
  ]);
  const wallTexture = texture(2048, 96, drawGraffitiWall);
  const walls = createRepeating(
    box(0.5, 1.9, WALL_SEGMENT),
    material(0xffffff, wallTexture),
    WALL_SEGMENT,
    [-1, 1].map((side) => ({ position: new THREE.Vector3(side * wallX, 0.95, 0) }))
  );
  const lampPoles = createRepeating(
    box(0.16, 5, 0.16),
    material(COLORS.lamp),
    LAMP_SPACING,
    [-1, 1].map((side) => ({ position: new THREE.Vector3(side * (wallX + 1), 2.5, 0) }))
  );
  const lampLight = new THREE.MeshBasicMaterial({ color: COLORS.lampLight });
  disposables.push(lampLight);
  const lampHeads = createRepeating(
    box(0.7, 0.3, 0.4),
    lampLight,
    LAMP_SPACING,
    [-1, 1].map((side) => ({ position: new THREE.Vector3(side * (wallX + 0.7), 5, 0) }))
  );

  // 建物と木は周期 SCENERY_PERIOD の中に固定シードで並べる。
  const random = createRandom(3);
  const buildingGeometry = box(1, 1, 1);
  buildingGeometry.translate(0, 0.5, 0);
  const buildingColors = [0xf2d7b6, 0xc9dcf0, 0xf0c2c2, 0xd9e8c4, 0xe7d0f2, 0xf7e7a8];
  const buildingPlacements: Placement[] = [];
  const treePlacements: Placement[] = [];
  for (const side of [-1, 1]) {
    for (let z = 0; z < SCENERY_PERIOD; ) {
      const depth = 8 + random() * 8;
      const width = 6 + random() * 5;
      buildingPlacements.push({
        position: new THREE.Vector3(side * (wallX + 7 + width / 2 + random() * 3), 0, -z - depth / 2),
        scale: new THREE.Vector3(width, 8 + random() * 22, depth),
        color: buildingColors[Math.floor(random() * buildingColors.length)]
      });
      treePlacements.push({ position: new THREE.Vector3(side * (wallX + 4.6), 0, -z - random() * 4) });
      z += depth + 2 + random() * 3;
    }
  }
  const buildings = createRepeating(
    buildingGeometry,
    material(0xffffff, texture(128, 256, drawWindows)),
    SCENERY_PERIOD,
    buildingPlacements
  );
  const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 2.2, 6);
  trunkGeometry.translate(0, 1.1, 0);
  const leavesGeometry = new THREE.IcosahedronGeometry(1.3, 0);
  leavesGeometry.translate(0, 2.8, 0);
  disposables.push(trunkGeometry, leavesGeometry);
  const trunks = createRepeating(trunkGeometry, material(COLORS.trunk), SCENERY_PERIOD, treePlacements);
  const leaves = createRepeating(leavesGeometry, material(COLORS.leaves), SCENERY_PERIOD, treePlacements);
  const repeating = [sleepers, plates, walls, lampPoles, lampHeads, buildings, trunks, leaves];
  for (const item of repeating) scene.add(item.mesh);

  // プレイヤー: 箱を組み合わせた人型。関節ごとに Group を作り、角度を補間してモーションを付ける。
  const player = new THREE.Group();
  const rig = new THREE.Group();
  player.add(rig);
  const part = (
    parentGroup: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    color: number,
    x: number,
    y: number,
    z: number
  ) => {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(x, y, z);
    parentGroup.add(mesh);
    return mesh;
  };
  const joint = (parentGroup: THREE.Object3D, x: number, y: number, z: number): Joint => {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    parentGroup.add(group);
    return { group, angle: 0 };
  };
  const torso = new THREE.Group();
  torso.position.y = 0.85;
  rig.add(torso);
  part(torso, box(0.56, 0.6, 0.32), COLORS.hoodie, 0, 0.3, 0);
  part(torso, box(0.5, 0.46, 0.08), COLORS.vest, 0, 0.32, 0.18);
  part(torso, box(0.5, 0.2, 0.34), COLORS.jeans, 0, 0.02, 0);
  part(torso, box(0.38, 0.38, 0.38), COLORS.skin, 0, 0.8, 0);
  part(torso, box(0.42, 0.16, 0.42), COLORS.cap, 0, 1.0, 0);
  part(torso, box(0.4, 0.26, 0.06), COLORS.hair, 0, 0.78, 0.2);
  part(torso, box(0.34, 0.05, 0.24), COLORS.cap, 0, 0.93, -0.28);
  const limbs = (side: -1 | 1) => {
    const hip = joint(rig, side * 0.15, 0.85, 0);
    part(hip.group, box(0.21, 0.44, 0.22), COLORS.jeans, 0, -0.22, 0);
    const knee = joint(hip.group, 0, -0.44, 0);
    part(knee.group, box(0.19, 0.38, 0.2), COLORS.jeans, 0, -0.19, 0);
    part(knee.group, box(0.24, 0.14, 0.36), COLORS.shoe, 0, -0.36, -0.05);
    const shoulder = joint(torso, side * 0.36, 0.55, 0);
    part(shoulder.group, box(0.15, 0.3, 0.16), COLORS.hoodie, 0, -0.15, 0);
    const elbow = joint(shoulder.group, 0, -0.3, 0);
    part(elbow.group, box(0.14, 0.26, 0.15), COLORS.hoodie, 0, -0.13, 0);
    part(elbow.group, box(0.13, 0.12, 0.13), COLORS.skin, 0, -0.3, 0);
    return { hip, knee, shoulder, elbow };
  };
  const left = limbs(-1);
  const right = limbs(1);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: COLORS.shadow, transparent: true, opacity: 0.28 });
  const shadowGeometry = new THREE.CircleGeometry(0.5, 20);
  shadowGeometry.rotateX(-Math.PI / 2);
  disposables.push(shadowMaterial, shadowGeometry);
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  scene.add(player, shadow);

  // 障害物は当たり判定の箱をそのまま描画し、見た目と判定を一致させる。
  const partMaterials: Record<BoxPart, THREE.Material> = {
    fence: material(0xffffff, texture(256, 128, drawStripes('#ffffff', '#e8413c', 6))),
    board: material(0xffffff, texture(256, 128, drawStripes('#ffd23f', '#262233', 8))),
    post: material(COLORS.post)
  };
  const partGeometries = new Map<string, THREE.BoxGeometry>();
  const partGeometry = (w: number, h: number, d: number) => {
    const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`;
    const cached = partGeometries.get(key);
    if (cached) return cached;
    const created = box(w, h, d);
    partGeometries.set(key, created);
    return created;
  };

  // 電車: 車体の箱は当たり判定（幅 TRAIN.width・高さ TRAIN.height）と同じ大きさにする。
  const bodyBottom = 0.45;
  const carGeometry = box(TRAIN.width, TRAIN.height - bodyBottom, TRAIN.carLength - 0.4);
  const bogieGeometry = box(TRAIN.width * 0.8, bodyBottom, TRAIN.carLength - 1.2);
  const couplerGeometry = box(TRAIN.width * 0.7, TRAIN.height - bodyBottom - 0.3, 0.4);
  const sideMaterial = material(0xffffff, texture(512, 128, drawTrainSide));
  const roofMaterial = material(COLORS.trainRoof);
  const frontMaterial = material(0xffffff, texture(256, 256, drawTrainFront(false)));
  const litTexture = texture(256, 256, drawTrainFront(true));
  const litFrontMaterial = new THREE.MeshLambertMaterial({
    map: litTexture,
    emissive: 0xffffff,
    emissiveMap: litTexture,
    emissiveIntensity: 0.35
  });
  disposables.push(litFrontMaterial);
  const bogieMaterial = material(COLORS.bogie);
  const carMaterials = (front: THREE.Material) => [
    sideMaterial,
    sideMaterial,
    roofMaterial,
    bogieMaterial,
    front,
    roofMaterial
  ];
  const rampLength = Math.hypot(TRAIN.rampLength, TRAIN.height);
  const rampGeometry = box(TRAIN.width, 0.16, rampLength);
  const rampMaterial = material(0xffffff, texture(256, 256, drawStripes('#c9ced6', '#ffd23f', 10)));
  const rampLegGeometry = box(0.14, 1, 0.14);
  rampLegGeometry.translate(0, 0.5, 0);

  const createTrainMesh = (obstacle: Obstacle) => {
    const group = new THREE.Group();
    const cars = Math.round(obstacle.length / TRAIN.carLength);
    const front = obstacle.kind === 'movingTrain' ? litFrontMaterial : frontMaterial;
    for (let i = 0; i < cars; i++) {
      const center = -(i + 0.5) * TRAIN.carLength;
      const car = new THREE.Mesh(carGeometry, carMaterials(i === 0 ? front : roofMaterial));
      car.position.set(0, bodyBottom + (TRAIN.height - bodyBottom) / 2, center);
      const bogie = new THREE.Mesh(bogieGeometry, bogieMaterial);
      bogie.position.set(0, bodyBottom / 2, center);
      group.add(car, bogie);
      if (i === 0) continue;
      const coupler = new THREE.Mesh(couplerGeometry, bogieMaterial);
      coupler.position.set(0, bodyBottom + (TRAIN.height - bodyBottom) / 2, -i * TRAIN.carLength);
      group.add(coupler);
    }
    if (!obstacle.ramp) return group;
    // スロープの板の上面が、判定の斜面（手前 0m → 電車の前面で屋根の高さ）に沿うように傾ける。
    const angle = Math.atan2(TRAIN.height, TRAIN.rampLength);
    const ramp = new THREE.Mesh(rampGeometry, rampMaterial);
    ramp.rotation.x = angle;
    ramp.position.set(0, TRAIN.height / 2 - 0.08, TRAIN.rampLength / 2);
    group.add(ramp);
    for (const t of [0.3, 0.65]) {
      for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(rampLegGeometry, bogieMaterial);
        leg.scale.y = TRAIN.height * (1 - t);
        leg.position.set((side * TRAIN.width) / 2.4, 0, TRAIN.rampLength * t);
        group.add(leg);
      }
    }
    return group;
  };

  const createObstacleMesh = (obstacle: Obstacle) => {
    if (obstacle.kind === 'train' || obstacle.kind === 'movingTrain') return createTrainMesh(obstacle);
    const group = new THREE.Group();
    for (const piece of obstacleBoxes(obstacle)) {
      const mesh = new THREE.Mesh(
        partGeometry(piece.maxX - piece.minX, piece.maxY - piece.minY, piece.maxZ - piece.minZ),
        partMaterials[piece.part]
      );
      mesh.position.set((piece.minX + piece.maxX) / 2, (piece.minY + piece.maxY) / 2, 0);
      group.add(mesh);
    }
    return group;
  };

  const obstacleMeshes = new Map<number, THREE.Group>();

  const syncObstacles = () => {
    const alive = new Set<number>();
    for (const obstacle of model.obstacles) {
      alive.add(obstacle.id);
      let group = obstacleMeshes.get(obstacle.id);
      if (!group) {
        group = createObstacleMesh(obstacle);
        if (obstacle.kind === 'train' || obstacle.kind === 'movingTrain') group.position.x = laneX(obstacle.lane);
        obstacleMeshes.set(obstacle.id, group);
        scene.add(group);
      }
      // 浮動小数点の誤差を避けるため、プレイヤーを原点とした相対座標で描画する。
      group.position.z = -(obstacle.z - model.distance);
    }
    for (const [id, group] of obstacleMeshes) {
      if (alive.has(id)) continue;
      scene.remove(group);
      obstacleMeshes.delete(id);
    }
  };

  // コイン: 面がカメラを向くように倒した円柱を、y 軸まわりに回す。
  const coinGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 24);
  coinGeometry.rotateX(Math.PI / 2);
  disposables.push(coinGeometry);
  const coinFace = material(0xffffff, texture(128, 128, drawCoinFace));
  const coinEdge = material(0xe8a200);
  const coinMesh = new THREE.InstancedMesh(coinGeometry, [coinEdge, coinFace, coinFace], MAX_COINS);
  coinMesh.frustumCulled = false;
  scene.add(coinMesh);
  const coinMatrix = new THREE.Matrix4();
  const coinRotation = new THREE.Quaternion();
  const coinPosition = new THREE.Vector3();
  const coinScale = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let coinSlots = MAX_COINS;

  const syncCoins = (time: number) => {
    let count = 0;
    for (const coin of model.coins) {
      if (count >= MAX_COINS) break;
      coinPosition.set(laneX(coin.lane), coin.y, -(coin.z - model.distance));
      coinRotation.setFromAxisAngle(yAxis, time * 3 + coin.z * 0.25);
      coinMatrix.compose(coinPosition, coinRotation, coinScale);
      coinMesh.setMatrixAt(count++, coinMatrix);
    }
    // count を減らす方式だと、count 0 で初回描画されたときに以降も描画されなかったため、余りは大きさ 0 で隠す。
    for (let i = count; i < coinSlots; i++) coinMesh.setMatrixAt(i, hiddenMatrix);
    coinSlots = count;
    coinMesh.instanceMatrix.needsUpdate = true;
  };

  const joints = [left.hip, right.hip, left.knee, right.knee, left.shoulder, right.shoulder, left.elbow, right.elbow];
  const poseState = { lean: 0, bob: 0 };
  const targetPose = (): Pose => {
    const p = model.player;
    const phase = model.distance * 0.75;
    if (model.status === 'ready') {
      return {
        hipL: 0,
        hipR: 0,
        kneeL: 0,
        kneeR: 0,
        shoulderL: 0.1,
        shoulderR: 0.1,
        elbowL: 0.3,
        elbowR: 0.3,
        lean: 0,
        bob: 0
      };
    }
    if (isSliding(p) && isGrounded(p)) {
      return {
        hipL: 1.3,
        hipR: 1.1,
        kneeL: -0.2,
        kneeR: -0.5,
        shoulderL: -0.6,
        shoulderR: -0.6,
        elbowL: 0.2,
        elbowR: 0.2,
        lean: 1.2,
        bob: 0
      };
    }
    if (!isGrounded(p)) {
      return {
        hipL: 1.2,
        hipR: 0.2,
        kneeL: -1.5,
        kneeR: -0.9,
        shoulderL: 2.5,
        shoulderR: 2.2,
        elbowL: 0.4,
        elbowR: 0.4,
        lean: -0.1,
        bob: 0
      };
    }
    const swing = Math.sin(phase);
    return {
      hipL: swing * 0.9,
      hipR: -swing * 0.9,
      kneeL: -Math.max(0, -Math.cos(phase)) * 1.3 - 0.2,
      kneeR: -Math.max(0, Math.cos(phase)) * 1.3 - 0.2,
      shoulderL: -swing * 0.9,
      shoulderR: swing * 0.9,
      elbowL: 1.1,
      elbowR: 1.1,
      lean: -0.12,
      bob: Math.abs(Math.cos(phase)) * 0.08
    };
  };

  const animatePlayer = (dt: number) => {
    const p = model.player;
    player.position.set(p.x, p.y, 0);
    player.rotation.z = Math.max(-0.35, Math.min(0.35, -(laneX(p.lane) - p.x) * 0.12));
    if (model.status === 'over') {
      rig.rotation.x += (-0.5 - rig.rotation.x) * Math.min(1, dt * 8);
      return;
    }
    const pose = targetPose();
    const values = [
      pose.hipL,
      pose.hipR,
      pose.kneeL,
      pose.kneeR,
      pose.shoulderL,
      pose.shoulderR,
      pose.elbowL,
      pose.elbowR
    ];
    const blend = 1 - Math.exp(-22 * dt);
    joints.forEach((item, index) => {
      item.angle += (values[index] - item.angle) * blend;
      item.group.rotation.x = item.angle;
    });
    poseState.lean += (pose.lean - poseState.lean) * blend;
    poseState.bob += (pose.bob - poseState.bob) * blend;
    rig.rotation.x = poseState.lean;
    rig.position.y = poseState.bob;
  };

  const cameraState = { x: 0, y: 0, fov: 0, shake: 0, bumps: 0, level: 0, status: model.status };
  const resetCamera = () => {
    cameraState.x = 0;
    cameraState.y = 0;
    cameraState.fov = 0;
    cameraState.shake = 0;
    cameraState.bumps = 0;
    cameraState.level = 0;
    rig.rotation.x = 0;
  };

  let time = 0;
  const render = (dt: number) => {
    if (model.status === 'playing') time += dt;
    const p = model.player;
    animatePlayer(dt);
    shadow.position.set(p.x, p.ground + 0.03, 0);
    shadow.scale.setScalar(Math.max(0.4, 1 - (p.y - p.ground) * 0.15));
    for (const item of repeating) item.mesh.position.z = model.distance % item.spacing;
    syncObstacles();
    syncCoins(time);

    // 横からぶつかった・ゲームオーバーになった・加速したときの画面演出
    if (model.bumps !== cameraState.bumps) {
      cameraState.bumps = model.bumps;
      cameraState.shake = 0.25;
    }
    if (model.status !== cameraState.status) {
      if (model.status === 'over') cameraState.shake = 0.5;
      cameraState.status = model.status;
    }
    if (model.speedLevel !== cameraState.level) {
      if (model.speedLevel > cameraState.level) cameraState.fov = CAMERA.speedUpFov;
      cameraState.level = model.speedLevel;
    }
    cameraState.shake = Math.max(0, cameraState.shake - dt);
    cameraState.fov *= Math.exp(-2.5 * dt);
    const fov = CAMERA.fov + cameraState.fov;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    // レーン移動・ジャンプには少し遅れて滑らかに追従する。
    const targetY = p.ground * CAMERA.groundFollow + (p.y - p.ground) * CAMERA.jumpFollow;
    cameraState.x += (p.x - cameraState.x) * (1 - Math.exp(-CAMERA.followX * dt));
    cameraState.y += (targetY - cameraState.y) * (1 - Math.exp(-CAMERA.followY * dt));
    const shake = cameraState.shake * Math.sin(performance.now() * 0.06);
    camera.position.set(cameraState.x + shake, CAMERA.height + cameraState.y, CAMERA.back);
    camera.lookAt(cameraState.x + shake * 0.5, CAMERA.lookHeight + cameraState.y, -CAMERA.lookAhead);
    renderer.render(scene, camera);
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

  let last = snapshot(model);
  const emit = () => {
    const next = snapshot(model);
    if (sameSnapshot(next, last)) return;
    last = next;
    onChange(next);
  };

  let frame = 0;
  let previous = performance.now();
  const loop = (now: number) => {
    const dt = Math.min((now - previous) / 1000, RULES.maxFrame);
    previous = now;
    stepModel(model, dt);
    render(dt);
    emit();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);

  const actions: Record<string, () => void> = {
    ArrowLeft: () => moveLane(model, -1),
    ArrowRight: () => moveLane(model, 1),
    ArrowUp: () => jump(model),
    ArrowDown: () => slide(model)
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    if (event.repeat) return;
    action();
  };

  // スワイプは指を離すのを待たず、しきい値を超えた時点で1ジェスチャーにつき1回だけ発火する。
  const swipe = { id: -1, x: 0, y: 0, fired: false };
  const onPointerDown = (event: PointerEvent) => {
    swipe.id = event.pointerId;
    swipe.x = event.clientX;
    swipe.y = event.clientY;
    swipe.fired = false;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== swipe.id || swipe.fired) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
    swipe.fired = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      moveLane(model, dx > 0 ? 1 : -1);
      return;
    }
    if (dy < 0) {
      jump(model);
      return;
    }
    slide(model);
  };
  const onPointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== swipe.id) return;
    swipe.id = -1;
  };

  window.addEventListener('keydown', onKeyDown);
  parent.addEventListener('pointerdown', onPointerDown);
  parent.addEventListener('pointermove', onPointerMove);
  parent.addEventListener('pointerup', onPointerEnd);
  parent.addEventListener('pointercancel', onPointerEnd);

  onChange(last);

  return {
    start: () => {
      startModel(model);
      resetCamera();
      time = 0;
      previous = performance.now();
      emit();
    },
    pause: () => {
      pauseModel(model);
      emit();
    },
    resume: () => {
      resumeModel(model);
      previous = performance.now();
      emit();
    },
    destroy: () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      parent.removeEventListener('pointerdown', onPointerDown);
      parent.removeEventListener('pointermove', onPointerMove);
      parent.removeEventListener('pointerup', onPointerEnd);
      parent.removeEventListener('pointercancel', onPointerEnd);
      for (const item of repeating) item.mesh.dispose();
      coinMesh.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
};
