// 座標系: x は右が正、y は上が正、z はプレイヤーの進行方向が正。単位はおおよそメートル。
export const RULES = {
  laneWidth: 2.6,
  runSpeed: 20,
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
  maxFrame: 0.1,
  // 列を電車にする確率。電車を置けなかった列は柵・バーの列になる。
  trainRowChance: 0.45,
  // 電車でレーンがふさがる前後に、別のレーンへ逃げるための猶予（秒）。
  dodgeSeconds: 0.8,
  // 同じレーンの障害物同士の最小の隙間。電車の後ろは屋根から落ちて着地するぶん広く取る。
  obstacleGap: 3,
  trainTailGap: 8,
  coinChance: 0.8,
  coinLaneChangeChance: 0.35,
  coinSpacing: 2.2,
  coinScore: 5,
  coinsPerSpeedUp: 30,
  speedStep: 10,
  maxSpeedLevel: 5
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

export const TRAIN = {
  width: 2.3,
  height: 3.0,
  carLength: 12,
  rampLength: 8,
  // 走ってくる電車は、プレイヤーの速度にこの比率を掛けた速さで迫ってくる（速度が上がっても反応時間が変わらない）。
  approachRatio: 0.7,
  // この高さまでの段差は乗り上がれる。スロープを駆け上がる・屋根に着地するときに使う。
  stepUp: 0.45
};

export const COIN = {
  // 足場からコインの中心までの高さ
  lift: 0.9,
  pickX: 0.85,
  pickZ: 0.8
};

export type Lane = -1 | 0 | 1;
export type GameStatus = 'ready' | 'playing' | 'paused' | 'over';
export type ObstacleKind = 'fence' | 'bar' | 'train' | 'movingTrain';
export type Obstacle = {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  // 手前側の端。走ってくる電車は毎ステップ動く。
  z: number;
  // 電車の長さ。柵・バーは 0。
  length: number;
  // 停車中の電車の手前にスロープがあるか
  ramp: boolean;
  // 走ってくる電車の先頭とプレイヤーがすれ違い始める位置。それ以外は z と同じ。
  meetZ: number;
};
export type ObstacleSpec = { kind: ObstacleKind; lane: Lane; z: number; cars?: number; ramp?: boolean };
export type Coin = { id: number; lane: Lane; z: number; y: number };
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
  // 足元の面の高さ（線路なら 0、電車の屋根なら TRAIN.height）
  ground: number;
  slideTimer: number;
  // 空中で下入力したとき、着地と同時にスライディングへ移行するためのフラグ。
  slideOnLand: boolean;
};
export type Model = {
  status: GameStatus;
  distance: number;
  speed: number;
  speedLevel: number;
  player: Player;
  obstacles: Obstacle[];
  coins: Coin[];
  coinCount: number;
  // 電車の側面にぶつかって押し戻された回数（描画側の揺れ演出用）
  bumps: number;
  nextRowZ: number;
  lastRowZ: number;
  coinLane: Lane;
  nextId: number;
  rng: () => number;
};

export const laneX = (lane: Lane) => lane * RULES.laneWidth;

const LANES: Lane[] = [-1, 0, 1];

const createPlayer = (): Player => ({
  lane: 0,
  x: 0,
  y: 0,
  vy: 0,
  ground: 0,
  slideTimer: 0,
  slideOnLand: false
});

export const createModel = (rng: () => number = Math.random): Model => ({
  status: 'ready',
  distance: 0,
  speed: RULES.runSpeed,
  speedLevel: 0,
  player: createPlayer(),
  obstacles: [],
  coins: [],
  coinCount: 0,
  bumps: 0,
  nextRowZ: RULES.firstRowDistance,
  lastRowZ: 12,
  coinLane: 0,
  nextId: 1,
  rng
});

// 描画側は id でメッシュを使い回すため、リトライしても id は振り直さない。
export const startModel = (model: Model) => {
  model.status = 'playing';
  model.distance = 0;
  model.speed = RULES.runSpeed;
  model.speedLevel = 0;
  model.player = createPlayer();
  model.obstacles = [];
  model.coins = [];
  model.coinCount = 0;
  model.bumps = 0;
  model.nextRowZ = RULES.firstRowDistance;
  model.lastRowZ = 12;
  model.coinLane = 0;
  fillObstacles(model);
};

export const pauseModel = (model: Model) => {
  if (model.status !== 'playing') return;
  model.status = 'paused';
};

export const resumeModel = (model: Model) => {
  if (model.status !== 'paused') return;
  model.status = 'playing';
};

export const score = (model: Model) => Math.floor(model.distance) + model.coinCount * RULES.coinScore;

