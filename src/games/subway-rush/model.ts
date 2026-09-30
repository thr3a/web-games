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
  // パターン同士のつなぎ目の余白（秒）。屋根から降りたあとの着地の余白も兼ねる。
  patternGapSeconds: 1.0,
  // 屋根の大通りで横に並ぶ電車の最短の長さ（秒）
  avenueSeconds: 2,
  // 同じレーンで縦に連ねる電車の隙間（秒）。0.2 秒あれば、歩いて落ちたときに屋根へ戻れない深さまで落ちる。
  hopGapMinSeconds: 0.2,
  hopGapMaxSeconds: 0.3,
  // 貨車の長さ（秒）。地面から乗ったあと、屋根へ飛び移るジャンプの踏み切りが間に合う長さ。
  wagonSeconds: 1.0,
  // 走ってくる電車の後ろに、同じレーンで次の障害物を置かない幅
  trainTailGap: 8,
  coinSpacing: 2.2,
  // 同じレーンに途切れず並べるコインの枚数と、次の列までに空けるコインの枚数
  coinLineMin: 5,
  coinLineMax: 10,
  coinLineGap: 3,
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

export const WAGON = {
  // 荷台の高さ。地面からのジャンプで乗れ、ここからのジャンプで電車の屋根に届く。
  height: 1.4,
  carLength: 8
};

export const COIN = {
  radius: 0.42,
  // 足場からコインの中心までの高さ
  lift: 0.9,
  pickX: 0.85,
  pickZ: 0.8
};

export type Lane = -1 | 0 | 1;
export type GameStatus = 'ready' | 'playing' | 'paused' | 'over';
export type ObstacleKind = 'fence' | 'bar' | 'train' | 'movingTrain' | 'wagon';
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
// x はレーンの中心とは限らない（レーンをまたぐ斜めの列では、レーンの間にも置く）。
export type Coin = { id: number; x: number; z: number; y: number };
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
  // 次のパターンを置き始める位置
  nextPatternZ: number;
  // レーンごとに最後に置いたコインの位置（添字は lane + 1）。同じレーンでコインの列がつながりすぎないようにする。
  coinTails: number[];
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
  nextPatternZ: RULES.firstRowDistance,
  coinTails: [-Infinity, -Infinity, -Infinity],
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
  model.nextPatternZ = RULES.firstRowDistance;
  model.coinTails = [-Infinity, -Infinity, -Infinity];
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
// 電車・貨車のように、長さを持ち、正面が壁になる車両か
export const isVehicle = (obstacle: Obstacle) =>
  obstacle.kind === 'train' || obstacle.kind === 'movingTrain' || obstacle.kind === 'wagon';
export const vehicleHeight = (obstacle: Obstacle) => (obstacle.kind === 'wagon' ? WAGON.height : TRAIN.height);

const movingTrainZ = (meetZ: number, distance: number) => meetZ + TRAIN.approachRatio * (meetZ - distance);

const carLength = (kind: ObstacleKind) => {
  if (kind === 'wagon') return WAGON.carLength;
  if (kind === 'train' || kind === 'movingTrain') return TRAIN.carLength;
  return 0;
};

export const createObstacle = (id: number, spec: ObstacleSpec, distance: number): Obstacle => {
  const length = (spec.cars ?? 1) * carLength(spec.kind);
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
  if (obstacle.kind !== 'train' && obstacle.kind !== 'wagon') return null;
  if (z >= obstacle.z && z <= obstacleEnd(obstacle)) return vehicleHeight(obstacle);
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
  if (!isVehicle(obstacle) || !overlapsTrainX(obstacle, x)) return false;
  const { player } = model;
  const halfD = RULES.playerDepth / 2;
  const inBody = model.distance + halfD > obstacle.z && model.distance - halfD < obstacleEnd(obstacle);
  if (inBody && player.y < vehicleHeight(obstacle) - TRAIN.stepUp) return true;
  const surface = trainSurface(obstacle, model.distance);
  return surface !== null && surface - player.y > TRAIN.stepUp;
};

const nearPlayer = (model: Model, obstacle: Obstacle) =>
  model.distance > trainStart(obstacle) - 2 && model.distance < obstacleEnd(obstacle) + 2;

