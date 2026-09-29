import * as THREE from 'three';
import {
  type BoxPart,
  createModel,
  type GameStatus,
  jump,
  type Model,
  moveLane,
  obstacleBoxes,
  playerHeight,
  RULES,
  slide,
  startModel,
  stepModel
} from './model';

export type GameSnapshot = { status: GameStatus; distance: number };
export type GameController = { start: () => void; destroy: () => void };

// 本家の見た目に合わせ、プレイヤーを画面下寄り・地平線を画面上1/3付近に置く低めの視点。
const CAMERA = {
  fov: 60,
  height: 6,
  back: 11,
  lookAhead: 20,
  lookHeight: 0,
  followX: 9,
  followY: 4,
  jumpFollow: 0.4
};

const SWIPE_THRESHOLD = 28;
const SLEEPER_SPACING = 1.3;
const PILLAR_SPACING = 12;
const VIEW_BEHIND = 12;
const COLORS = {
  sky: 0x8fd3ff,
  ground: 0x6e4a3a,
  sleeper: 0x3b2a24,
  rail: 0xc9ced6,
  wall: 0xb9a48e,
  pillar: 0x8d7b69,
  player: 0x2f7cf6,
  head: 0xffd7b0,
  fence: 0xe8413c,
  board: 0xffc933,
  post: 0x5a5f69
};

const snapshot = (model: Model): GameSnapshot => ({ status: model.status, distance: Math.floor(model.distance) });

// 前方へ無限に続いて見えるよう、一定間隔で並ぶ物体を InstancedMesh にまとめ、走行距離の剰余でずらす。
const createRepeating = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  spacing: number,
  offsets: THREE.Vector3[]
) => {
  const rows = Math.ceil((RULES.spawnAhead + VIEW_BEHIND) / spacing) + 1;
  const mesh = new THREE.InstancedMesh(geometry, material, rows * offsets.length);
  const matrix = new THREE.Matrix4();
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (const offset of offsets) {
      matrix.makeTranslation(offset.x, offset.y, offset.z + VIEW_BEHIND - row * spacing);
      mesh.setMatrixAt(index++, matrix);
    }
  }
  mesh.frustumCulled = false;
  return { mesh, spacing };
};

export const createSubwayRushGame = (
  parent: HTMLElement,
  onChange: (snapshot: GameSnapshot) => void
): GameController => {
  const model = createModel();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  parent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 70, RULES.spawnAhead);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b5a4e, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  const disposables: { dispose: () => void }[] = [];
  const material = (color: number) => {
    const created = new THREE.MeshLambertMaterial({ color });
    disposables.push(created);
    return created;
  };
  const box = (w: number, h: number, d: number) => {
    const created = new THREE.BoxGeometry(w, h, d);
    disposables.push(created);
    return created;
  };

  // 地面・線路（z 方向に一様なものは固定、枕木と柱だけを流す）
  const trackWidth = RULES.laneWidth * 3;
  const ground = new THREE.Mesh(box(trackWidth + 6, 0.2, 400), material(COLORS.ground));
  ground.position.set(0, -0.1, -150);
  scene.add(ground);
  const railGeometry = box(0.1, 0.12, 400);
  const railMaterial = material(COLORS.rail);
  for (const lane of [-1, 0, 1]) {
    for (const side of [-0.55, 0.55]) {
      const rail = new THREE.Mesh(railGeometry, railMaterial);
      rail.position.set(lane * RULES.laneWidth + side, 0.06, -150);
      scene.add(rail);
    }
  }
  const wallGeometry = box(0.6, 3.2, 400);
  const wallMaterial = material(COLORS.wall);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(side * (trackWidth / 2 + 3.3), 1.6, -150);
    scene.add(wall);
  }
  const sleepers = createRepeating(
    box(1.7, 0.08, 0.35),
    material(COLORS.sleeper),
    SLEEPER_SPACING,
    [-1, 0, 1].map((lane) => new THREE.Vector3(lane * RULES.laneWidth, 0.02, 0))
  );
  const pillars = createRepeating(
    box(0.8, 5, 0.8),
    material(COLORS.pillar),
    PILLAR_SPACING,
    [-1, 1].map((side) => new THREE.Vector3(side * (trackWidth / 2 + 2.6), 2.5, 0))
  );
  const repeating = [sleepers, pillars];
  for (const item of repeating) scene.add(item.mesh);

  // プレイヤー（仮の見た目。足元を原点にして、スライディング時は縦方向に縮める）
  const player = new THREE.Group();
  const bodyGeometry = box(RULES.playerWidth, RULES.standHeight, RULES.playerDepth);
  bodyGeometry.translate(0, RULES.standHeight / 2, 0);
  const body = new THREE.Mesh(bodyGeometry, material(COLORS.player));
  const head = new THREE.Mesh(box(0.5, 0.4, 0.5), material(COLORS.head));
  player.add(body, head);
  scene.add(player);

  // 障害物は当たり判定の箱をそのまま描画し、見た目と判定を一致させる。
  const partMaterials: Record<BoxPart, THREE.Material> = {
    fence: material(COLORS.fence),
    board: material(COLORS.board),
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
  const obstacleMeshes = new Map<number, THREE.Group>();

  const syncObstacles = () => {
    const alive = new Set<number>();
    for (const obstacle of model.obstacles) {
      alive.add(obstacle.id);
      let group = obstacleMeshes.get(obstacle.id);
      if (!group) {
        group = new THREE.Group();
        for (const part of obstacleBoxes(obstacle)) {
          const mesh = new THREE.Mesh(
            partGeometry(part.maxX - part.minX, part.maxY - part.minY, part.maxZ - part.minZ),
            partMaterials[part.part]
          );
          mesh.position.set((part.minX + part.maxX) / 2, (part.minY + part.maxY) / 2, 0);
          group.add(mesh);
        }
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

  const cameraState = { x: 0, y: 0 };
  const resetCamera = () => {
    cameraState.x = 0;
    cameraState.y = 0;
  };

  const render = (dt: number) => {
    const p = model.player;
    player.position.set(p.x, p.y, 0);
    body.scale.y = playerHeight(p) / RULES.standHeight;
    head.position.set(0, playerHeight(p) + 0.2, 0);
    for (const item of repeating) item.mesh.position.z = model.distance % item.spacing;
    syncObstacles();

    // レーン移動・ジャンプには少し遅れて滑らかに追従する。
    cameraState.x += (p.x - cameraState.x) * (1 - Math.exp(-CAMERA.followX * dt));
    cameraState.y += (p.y * CAMERA.jumpFollow - cameraState.y) * (1 - Math.exp(-CAMERA.followY * dt));
    camera.position.set(cameraState.x, CAMERA.height + cameraState.y, CAMERA.back);
    camera.lookAt(cameraState.x, CAMERA.lookHeight + cameraState.y, -CAMERA.lookAhead);
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
    if (next.status === last.status && next.distance === last.distance) return;
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
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
};