export const isGrounded = (player: Player) => player.y <= player.ground && player.vy <= 0;
export const isSliding = (player: Player) => player.slideTimer > 0;
export const playerHeight = (player: Player) => (isSliding(player) ? RULES.slideHeight : RULES.standHeight);
export const isTrain = (obstacle: Obstacle) => obstacle.kind === 'train' || obstacle.kind === 'movingTrain';

const movingTrainZ = (meetZ: number, distance: number) => meetZ + TRAIN.approachRatio * (meetZ - distance);

export const createObstacle = (id: number, spec: ObstacleSpec, distance: number): Obstacle => {
  const train = spec.kind === 'train' || spec.kind === 'movingTrain';
  const length = train ? (spec.cars ?? 1) * TRAIN.carLength : 0;
  const z = spec.kind === 'movingTrain' ? movingTrainZ(spec.z, distance) : spec.z;
  return {
    id,
    kind: spec.kind,
    lane: spec.lane,
    z,
    length,
    ramp: spec.kind === 'train' && (spec.ramp ?? false),
    meetZ: spec.z
  };
};

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
  if (obstacle.kind !== 'bar') return [];
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

// スロープを含めた電車の手前端と奥の端
export const trainStart = (obstacle: Obstacle) => (obstacle.ramp ? obstacle.z - TRAIN.rampLength : obstacle.z);
export const obstacleEnd = (obstacle: Obstacle) => obstacle.z + obstacle.length;

const overlapsTrainX = (obstacle: Obstacle, x: number) => {
  const cx = laneX(obstacle.lane);
  const half = (TRAIN.width + RULES.playerWidth) / 2;
  return x > cx - half && x < cx + half;
};

// z の位置で電車（屋根・スロープ）の上に乗れる面の高さ。電車が無い位置なら null。走ってくる電車には乗れない。
export const trainSurface = (obstacle: Obstacle, z: number) => {
  if (obstacle.kind !== 'train') return null;
  if (z >= obstacle.z && z <= obstacleEnd(obstacle)) return TRAIN.height;
  if (!obstacle.ramp || z < trainStart(obstacle) || z >= obstacle.z) return null;
  return (TRAIN.height * (z - trainStart(obstacle))) / TRAIN.rampLength;
};

const groundHeight = (model: Model, x: number) => {
  let height = 0;
  for (const obstacle of model.obstacles) {
    if (!overlapsTrainX(obstacle, x)) continue;
    const surface = trainSurface(obstacle, model.distance);
    if (surface !== null && surface > height) height = surface;
  }
  return height;
};

// 電車の車体・スロープが、足元より stepUp 以上高い壁としてプレイヤーをふさいでいるか。
const trainBlocks = (model: Model, obstacle: Obstacle, x: number) => {
  if (!isTrain(obstacle) || !overlapsTrainX(obstacle, x)) return false;
  const { player } = model;
  const halfD = RULES.playerDepth / 2;
  const inBody = model.distance + halfD > obstacle.z && model.distance - halfD < obstacleEnd(obstacle);
  if (inBody && player.y < TRAIN.height - TRAIN.stepUp) return true;
  const surface = trainSurface(obstacle, model.distance);
  return surface !== null && surface - player.y > TRAIN.stepUp;
};

const nearPlayer = (model: Model, obstacle: Obstacle) =>
  model.distance > trainStart(obstacle) - 2 && model.distance < obstacleEnd(obstacle) + 2;

const hitsObstacle = (model: Model) => {
  const box = playerBox(model);
  return model.obstacles.some((obstacle) => {
    if (!nearPlayer(model, obstacle)) return false;
    if (isTrain(obstacle)) return trainBlocks(model, obstacle, model.player.x);
    return obstacleBoxes(obstacle).some((part) => overlaps(box, part));
  });
};

// レーン移動で電車の側面にぶつかったら、ゲームオーバーにせず元のレーンへ押し戻す。
// 移動前から同じ列にいた電車にぶつかった場合は正面衝突として hitsObstacle で扱う。
const bounceOffTrainSide = (model: Model, previousX: number) => {
  const player = model.player;
  const side = model.obstacles.some(
    (obstacle) =>
      nearPlayer(model, obstacle) && !overlapsTrainX(obstacle, previousX) && trainBlocks(model, obstacle, player.x)
  );
  if (!side) return;
  const dir = Math.sign(laneX(player.lane) - previousX);
  const back = player.lane - dir;
  player.x = previousX;
  model.bumps++;
  if (back !== -1 && back !== 0 && back !== 1) return;
  player.lane = back;
};