const hitsObstacle = (model: Model) => {
  const box = playerBox(model);
  return model.obstacles.some((obstacle) => {
    if (!nearPlayer(model, obstacle)) return false;
    if (isVehicle(obstacle)) return trainBlocks(model, obstacle, model.player.x);
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

// 走ってくる電車がこれから通り過ぎる範囲。同じレーンのこの範囲には、あとから障害物やコインを置かない。
// 走ってくる電車は z が手前へ動くため、生成するたびに今の位置から求め直す。
const sweptSpan = (obstacle: Obstacle): [number, number] => [
  Math.min(obstacle.meetZ, obstacle.z) - 2,
  obstacleEnd(obstacle) + RULES.trainTailGap
];

// 同じレーンで走ってくる電車と重ならないかを確かめるときの範囲
const occupiedSpan = (obstacle: Obstacle): [number, number] => {
  if (obstacle.kind === 'movingTrain') return sweptSpan(obstacle);
  if (isVehicle(obstacle)) return [trainStart(obstacle), obstacleEnd(obstacle)];
  return [obstacle.z - 1, obstacle.z + 1];
};

// プレイヤーがそのレーンを走れない区間（走行距離で表す）。スロープ付きの電車も途中から入れないためふさぐ扱いにする。
export const blockedSpan = (obstacle: Obstacle): [number, number] | null => {
  if (!isVehicle(obstacle)) return null;
  if (obstacle.kind === 'movingTrain') {
    return [obstacle.meetZ, obstacle.meetZ + obstacle.length / (1 + TRAIN.approachRatio)];
  }
  return [trainStart(obstacle), obstacleEnd(obstacle)];
};

const spansOverlap = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

// 走ってくる電車の通り道と、同じレーンの障害物が重なるか
const clashes = (model: Model, obstacle: Obstacle) =>
  model.obstacles.some(
    (other) =>
      other.lane === obstacle.lane &&
      (other.kind === 'movingTrain' || obstacle.kind === 'movingTrain') &&
      spansOverlap(occupiedSpan(other), occupiedSpan(obstacle))
  );

const pick = <T>(rng: () => number, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const randomBetween = (rng: () => number, min: number, max: number) => min + rng() * (max - min);

const EDGE_LANES: Lane[] = [-1, 1];
const ADJACENT_PAIRS: Lane[][] = [
  [-1, 0],
  [0, 1]
];

const mirrorLane = (lane: Lane): Lane => {
  if (lane === 0) return 0;
  return lane === 1 ? -1 : 1;
};

const nearestLane = (x: number): Lane =>
  LANES.reduce((best, lane) => (Math.abs(laneX(lane) - x) < Math.abs(laneX(best) - x) ? lane : best));

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

// 足場から rise だけ高い面へ、ジャンプの頂点を越えて下りながら着地するまでの時間
export const airTime = (rise: number) => {
  const v = RULES.jumpVelocity;
  return (v + Math.sqrt(v * v - 2 * RULES.gravity * rise)) / RULES.gravity;
};

type CoinPoint = { x: number; z: number; y: number };
// パターン1つぶんの下書き。end はこの区間でプレイヤーの動きを縛る最後の位置で、その先に余白を空けて次のパターンを置く。
type Draft = { obstacles: Obstacle[]; lines: CoinPoint[][]; end: number };
type PatternContext = {
  rng: () => number;
  distance: number;
  // 生成時点の速度。ジャンプの軌道（コインの弧）はこの速度で求める。
  speed: number;
  // 次の段階の速度。先読みしている間に加速しても足りるよう、最低限の長さはこの速度で確保する。
  next: number;
  z: number;
};
type Pattern = (ctx: PatternContext) => Draft;

// 同じレーンのコインの列と列の間に空ける距離（コイン3枚ぶんの空きを作る）
const COIN_LINE_STEP = (RULES.coinLineGap + 1) * RULES.coinSpacing;

const place = (ctx: PatternContext, spec: ObstacleSpec) => createObstacle(0, spec, ctx.distance);
const rowGap = (ctx: PatternContext) =>
  randomBetween(ctx.rng, RULES.rowGapMinSeconds, RULES.rowGapMaxSeconds) * ctx.speed;
const carsFor = (length: number, unit: number) => Math.ceil(length / unit);
const lastZ = (line: CoinPoint[]) => line[line.length - 1].z;
const randomFence = (ctx: PatternContext, lane: Lane, z: number) =>
  place(ctx, { kind: ctx.rng() < 0.5 ? 'fence' : 'bar', lane, z });

const surfaceAt = (obstacles: Obstacle[], lane: Lane, z: number) =>
  obstacles.reduce((height, obstacle) => {
    if (obstacle.lane !== lane) return height;
    return Math.max(height, trainSurface(obstacle, z) ?? 0);
  }, 0);

// 足場（地面・スロープ・屋根）に沿った直線の列
const straightCoins = (obstacles: Obstacle[], lane: Lane, from: number, count: number): CoinPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const z = from + i * RULES.coinSpacing;
    return { x: laneX(lane), z, y: surfaceAt(obstacles, lane, z) + COIN.lift };
  });

// from のレーンから始まり、途中の数枚でレーンをまたいで to のレーンへ移る斜めの列
const diagonalCoins = (obstacles: Obstacle[], from: Lane, to: Lane, start: number, count: number): CoinPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const z = start + i * RULES.coinSpacing;
    const t = Math.min(1, Math.max(0, (i - 2) / 3));
    const base = Math.max(surfaceAt(obstacles, from, z), surfaceAt(obstacles, to, z));
    return { x: laneX(from) + (laneX(to) - laneX(from)) * t, z, y: base + COIN.lift };
  });

