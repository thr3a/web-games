// 座標系: x は右が正、y は上が正、z はプレイヤーの進行方向が正。単位はおおよそメートル。
export const RULES = {
  laneWidth: 2.6,
  runSpeed: 14,
  laneChangeSpeed: 19,
  gravity: 40,
  jumpVelocity: 13,
  fastDropVelocity: 28,
  slideDuration: 0.65,
  playerWidth: 0.8,
  playerDepth: 0.6,
  standHeight: 1.7,
  slideHeight: 0.9,
  // 障害物の列の間隔は「秒」で持ち、速度が上がっても反応時間が一定になるようにする。
  rowGapMinSeconds: 1.15,
  rowGapMaxSeconds: 1.6,
  firstRowDistance: 45,
  spawnAhead: 170,
  despawnBehind: 12,
  maxStep: 1 / 120,
  maxFrame: 0.1
};

export const OBSTACLE = {
  fenceHeight: 1.0,
  fenceWidth: 2.2,
  fenceDepth: 0.3,
  barBottom: 1.25,
  barTop: 2.7,
  barDepth: 0.3,
  postWidth: 0.14
};

export type Lane = -1 | 0 | 1;
export type GameStatus = 'ready' | 'playing' | 'over';
export type ObstacleKind = 'fence' | 'bar';
export type Obstacle = { id: number; kind: ObstacleKind; lane: Lane; z: number };
export type BoxPart = 'fence' | 'board' | 'post';
export type Aabb = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};
export type Box = Aabb & { part: BoxPart };
export type Player = {
  lane: Lane;
  x: number;
  y: number;
  vy: number;
  slideTimer: number;
  // 空中で下入力したとき、着地と同時にスライディングへ移行するためのフラグ。
  slideOnLand: boolean;
};
export type Model = {
  status: GameStatus;
  distance: number;
  speed: number;
  player: Player;
  obstacles: Obstacle[];
  nextRowZ: number;
  nextId: number;
  rng: () => number;
};

export const laneX = (lane: Lane) => lane * RULES.laneWidth;

const createPlayer = (): Player => ({ lane: 0, x: 0, y: 0, vy: 0, slideTimer: 0, slideOnLand: false });

export const createModel = (rng: () => number = Math.random): Model => ({
  status: 'ready',
  distance: 0,
  speed: RULES.runSpeed,
  player: createPlayer(),
  obstacles: [],
  nextRowZ: RULES.firstRowDistance,
  nextId: 1,
  rng
});

export const startModel = (model: Model) => {
  model.status = 'playing';
  model.distance = 0;
  model.speed = RULES.runSpeed;
  model.player = createPlayer();
  model.obstacles = [];
  model.nextRowZ = RULES.firstRowDistance;
  model.nextId = 1;
  fillObstacles(model);
};

export const isGrounded = (player: Player) => player.y <= 0 && player.vy <= 0;
export const isSliding = (player: Player) => player.slideTimer > 0;
export const playerHeight = (player: Player) => (isSliding(player) ? RULES.slideHeight : RULES.standHeight);

export const moveLane = (model: Model, dir: -1 | 1) => {
  if (model.status !== 'playing') return;
  const next = model.player.lane + dir;
  if (next !== -1 && next !== 0 && next !== 1) return;
  model.player.lane = next;
};

export const jump = (model: Model) => {
  if (model.status !== 'playing') return;
  const player = model.player;
  if (!isGrounded(player)) return;
  player.vy = RULES.jumpVelocity;
  player.slideTimer = 0;
  player.slideOnLand = false;
};

export const slide = (model: Model) => {
  if (model.status !== 'playing') return;
  const player = model.player;
  if (!isGrounded(player)) {
    player.vy = Math.min(player.vy, -RULES.fastDropVelocity);
    player.slideOnLand = true;
    return;
  }
  player.slideTimer = RULES.slideDuration;
};