// 同じレーンで他の障害物と重ならないようにする範囲。走ってくる電車は、これから通り過ぎる範囲も含める。
const occupiedSpan = (obstacle: Obstacle): [number, number] => {
  if (!isTrain(obstacle)) return [obstacle.z - 1, obstacle.z + 1];
  const tail = obstacleEnd(obstacle) + RULES.trainTailGap;
  if (obstacle.kind === 'movingTrain') return [Math.min(obstacle.meetZ, obstacle.z), tail];
  return [trainStart(obstacle), tail];
};

// プレイヤーがそのレーンを走れない区間（走行距離で表す）。スロープ付きの電車も途中から入れないためふさぐ扱いにする。
export const blockedSpan = (obstacle: Obstacle): [number, number] | null => {
  if (!isTrain(obstacle)) return null;
  if (obstacle.kind === 'movingTrain') {
    return [obstacle.meetZ, obstacle.meetZ + obstacle.length / (1 + TRAIN.approachRatio)];
  }
  return [trainStart(obstacle), obstacleEnd(obstacle)];
};

const laneIsFree = (model: Model, lane: Lane, span: [number, number]) =>
  model.obstacles.every((obstacle) => {
    if (obstacle.lane !== lane) return true;
    const [from, to] = occupiedSpan(obstacle);
    return span[1] + RULES.obstacleGap <= from || span[0] - RULES.obstacleGap >= to;
  });

// 新しくレーンをふさいでも詰まないかを確かめる。ふさがるレーンは同時に2本まで。
// 2本になるときは、残った1本が新しくふさぐレーンの隣でなければならない（端のレーンに閉じ込めない）。
const canBlockLane = (model: Model, lane: Lane, span: [number, number]) => {
  const margin = model.speed * RULES.dodgeSeconds;
  const blocked = new Set<Lane>();
  for (const obstacle of model.obstacles) {
    if (obstacle.lane === lane) continue;
    const other = blockedSpan(obstacle);
    if (!other) continue;
    if (other[1] < span[0] - margin || other[0] > span[1] + margin) continue;
    blocked.add(obstacle.lane);
  }
  if (blocked.size === 0) return true;
  if (blocked.size >= 2) return false;
  const free = LANES.find((candidate) => candidate !== lane && !blocked.has(candidate));
  return free !== undefined && Math.abs(free - lane) === 1;
};

const pickLanes = (rng: () => number): Lane[] => {
  const lanes: Lane[] = [...LANES];
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
  const z = model.nextRowZ;
  for (const lane of pickLanes(model.rng)) {
    const kind: ObstacleKind = model.rng() < 0.5 ? 'fence' : 'bar';
    if (!laneIsFree(model, lane, [z - 1, z + 1])) continue;
    model.obstacles.push({ id: model.nextId++, kind, lane, z, length: 0, ramp: false, meetZ: z });
  }
};

const pickTrainSpec = (rng: () => number, lane: Lane, z: number): ObstacleSpec => {
  const roll = rng();
  if (roll < 0.25) return { kind: 'movingTrain', lane, z, cars: 1 + Math.floor(rng() * 2) };
  return { kind: 'train', lane, z, cars: 1 + Math.floor(rng() * 3), ramp: roll < 0.65 };
};

// 1〜2本の電車を置く。置けなかった場合は false を返す。
const spawnTrains = (model: Model) => {
  const count = model.rng() < 0.6 ? 1 : 2;
  const lanes: Lane[] = [...LANES];
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(model.rng() * (i + 1));
    [lanes[i], lanes[j]] = [lanes[j], lanes[i]];
  }
  let placed = 0;
  for (const lane of lanes) {
    if (placed >= count) break;
    const candidate = createObstacle(model.nextId, pickTrainSpec(model.rng, lane, model.nextRowZ), model.distance);
    const span = blockedSpan(candidate);
    if (!span) continue;
    if (!laneIsFree(model, lane, occupiedSpan(candidate))) continue;
    if (!canBlockLane(model, lane, span)) continue;
    model.obstacles.push(candidate);
    model.nextId++;
    placed++;
  }
  return placed > 0;
};

// コインを置く高さ。柵・バーの近くや、電車の中になる位置には置かない。
const coinHeight = (model: Model, lane: Lane, z: number) => {
  let height = 0;
  for (const obstacle of model.obstacles) {
    if (obstacle.lane !== lane) continue;
    if (!isTrain(obstacle)) {
      if (Math.abs(obstacle.z - z) < 2.5) return null;
      continue;
    }
    if (obstacle.kind === 'movingTrain') {
      if (z > obstacle.meetZ - 2 && z < obstacleEnd(obstacle) + 2) return null;
      continue;
    }
    if (!obstacle.ramp && z > obstacle.z - 3 && z <= obstacleEnd(obstacle)) return null;
    const surface = trainSurface(obstacle, z);
    if (surface !== null) height = Math.max(height, surface);
  }
  return height + COIN.lift;
};