// takeoff で踏み切ったジャンプの軌道に沿った弧。高さ base の面から跳び、高さ land の面に着地するまで。
const arcCoins = (lane: Lane, takeoff: number, base: number, land: number, speed: number): CoinPoint[] => {
  const duration = airTime(land - base);
  const count = Math.min(
    RULES.coinLineMax,
    Math.max(RULES.coinLineMin, Math.round((duration * speed) / RULES.coinSpacing) + 1)
  );
  return Array.from({ length: count }, (_, i) => {
    const t = (duration * i) / (count - 1);
    const rise = RULES.jumpVelocity * t - (RULES.gravity * t * t) / 2;
    return { x: laneX(lane), z: takeoff + speed * t, y: base + rise + COIN.lift };
  });
};

// from から to までを、間を空けた直線の列で埋める。
const fillCoins = (obstacles: Obstacle[], lane: Lane, from: number, to: number) => {
  const lines: CoinPoint[][] = [];
  let z = from;
  let count = Math.min(RULES.coinLineMax, Math.floor((to - z) / RULES.coinSpacing) + 1);
  while (count >= RULES.coinLineMin) {
    const line = straightCoins(obstacles, lane, z, count);
    lines.push(line);
    z = lastZ(line) + COIN_LINE_STEP;
    count = Math.min(RULES.coinLineMax, Math.floor((to - z) / RULES.coinSpacing) + 1);
  }
  return lines;
};

// 屋根の上を走り回るコインの道。ときどき隣の屋根へ斜めに移り、レーン移動を誘う。
const roofCoins = (ctx: PatternContext, trains: Obstacle[], startLane: Lane, from: number, to: number) => {
  const lanes = trains.map((train) => train.lane);
  const lines: CoinPoint[][] = [];
  let lane = startLane;
  let z = from;
  let room = Math.min(RULES.coinLineMax, Math.floor((to - z) / RULES.coinSpacing) + 1);
  while (room >= RULES.coinLineMin) {
    const neighbors = lanes.filter((other) => Math.abs(other - lane) === 1);
    const shift = lines.length > 0 && neighbors.length > 0 && room >= 8 && ctx.rng() < 0.5;
    const target = shift ? pick(ctx.rng, neighbors) : lane;
    const line = shift ? diagonalCoins(trains, lane, target, z, 8) : straightCoins(trains, lane, z, room);
    lines.push(line);
    lane = target;
    z = lastZ(line) + COIN_LINE_STEP;
    room = Math.min(RULES.coinLineMax, Math.floor((to - z) / RULES.coinSpacing) + 1);
  }
  return lines;
};