export const obstacleBoxes = (obstacle: Obstacle): Box[] => {
  const cx = laneX(obstacle.lane);
  if (obstacle.kind === 'fence') {
    const half = OBSTACLE.fenceWidth / 2;
    const depth = OBSTACLE.fenceDepth / 2;
    return [
      {
        part: 'fence',
        minX: cx - half,
        maxX: cx + half,
        minY: 0,
        maxY: OBSTACLE.fenceHeight,
        minZ: obstacle.z - depth,
        maxZ: obstacle.z + depth
      }
    ];
  }
  // 高いバーは看板状の板と、レーン境界に立つ2本の支柱で構成する。支柱にも当たり判定を持たせる。
  const edge = RULES.laneWidth / 2;
  const depth = OBSTACLE.barDepth / 2;
  const post = OBSTACLE.postWidth;
  const base = { minZ: obstacle.z - depth, maxZ: obstacle.z + depth };
  return [
    { part: 'board', minX: cx - edge, maxX: cx + edge, minY: OBSTACLE.barBottom, maxY: OBSTACLE.barTop, ...base },
    { part: 'post', minX: cx - edge, maxX: cx - edge + post, minY: 0, maxY: OBSTACLE.barBottom, ...base },
    { part: 'post', minX: cx + edge - post, maxX: cx + edge, minY: 0, maxY: OBSTACLE.barBottom, ...base }
  ];
};

export const playerBox = (model: Model): Aabb => {
  const { player } = model;
  const halfW = RULES.playerWidth / 2;
  const halfD = RULES.playerDepth / 2;
  return {
    minX: player.x - halfW,
    maxX: player.x + halfW,
    minY: player.y,
    maxY: player.y + playerHeight(player),
    minZ: model.distance - halfD,
    maxZ: model.distance + halfD
  };
};

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;

const hitsObstacle = (model: Model) => {
  const box = playerBox(model);
  return model.obstacles.some(
    (obstacle) =>
      Math.abs(obstacle.z - model.distance) < 2 && obstacleBoxes(obstacle).some((part) => overlaps(box, part))
  );
};

const pickLanes = (rng: () => number): Lane[] => {
  const lanes: Lane[] = [-1, 0, 1];
  const roll = rng();
  const count = roll < 0.5 ? 1 : roll < 0.9 ? 2 : 3;
  // 先頭 count 個を使うため、部分的にシャッフルする。
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (lanes.length - i));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  return lanes.slice(0, count);
};

// 1列ぶんの障害物を置く。柵・バーはどちらもジャンプ/スライディングで越えられるため、
// 3レーンすべてが埋まっても詰みにはならない。列同士の間隔で次の操作までの猶予を確保する。
const spawnRow = (model: Model) => {
  for (const lane of pickLanes(model.rng)) {
    const kind: ObstacleKind = model.rng() < 0.5 ? 'fence' : 'bar';
    model.obstacles.push({ id: model.nextId++, kind, lane, z: model.nextRowZ });
  }
  const gapSeconds = RULES.rowGapMinSeconds + model.rng() * (RULES.rowGapMaxSeconds - RULES.rowGapMinSeconds);
  model.nextRowZ += gapSeconds * model.speed;
};

const fillObstacles = (model: Model) => {
  while (model.nextRowZ < model.distance + RULES.spawnAhead) spawnRow(model);
  model.obstacles = model.obstacles.filter((obstacle) => obstacle.z > model.distance - RULES.despawnBehind);
};

const approach = (value: number, target: number, maxDelta: number) => {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
};

const stepPlayer = (model: Model, dt: number) => {
  const player = model.player;
  player.x = approach(player.x, laneX(player.lane), RULES.laneChangeSpeed * dt);

  if (player.slideTimer > 0) player.slideTimer = Math.max(0, player.slideTimer - dt);

  if (player.y > 0 || player.vy > 0) {
    player.vy -= RULES.gravity * dt;
    player.y += player.vy * dt;
  }
  if (player.y > 0) return;
  player.y = 0;
  player.vy = 0;
  if (!player.slideOnLand) return;
  player.slideOnLand = false;
  player.slideTimer = RULES.slideDuration;
};

// フレーム時間が大きくても障害物をすり抜けないよう、細かいサブステップに分けて進める。
export const stepModel = (model: Model, frameDt: number) => {
  if (model.status !== 'playing') return;
  let remaining = Math.min(Math.max(frameDt, 0), RULES.maxFrame);
  while (remaining > 0) {
    const dt = Math.min(remaining, RULES.maxStep);
    remaining -= dt;
    model.distance += model.speed * dt;
    stepPlayer(model, dt);
    if (hitsObstacle(model)) {
      model.status = 'over';
      break;
    }
  }
  fillObstacles(model);
};