// 直前の列からこの列までの区間に、1レーンぶんのコインを並べる。
const spawnCoins = (model: Model, from: number, to: number) => {
  if (model.rng() > RULES.coinChance) return;
  if (model.rng() < RULES.coinLaneChangeChance) model.coinLane = LANES[Math.floor(model.rng() * 3)];
  const lane = model.coinLane;
  for (let z = from + 3; z <= to - 3; z += RULES.coinSpacing) {
    const y = coinHeight(model, lane, z);
    if (y === null) continue;
    model.coins.push({ id: model.nextId++, lane, z, y });
  }
};

const spawnSection = (model: Model) => {
  const placedTrain = model.rng() < RULES.trainRowChance && spawnTrains(model);
  if (!placedTrain) spawnRow(model);
  spawnCoins(model, model.lastRowZ, model.nextRowZ);
  model.lastRowZ = model.nextRowZ;
  const gapSeconds = RULES.rowGapMinSeconds + model.rng() * (RULES.rowGapMaxSeconds - RULES.rowGapMinSeconds);
  model.nextRowZ += gapSeconds * model.speed;
};

const fillObstacles = (model: Model) => {
  while (model.nextRowZ < model.distance + RULES.spawnAhead) spawnSection(model);
  const behind = model.distance - RULES.despawnBehind;
  model.obstacles = model.obstacles.filter((obstacle) => obstacleEnd(obstacle) > behind);
  model.coins = model.coins.filter((coin) => coin.z > behind);
};

const approach = (value: number, target: number, maxDelta: number) => {
  if (Math.abs(target - value) <= maxDelta) return target;
  return value + Math.sign(target - value) * maxDelta;
};

const stepPlayer = (model: Model, dt: number) => {
  const player = model.player;
  const previousX = player.x;
  player.x = approach(player.x, laneX(player.lane), RULES.laneChangeSpeed * dt);
  if (player.x !== previousX) bounceOffTrainSide(model, previousX);

  if (player.slideTimer > 0) player.slideTimer = Math.max(0, player.slideTimer - dt);

  const ground = groundHeight(model, player.x);
  player.ground = ground;
  if (player.y > ground || player.vy > 0) {
    player.vy -= RULES.gravity * dt;
    player.y += player.vy * dt;
  }
  if (player.y > ground) return;
  // 乗り上がれない高さの差は壁にぶつかったとみなし、hitsObstacle に任せる。
  if (ground - player.y > TRAIN.stepUp) return;
  player.y = ground;
  player.vy = 0;
  if (!player.slideOnLand) return;
  player.slideOnLand = false;
  player.slideTimer = RULES.slideDuration;
};

const moveTrains = (model: Model) => {
  for (const obstacle of model.obstacles) {
    if (obstacle.kind !== 'movingTrain') continue;
    obstacle.z = movingTrainZ(obstacle.meetZ, model.distance);
  }
};

const collectCoins = (model: Model) => {
  const player = model.player;
  const top = player.y + playerHeight(player);
  const before = model.coins.length;
  model.coins = model.coins.filter(
    (coin) =>
      Math.abs(coin.z - model.distance) >= COIN.pickZ ||
      Math.abs(laneX(coin.lane) - player.x) >= COIN.pickX ||
      coin.y < player.y - 0.3 ||
      coin.y > top + 0.3
  );
  const gained = before - model.coins.length;
  if (gained === 0) return;
  model.coinCount += gained;
  const level = Math.min(RULES.maxSpeedLevel, Math.floor(model.coinCount / RULES.coinsPerSpeedUp));
  if (level <= model.speedLevel) return;
  model.speedLevel = level;
  model.speed = RULES.runSpeed + level * RULES.speedStep;
};

// フレーム時間が大きくても障害物をすり抜けないよう、細かいサブステップに分けて進める。
export const stepModel = (model: Model, frameDt: number) => {
  if (model.status !== 'playing') return;
  let remaining = Math.min(Math.max(frameDt, 0), RULES.maxFrame);
  while (remaining > 0) {
    const dt = Math.min(remaining, RULES.maxStep);
    remaining -= dt;
    model.distance += model.speed * dt;
    moveTrains(model);
    stepPlayer(model, dt);
    if (hitsObstacle(model)) {
      model.status = 'over';
      break;
    }
    collectCoins(model);
  }
  fillObstacles(model);
};