// 屋根ルートの横の地上に置く柵・バー。地上も通れるが、屋根の上より忙しくする。
const groundHazards = (ctx: PatternContext, lanes: Lane[], from: number, to: number) => {
  const hazards: Obstacle[] = [];
  for (let z = from + rowGap(ctx) / 2; z < to; z += rowGap(ctx)) {
    for (const lane of lanes) {
      if (ctx.rng() < 0.5) continue;
      hazards.push(randomFence(ctx, lane, z));
    }
  }
  return hazards;
};

// 地上の柵・バー: 柵とバーの列を数列続ける。コインは柵の上に弧、何もないレーンに直線で置く。
const groundPattern: Pattern = (ctx) => {
  const obstacles: Obstacle[] = [];
  const lines: CoinPoint[][] = [];
  const rows = 2 + Math.floor(ctx.rng() * 3);
  const flight = airTime(0) * ctx.speed;
  let coinLane = pick(ctx.rng, LANES);
  let z = ctx.z;
  for (let i = 0; i < rows; i++) {
    if (i > 0) z += rowGap(ctx);
    const rowZ = z;
    const row = pickLanes(ctx.rng).map((lane) => randomFence(ctx, lane, rowZ));
    obstacles.push(...row);
    if (ctx.rng() < 0.35) coinLane = pick(ctx.rng, LANES);
    const here = row.find((obstacle) => obstacle.lane === coinLane);
    if (here?.kind === 'fence') lines.push(arcCoins(coinLane, z - flight / 2, 0, 0, ctx.speed));
    if (here) continue;
    const count = 5 + Math.floor(ctx.rng() * 3);
    lines.push(straightCoins(obstacles, coinLane, z - ((count - 1) * RULES.coinSpacing) / 2, count));
  }
  return { obstacles, lines, end: z + 1 };
};

// 屋根の大通り: 長い停車電車を横並びにし、屋根の上を左右に走り回れるようにする。
const avenuePattern: Pattern = (ctx) => {
  const lanes = ctx.rng() < 0.5 ? LANES : pick(ctx.rng, ADJACENT_PAIRS);
  // 並走区間は 2 秒以上。速度が上がったら両数を増やして秒数を保つ。
  const cars = Math.max(3 + Math.floor(ctx.rng() * 3), carsFor(RULES.avenueSeconds * ctx.next, TRAIN.carLength));
  const z = ctx.z + TRAIN.rampLength;
  // 3レーンともふさぐときは、どのレーンからも1回の移動で届く中央に必ずスロープを付ける。
  const rampLane = lanes.length === 3 ? 0 : pick(ctx.rng, lanes);
  const trains = lanes.map((lane) =>
    place(ctx, { kind: 'train', lane, z, cars, ramp: lane === rampLane || ctx.rng() < 0.4 })
  );
  const end = z + cars * TRAIN.carLength;
  const free = LANES.filter((lane) => !lanes.includes(lane));
  return {
    obstacles: [...trains, ...groundHazards(ctx, free, z, end)],
    lines: roofCoins(ctx, trains, rampLane, ctx.z + 1, end - 1),
    end
  };
};

// 屋根の飛び移り: 同じレーンに停車電車を、ジャンプで越せる隙間を空けて縦に連ねる。
const hopPattern: Pattern = (ctx) => {
  const lane = pick(ctx.rng, LANES);
  const trains: Obstacle[] = [];
  const count = 2 + Math.floor(ctx.rng() * 2);
  let z = ctx.z + TRAIN.rampLength;
  for (let i = 0; i < count; i++) {
    const cars = Math.max(2 + Math.floor(ctx.rng() * 2), carsFor(0.8 * ctx.next, TRAIN.carLength));
    const train = place(ctx, { kind: 'train', lane, z, cars, ramp: i === 0 });
    trains.push(train);
    // 加速しても隙間が 0.2 秒を切らないよう、下限は次の段階の速度で取る。
    const gap = randomBetween(ctx.rng, RULES.hopGapMinSeconds, RULES.hopGapMaxSeconds) * ctx.speed;
    z = obstacleEnd(train) + Math.max(RULES.hopGapMinSeconds * ctx.next, gap);
  }
  const end = obstacleEnd(trains[trains.length - 1]);
  // 隙間の真ん中がジャンプの頂点になる弧を置き、ジャンプの合図にする。
  const flight = airTime(0) * ctx.speed;
  const lines: CoinPoint[][] = [];
  let from = ctx.z + 1;
  for (let i = 1; i < trains.length; i++) {
    const center = (obstacleEnd(trains[i - 1]) + trains[i].z) / 2;
    const arc = arcCoins(lane, center - flight / 2, TRAIN.height, TRAIN.height, ctx.speed);
    lines.push(...fillCoins(trains, lane, from, arc[0].z - COIN_LINE_STEP), arc);
    from = lastZ(arc) + COIN_LINE_STEP;
  }
  lines.push(...fillCoins(trains, lane, from, end - 1));
  const others = LANES.filter((other) => other !== lane);
  return { obstacles: [...trains, ...groundHazards(ctx, others, ctx.z, end)], lines, end };
};

// 屋根の乗り換え: 端のレーンの電車が先に終わり、中央の電車が続く。先に終わる屋根から横の屋根へ乗り換える。
// 後から始まる電車を中央に置くのは、地上で端のレーンに閉じ込めないため（反対の端の逃げ道が中央と隣り合う）。
const transferPattern: Pattern = (ctx) => {
  const first = pick(ctx.rng, EDGE_LANES);
  const second: Lane = 0;
  const lead = place(ctx, {
    kind: 'train',
    lane: first,
    z: ctx.z + TRAIN.rampLength,
    cars: Math.max(2, carsFor(1.6 * ctx.next, TRAIN.carLength)),
    ramp: true
  });
  const followZ = lead.z + Math.max(TRAIN.carLength / 2, 0.5 * ctx.speed);
  const followEnd = obstacleEnd(lead) + 1.2 * ctx.next;
  const follow = place(ctx, {
    kind: 'train',
    lane: second,
    z: followZ,
    cars: carsFor(followEnd - followZ, TRAIN.carLength)
  });
  const trains = [lead, follow];
  const end = obstacleEnd(follow);
  const lines = [straightCoins(trains, first, ctx.z + 1, RULES.coinLineMax)];
  // 両方の屋根が並んでいる区間で、斜めの列を使って乗り換えを誘う。
  const shiftZ = Math.max(lastZ(lines[0]) + COIN_LINE_STEP, follow.z + 1);
  const shift =
    shiftZ + 5 * RULES.coinSpacing <= obstacleEnd(lead) ? diagonalCoins(trains, first, second, shiftZ, 8) : null;
  if (shift) lines.push(shift);
  lines.push(...fillCoins(trains, second, shift ? lastZ(shift) + COIN_LINE_STEP : follow.z + 1, end - 1));
  return { obstacles: [...trains, ...groundHazards(ctx, [mirrorLane(first)], ctx.z, end)], lines, end };
};

// 貨車の階段: 貨車の直後にスロープのない停車電車を置き、地面 → 貨車 → 屋根 とジャンプで上がらせる。
const stairsPattern: Pattern = (ctx) => {
  const lane = pick(ctx.rng, LANES);
  // 踏み切りは段の手前 0.3 秒。上の段に届く高さにいる時間帯（約 0.1〜0.55 秒）の中ほどで段の端を越える。
  const lead = 0.3 * ctx.speed;
  const wagon = place(ctx, {
    kind: 'wagon',
    lane,
    z: ctx.z + lead + 1,
    cars: Math.max(2, carsFor(RULES.wagonSeconds * ctx.next, WAGON.carLength))
  });
  const train = place(ctx, {
    kind: 'train',
    lane,
    z: obstacleEnd(wagon),
    cars: Math.max(2 + Math.floor(ctx.rng() * 2), carsFor(0.8 * ctx.next, TRAIN.carLength))
  });
  const vehicles = [wagon, train];
  const end = obstacleEnd(train);
  const climb = arcCoins(lane, wagon.z - lead, 0, WAGON.height, ctx.speed);
  const hop = arcCoins(lane, train.z - lead, WAGON.height, TRAIN.height, ctx.speed);
  const lines = [climb, hop, ...fillCoins(vehicles, lane, lastZ(hop) + COIN_LINE_STEP, end - 1)];
  const others = LANES.filter((other) => other !== lane);
  return { obstacles: [...vehicles, ...groundHazards(ctx, others, ctx.z, end)], lines, end };
};

// 飛び降り: 屋根ルートの終わりの先に、柵・バーの列か走ってくる電車を置く。
const dropPattern: Pattern = (ctx) => {
  const lanes = ctx.rng() < 0.5 ? [pick(ctx.rng, LANES)] : pick(ctx.rng, ADJACENT_PAIRS);
  const cars = Math.max(2, carsFor(1.5 * ctx.next, TRAIN.carLength));
  const z = ctx.z + TRAIN.rampLength;
  const trains = lanes.map((lane) => place(ctx, { kind: 'train', lane, z, cars, ramp: true }));
  const roofEnd = z + cars * TRAIN.carLength;
  const lines = roofCoins(ctx, trains, lanes[0], ctx.z + 1, roofEnd - 1);
  // 屋根から降りて着地し、体勢を立て直す余白を空けてから置く。
  const landing = roofEnd + RULES.patternGapSeconds * ctx.next;
  if (ctx.rng() < 0.5) {
    const oncoming = place(ctx, {
      kind: 'movingTrain',
      lane: pick(ctx.rng, lanes),
      z: landing,
      cars: 1 + Math.floor(ctx.rng() * 2)
    });
    return { obstacles: [...trains, oncoming], lines, end: blockedSpan(oncoming)?.[1] ?? landing };
  }
  const row = pickLanes(ctx.rng).map((lane) => randomFence(ctx, lane, landing));
  return { obstacles: [...trains, ...row], lines, end: landing + 1 };
};

// 走ってくる電車: 端のレーンの停車電車の横を、走ってくる電車が通り過ぎる。屋根の上からは見送れる。
// 停車電車を端に置くのは、地上の逃げ道のレーンが走ってくる電車のレーンと必ず隣り合うようにするため。
const movingPattern: Pattern = (ctx) => {
  const parked = pick(ctx.rng, EDGE_LANES);
  const lane = ctx.rng() < 0.5 ? 0 : mirrorLane(parked);
  const free = LANES.find((other) => other !== parked && other !== lane) ?? 0;
  const train = place(ctx, {
    kind: 'train',
    lane: parked,
    z: ctx.z + TRAIN.rampLength,
    cars: Math.max(2, carsFor(1.5 * ctx.next, TRAIN.carLength)),
    ramp: true
  });
  const meetZ = train.z + randomBetween(ctx.rng, 0.3, 0.7) * train.length;
  const oncoming = place(ctx, { kind: 'movingTrain', lane, z: meetZ, cars: 1 + Math.floor(ctx.rng() * 2) });
  const lines = [
    ...fillCoins([train], parked, ctx.z + 1, obstacleEnd(train) - 1),
    straightCoins([], free, meetZ - 3 * RULES.coinSpacing, 6)
  ];
  const end = Math.max(obstacleEnd(train), blockedSpan(oncoming)?.[1] ?? meetZ);
  return { obstacles: [train, oncoming], lines, end };
};

const PATTERNS: { pattern: Pattern; weight: number }[] = [
  { pattern: groundPattern, weight: 0.2 },
  { pattern: avenuePattern, weight: 0.17 },
  { pattern: hopPattern, weight: 0.14 },
  { pattern: transferPattern, weight: 0.13 },
  { pattern: stairsPattern, weight: 0.12 },
  { pattern: dropPattern, weight: 0.12 },
  { pattern: movingPattern, weight: 0.12 }
];

const pickPattern = (rng: () => number) => {
  const total = PATTERNS.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of PATTERNS) {
    roll -= entry.weight;
    if (roll < 0) return entry.pattern;
  }
  return groundPattern;
};

const mirrorDraft = (draft: Draft): Draft => ({
  obstacles: draft.obstacles.map((obstacle) => ({ ...obstacle, lane: mirrorLane(obstacle.lane) })),
  lines: draft.lines.map((line) => line.map((coin) => ({ ...coin, x: -coin.x }))),
  end: draft.end
});

// コインが柵・バーや車両にめり込まず、走ってくる電車の通り道にもないか
const coinFits = (model: Model, coin: CoinPoint) =>
  model.obstacles.every((obstacle) => {
    if (Math.abs(laneX(obstacle.lane) - coin.x) >= RULES.laneWidth / 2 + COIN.radius) return true;
    if (obstacle.kind === 'movingTrain') {
      const [from, to] = sweptSpan(obstacle);
      return coin.z < from || coin.z > to;
    }
    const bottom = coin.y - COIN.radius;
    if (!isVehicle(obstacle)) {
      if (Math.abs(obstacle.z - coin.z) >= 1.5) return true;
      return bottom > (obstacle.kind === 'fence' ? OBSTACLE.fenceHeight + 0.2 : OBSTACLE.barTop);
    }
    const top = Math.max(...[-COIN.radius, 0, COIN.radius].map((dz) => trainSurface(obstacle, coin.z + dz) ?? 0));
    return bottom >= top - 0.05;
  });

// コインの列を置く。枚数・めり込み・同じレーンの前の列との間隔のどれかを満たさない列は、丸ごと置かない。
const commitCoins = (model: Model, line: CoinPoint[]) => {
  if (line.length < RULES.coinLineMin || line.length > RULES.coinLineMax) return;
  if (!line.every((coin) => coinFits(model, coin))) return;
  const firsts = new Map<Lane, number>();
  const lasts = new Map<Lane, number>();
  for (const coin of line) {
    const lane = nearestLane(coin.x);
    if (!firsts.has(lane)) firsts.set(lane, coin.z);
    lasts.set(lane, coin.z);
  }
  for (const [lane, z] of firsts) {
    if (z - model.coinTails[lane + 1] < COIN_LINE_STEP - 1e-6) return;
  }
  for (const coin of line) model.coins.push({ id: model.nextId++, ...coin });
  for (const [lane, z] of lasts) model.coinTails[lane + 1] = z;
};

// 下書きのパターンをコースに置く。車両が走ってくる電車の通り道とぶつかるときは何も置かずに false を返す。
// 柵・バーは取り除いても通れなくなることはないため、ぶつかるものだけ取り除く。
const commitDraft = (model: Model, draft: Draft, gap: number) => {
  if (draft.obstacles.some((obstacle) => isVehicle(obstacle) && clashes(model, obstacle))) return false;
  for (const obstacle of draft.obstacles) {
    if (clashes(model, obstacle)) continue;
    model.obstacles.push({ ...obstacle, id: model.nextId++ });
  }
  const lines = draft.lines.filter((line) => line.length > 0).sort((a, b) => a[0].z - b[0].z);
  for (const line of lines) commitCoins(model, line);
  model.nextPatternZ = draft.end + gap;
  return true;
};

// パターンを1つ選んで置く。走ってくる電車とぶつかって置けなければ左右反転を試し、それも駄目なら柵・バーだけのパターンにする。
const spawnPattern = (model: Model) => {
  const maxSpeed = RULES.runSpeed + RULES.maxSpeedLevel * RULES.speedStep;
  const ctx: PatternContext = {
    rng: model.rng,
    distance: model.distance,
    speed: model.speed,
    next: Math.min(model.speed + RULES.speedStep, maxSpeed),
    z: model.nextPatternZ
  };
  const gap = RULES.patternGapSeconds * ctx.next;
  const draft = pickPattern(model.rng)(ctx);
  if (commitDraft(model, draft, gap)) return;
  if (commitDraft(model, mirrorDraft(draft), gap)) return;
  commitDraft(model, groundPattern(ctx), gap);
};

const fillObstacles = (model: Model) => {
  while (model.nextPatternZ < model.distance + RULES.spawnAhead) spawnPattern(model);
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
      Math.abs(coin.x - player.x) >= COIN.pickX ||
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
