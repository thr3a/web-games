// 渋谷スクランブル交差点シミュレーターのロジック（three.js には依存しない）。
// 座標は 1 単位 = 約 1m。x が東、z が南、交差点の中心が原点。
// 道路 A は東西（道玄坂 ↔ 旧大山街道）、道路 B は南北（神宮通り）。日本なので車は左側通行。
// 道路や横断歩道の形は layout.ts にある。車線・線路は折れ線で、車や電車は折れ線上の距離 s で動く。

import {
  type Axis,
  CORNERS,
  type Corner,
  type CornerId,
  type CrosswalkEnd,
  cornerOf,
  createPolyline,
  crosswalkEndPoint,
  crosswalkOf,
  type Dir,
  JUNCTION,
  LANE_SPECS,
  offsetPoints,
  type Polyline,
  pointInPolygon,
  STATION_Z,
  sampleAt,
  TRACKS,
  type Vec
} from './layout';
import { OSM_BUILDINGS } from './osm';

export type { Axis, Dir, Vec };

export const LAYOUT = {
  // 高架線路のレールの高さ
  railY: 8
};

export const SIGNAL = {
  carAGreen: 18,
  carBGreen: 14,
  yellow: 3,
  // 全赤は最低 allRed 秒。交差点の中に車が残っていれば、出きるまで（最長 allRedMax 秒）続ける。
  allRed: 2,
  allRedMax: 10,
  walk: 20,
  walkFlash: 6,
  // 歩行者信号が赤になったあと、渡りきるのを待つ全赤時間
  walkClearMin: 2,
  walkClearMax: 15,
  // 青の残りがこれより短ければ、新しく渡り始めない
  walkStartMargin: 3
};

export type Phase = 'carA' | 'yellowA' | 'redA' | 'carB' | 'yellowB' | 'redB' | 'walk' | 'flash' | 'clear';
export type CarLight = 'green' | 'yellow' | 'red';
export type PedLight = 'green' | 'flash' | 'red';
export type Signal = { phase: Phase; elapsed: number };

const NEXT_PHASE: Record<Phase, Phase> = {
  carA: 'yellowA',
  yellowA: 'redA',
  redA: 'carB',
  carB: 'yellowB',
  yellowB: 'redB',
  redB: 'walk',
  walk: 'flash',
  flash: 'clear',
  clear: 'carA'
};

const PHASE_DURATION: Record<Phase, number> = {
  carA: SIGNAL.carAGreen,
  yellowA: SIGNAL.yellow,
  redA: SIGNAL.allRed,
  carB: SIGNAL.carBGreen,
  yellowB: SIGNAL.yellow,
  redB: SIGNAL.allRed,
  walk: SIGNAL.walk,
  flash: SIGNAL.walkFlash,
  clear: SIGNAL.walkClearMax
};

export const carLight = (signal: Signal, axis: Axis): CarLight => {
  const green = axis === 'A' ? 'carA' : 'carB';
  const yellow = axis === 'A' ? 'yellowA' : 'yellowB';
  if (signal.phase === green) return 'green';
  if (signal.phase === yellow) return 'yellow';
  return 'red';
};

export const pedLight = (signal: Signal): PedLight => {
  if (signal.phase === 'walk') return 'green';
  if (signal.phase === 'flash') return 'flash';
  return 'red';
};

// 画面表示用の大きな区切り。1: 車 A 方向、2: 車 B 方向、3: 歩行者スクランブル。
export const majorPhase = (signal: Signal): 1 | 2 | 3 => {
  if (signal.phase === 'carA' || signal.phase === 'yellowA' || signal.phase === 'redA') return 1;
  if (signal.phase === 'carB' || signal.phase === 'yellowB' || signal.phase === 'redB') return 2;
  return 3;
};

// ---------------------------------------------------------------- 車

export type CarKind = 'sedan' | 'taxi' | 'bus';
export type Car = {
  id: number;
  kind: CarKind;
  // 出現位置からの走行距離（車の中心）
  s: number;
  v: number;
  v0: number;
  length: number;
  // 停止線を越えた、または黄信号で止まれないと判断した車は信号を見ない
  committed: boolean;
  look: number;
};
export type Lane = {
  axis: Axis;
  dir: Dir;
  line: Polyline;
  // 停止線の位置（車線の始点からの距離）
  stopS: number;
  // 交差点と横断歩道を出きった位置
  clearS: number;
  cars: Car[];
  spawnTimer: number;
  spawnMean: number;
};

export const CAR_SPECS: Record<CarKind, { length: number; width: number; speed: number; accel: number }> = {
  sedan: { length: 4.4, width: 1.75, speed: 11, accel: 1.8 },
  taxi: { length: 4.6, width: 1.75, speed: 11, accel: 1.8 },
  bus: { length: 10.5, width: 2.5, speed: 8.5, accel: 1.1 }
};

export const CAR_RULES = {
  maxCars: 140,
  // IDM（Intelligent Driver Model）の定数
  minGap: 2.2,
  headway: 1.1,
  comfortBrake: 3,
  maxBrake: 9,
  spawnMeanA: 9,
  spawnMeanB: 12
};

// 車の中心の位置と、進行方向の y 軸回転（+x 向きを 0 とする）
export const carPose = (lane: Lane, car: Car) => {
  const p = sampleAt(lane.line, car.s);
  return { x: p.x, z: p.z, yaw: Math.atan2(-p.dz, p.dx) };
};

const pickCarKind = (random: () => number): CarKind => {
  const r = random();
  if (r < 0.1) return 'bus';
  if (r < 0.4) return 'taxi';
  return 'sedan';
};

const exponential = (random: () => number, mean: number) => -mean * Math.log(1 - random() * 0.999);

const spawnCar = (model: Model, lane: Lane) => {
  lane.spawnTimer -= model.dt;
  if (lane.spawnTimer > 0) return;
  if (countCars(model) >= CAR_RULES.maxCars) return;
  const kind = pickCarKind(model.random);
  const spec = CAR_SPECS[kind];
  const last = lane.cars[lane.cars.length - 1];
  const room = last ? last.s - last.length / 2 - spec.length / 2 : Number.POSITIVE_INFINITY;
  // 出現位置まで渋滞しているときは、空くまで待つ
  if (room < spec.length + CAR_RULES.minGap + 2) return;
  const v0 = spec.speed * (0.9 + model.random() * 0.2);
  const safe = Math.sqrt(2 * CAR_RULES.comfortBrake * Math.max(0, room - CAR_RULES.minGap - 2));
  lane.cars.push({
    id: model.nextId++,
    kind,
    s: 0,
    v: Math.min(v0, safe),
    v0,
    length: spec.length,
    committed: false,
    look: Math.floor(model.random() * 1000)
  });
  lane.spawnTimer = Math.max(1.4, exponential(model.random, lane.spawnMean));
};

const stepLane = (model: Model, lane: Lane, dt: number) => {
  const light = carLight(model.signal, lane.axis);
  const line = lane.stopS;
  for (let i = 0; i < lane.cars.length; i++) {
    const car = lane.cars[i];
    const spec = CAR_SPECS[car.kind];
    const leader = i > 0 ? lane.cars[i - 1] : undefined;
    const front = car.s + car.length / 2;
    if (front > line + 0.3) car.committed = true;
    let gap = Number.POSITIVE_INFINITY;
    let closing = 0;
    if (leader) {
      gap = leader.s - leader.length / 2 - front;
      closing = car.v - leader.v;
    }
    // 黄信号で、普通のブレーキでは停止線に止まれない車はそのまま進む
    const toLine = line - front;
    if (!car.committed && light === 'yellow' && (car.v * car.v) / (2 * CAR_RULES.comfortBrake) > toLine) {
      car.committed = true;
    }
    const mustStop = !car.committed && light !== 'green';
    // 停止線そのものではなく、少し手前に止まる位置を障害物とみなす
    const lineGap = toLine + CAR_RULES.minGap - 1;
    if (mustStop && lineGap < gap) {
      gap = lineGap;
      closing = car.v;
    }
    const free = 1 - (car.v / car.v0) ** 4;
    let interaction = 0;
    if (Number.isFinite(gap)) {
      const desired =
        CAR_RULES.minGap +
        Math.max(
          0,
          car.v * CAR_RULES.headway + (car.v * closing) / (2 * Math.sqrt(spec.accel * CAR_RULES.comfortBrake))
        );
      interaction = (desired / Math.max(gap, 0.05)) ** 2;
    }
    const accel = Math.max(-CAR_RULES.maxBrake, spec.accel * (free - interaction));
    car.v = Math.max(0, car.v + accel * dt);
    car.s += car.v * dt;
    // 数値誤差でめり込まないよう、前の車と停止線を越えないように押し戻す
    if (leader) {
      const limit = leader.s - leader.length / 2 - car.length / 2 - 0.3;
      if (car.s > limit) {
        car.s = limit;
        car.v = Math.min(car.v, leader.v);
      }
    }
    if (mustStop && car.s + car.length / 2 > line) {
      car.s = line - car.length / 2;
      car.v = 0;
    }
  }
  while (lane.cars.length > 0 && lane.cars[0].s - lane.cars[0].length / 2 > lane.line.length) {
    lane.cars.shift();
  }
};

export const countCars = (model: Model) => model.lanes.reduce((sum, lane) => sum + lane.cars.length, 0);

// ---------------------------------------------------------------- 歩行者

export type PedState = 'walk' | 'wait' | 'cross' | 'leave';
export type Ped = {
  id: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  state: PedState;
  path: Vec[];
  index: number;
  // 待つ地点の path 上の番号。渡らない人は -1
  waitIndex: number;
  // 青になってから歩き出すまでの遅れ（秒）
  delay: number;
  side: number;
  look: number;
  height: number;
  // 交差点まわりだけに出る人（角の近くで現れ、渡ったら少し歩いて消える）
  crowd: boolean;
};

export const PED_RULES = {
  // 街全体を歩く人の数。遠くの歩道はこの人数で足りている。
  count: 300,
  minSpeed: 1.15,
  maxSpeed: 1.65,
  // 信号が変わりかけているときに急ぐ倍率
  hurry: 1.7,
  avoidRadius: 0.9,
  arrive: 0.5,
  crossRatio: 0.8,
  // 1 回のスクランブルで渡る人数の目安（画面のスライダーで選ぶ）
  crossersMin: 150,
  crossersMax: 1000,
  crossersInitial: 500,
  crossersStep: 50,
  // count 人のうち 1 回のスクランブルで渡るのは約 145 人（実測）。目安との差は交差点まわりだけの人で埋める。
  baseCrossers: 145,
  // 交差点まわりだけの人 1 人あたり、1 回のスクランブルで渡る人数（実測）
  crowdRate: 1,
  // 交差点まわりだけの人が現れる・消える位置（角の hub から歩道をさかのぼった距離）
  crowdSpawnMin: 10,
  crowdSpawnMax: 25,
  crowdLeaveMin: 6,
  crowdLeaveMax: 15,
  // 信号待ちの人だまりを広げるときの 1 人あたりの面積（m²）
  crowdArea: 0.45
};

// 1 回で渡る人数の目安に対する、交差点まわりだけの人の数
export const crowdFor = (crossers: number) =>
  Math.max(0, Math.round((crossers - PED_RULES.baseCrossers) / PED_RULES.crowdRate));

// 歩行者の最大数（描画用のバッファの大きさ）
export const PED_CAPACITY = PED_RULES.count + crowdFor(PED_RULES.crossersMax);

const range = (random: () => number, min: number, max: number) => min + random() * (max - min);

// 歩き始める角の選ばれやすさ（人の多い QFRONT 側とハチ公前広場を多めにする）
const CORNER_WEIGHTS: Record<CornerId, number> = { NW: 0.32, NE: 0.18, SE: 0.32, SW: 0.18 };
// 交差点まわりだけの人は、待つ場所の広さに合わせてさらに偏らせる（MAGNET 前の角は歩道が狭い）
// MAGNET 前の角は白線のない対角（南西へ）にも渡るので、そのぶん少し足している
const CROWD_CORNER_WEIGHTS: Record<CornerId, number> = { NW: 0.36, NE: 0.11, SE: 0.38, SW: 0.18 };

const pickWeighted = <T extends { weight: number }>(random: () => number, list: T[]): T => {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let r = random() * total;
  for (const item of list) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return list[list.length - 1];
};

// 遠くの入口から角の hub までの道筋。人ごとに横へ少しずらす。
const pickArm = (random: () => number, corner: Corner): Vec[] => {
  const arm = pickWeighted(random, corner.arms);
  return offsetPoints(arm.line, range(random, -arm.width, arm.width));
};

// 折れ線の終点から length だけさかのぼった部分
const tailOf = (list: Vec[], length: number): Vec[] => {
  let rest = length;
  for (let i = list.length - 1; i > 0; i--) {
    const a = list[i - 1];
    const b = list[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    if (d >= rest) {
      const t = rest / d;
      return [{ x: b.x + (a.x - b.x) * t, z: b.z + (a.z - b.z) * t }, ...list.slice(i)];
    }
    rest -= d;
  }
  return list;
};

// 信号待ちの人が建物の中に入らないよう、交差点の近くにある地面の建物を先に拾っておく
type Footprint = { points: Vec[]; minX: number; maxX: number; minZ: number; maxZ: number };
const NEAR_BUILDINGS: Footprint[] = OSM_BUILDINGS.filter((item) => item.b === 0)
  .map((item) => {
    const points: Vec[] = [];
    for (let i = 0; i < item.p.length; i += 2) points.push({ x: item.p[i], z: item.p[i + 1] });
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    return { points, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  })
  .filter((item) => item.minX < 80 && item.maxX > -80 && item.minZ < 80 && item.maxZ > -80);

const inBuilding = (p: Vec) =>
  NEAR_BUILDINGS.some(
    (item) =>
      p.x >= item.minX && p.x <= item.maxX && p.z >= item.minZ && p.z <= item.maxZ && pointInPolygon(p, item.points)
  );

const isBlocked = (p: Vec) => pointInPolygon(p, JUNCTION) || inBuilding(p);

const endSide = (corner: Corner, end: CrosswalkEnd) => (crosswalkOf(end.crosswalk).from === corner.id ? 'a' : 'b');

// 横断歩道の端で人が並べる幅（m）
const endWidth = (corner: Corner, end: CrosswalkEnd) => {
  const [p, q] = crosswalkOf(end.crosswalk)[endSide(corner, end)];
  return Math.hypot(q.x - p.x, q.z - p.z) * (end.span[1] - end.span[0]);
};

// 横断歩道の端で待てる広さ（m²）
const endCapacity = (corner: Corner, end: CrosswalkEnd) => endWidth(corner, end) * (end.room - end.setback[0]);

// 交差点まわりだけの人が crowd 人いるとき、この端の人だまりが縁石からどこまで下がるか
const crowdDepth = (corner: Corner, end: CrosswalkEnd, crowd: number) => {
  const weightTotal = CORNERS.reduce((sum, item) => sum + CROWD_CORNER_WEIGHTS[item.id], 0);
  const capacityTotal = corner.ends.reduce((sum, item) => sum + endCapacity(corner, item), 0);
  const waiters =
    ((crowd * CROWD_CORNER_WEIGHTS[corner.id]) / weightTotal) * (endCapacity(corner, end) / capacityTotal);
  const depth = end.setback[0] + (waiters * PED_RULES.crowdArea) / endWidth(corner, end);
  return Math.min(end.room, Math.max(end.setback[1], depth));
};

type Route = { path: Vec[]; waitIndex: number };

// from の角の start の端で待って横断歩道を渡り、渡った先の角から armOut で出ていく道筋。
// pickSetback は待つ位置を縁石から下げる距離を選ぶ。
const crossingRoute = (
  random: () => number,
  from: Corner,
  start: CrosswalkEnd,
  armIn: Vec[],
  pickSetback: () => number,
  armOut: (to: Corner) => Vec[]
): Route => {
  const crosswalk = crosswalkOf(start.crosswalk);
  const side = endSide(from, start);
  const to = cornerOf(side === 'a' ? crosswalk.to : crosswalk.from);
  const goal = to.ends.find((end) => end.crosswalk === crosswalk.id);
  if (!goal) throw new Error(`corner ${to.id} has no end for crosswalk ${crosswalk.id}`);
  // 待つ位置と渡った先が横断歩道の同じ筋にのるよう、両端で使える範囲の重なりから選ぶ
  const t0 = Math.max(start.span[0], goal.span[0]);
  const t1 = Math.min(start.span[1], goal.span[1]);
  let t = range(random, t0, t1);
  let wait = crosswalkEndPoint(crosswalk, side, t, pickSetback());
  // 建物に入ってしまったら選び直し、だめなら縁石のすぐ外で待つ
  for (let i = 0; i < 8 && isBlocked(wait); i++) {
    t = range(random, t0, t1);
    wait = crosswalkEndPoint(crosswalk, side, t, pickSetback());
  }
  if (isBlocked(wait)) wait = crosswalkEndPoint(crosswalk, side, t, start.setback[0]);
  const arrive = crosswalkEndPoint(
    crosswalk,
    side === 'a' ? 'b' : 'a',
    Math.min(t1, Math.max(t0, t + (random() - 0.5) * 0.08)),
    range(random, goal.setback[0], Math.min(goal.setback[1], 1.8))
  );
  return {
    path: [...armIn, ...start.via, wait, arrive, ...[...goal.via].reverse(), ...armOut(to)],
    waitIndex: armIn.length + start.via.length
  };
};

export const createRoute = (random: () => number): Route => {
  const from = pickWeighted(
    random,
    CORNERS.map((corner) => ({ corner, weight: CORNER_WEIGHTS[corner.id] }))
  ).corner;
  const armIn = pickArm(random, from);
  if (random() > PED_RULES.crossRatio) {
    // 渡らずに角を曲がっていく人
    const armOut = pickArm(random, from).reverse();
    return { path: [...armIn, ...armOut], waitIndex: -1 };
  }
  // この角につながる横断歩道から 1 本選ぶ（斜めは QFRONT 前 ↔ ハチ公前と、白線のない北東 ↔ 南西）
  const start = from.ends[Math.floor(random() * from.ends.length)];
  return crossingRoute(
    random,
    from,
    start,
    armIn,
    () => range(random, start.setback[0], start.setback[1]),
    (to) => pickArm(random, to).reverse()
  );
};

// 交差点まわりだけの人の道筋。角の近くで現れて必ず渡り、渡った先で少し歩いて消える。
// crowd はこの種類の人の総数で、多いほど信号待ちの人だまりを歩道の奥へ広げる。
export const createCrowdRoute = (random: () => number, crowd: number): Route => {
  const from = pickWeighted(
    random,
    CORNERS.map((corner) => ({ corner, weight: CROWD_CORNER_WEIGHTS[corner.id] }))
  ).corner;
  // 広く待てる端ほど選ばれやすくする
  const start = pickWeighted(
    random,
    from.ends.map((end) => ({ end, weight: endCapacity(from, end) }))
  ).end;
  const armIn = tailOf(pickArm(random, from), range(random, PED_RULES.crowdSpawnMin, PED_RULES.crowdSpawnMax));
  const depth = crowdDepth(from, start, crowd);
  return crossingRoute(
    random,
    from,
    start,
    armIn,
    () => range(random, start.setback[0], depth),
    (to) => tailOf(pickArm(random, to), range(random, PED_RULES.crowdLeaveMin, PED_RULES.crowdLeaveMax)).reverse()
  );
};

// 渡っている途中（待つ地点 → 渡った先）かどうか
export const isCrossingSegment = (ped: Ped) => ped.waitIndex >= 0 && ped.index === ped.waitIndex + 1;

const assignRoute = (ped: Ped, route: Route, random: () => number) => {
  ped.path = route.path;
  ped.waitIndex = route.waitIndex;
  ped.index = 1;
  ped.state = 'walk';
  ped.x = route.path[0].x;
  ped.z = route.path[0].z;
  ped.side = 0;
  ped.speed = range(random, PED_RULES.minSpeed, PED_RULES.maxSpeed);
  ped.delay = range(random, 0.2, 3);
  const next = route.path[1];
  ped.heading = Math.atan2(next.x - ped.x, next.z - ped.z);
};

const routeFor = (model: Model, crowd: boolean) =>
  crowd ? createCrowdRoute(model.random, model.crowdCount) : createRoute(model.random);

// 最初の配置。道のりのどこか（横断中を除く）に置く。
const placeOnRoute = (ped: Ped, random: () => number) => {
  const segments = ped.path.length - 1;
  let k = Math.floor(random() * segments);
  if (ped.waitIndex >= 0 && k === ped.waitIndex) k = ped.waitIndex - 1;
  const a = ped.path[k];
  const b = ped.path[k + 1];
  const t = random();
  ped.x = a.x + (b.x - a.x) * t;
  ped.z = a.z + (b.z - a.z) * t;
  ped.index = k + 1;
  ped.state = ped.waitIndex >= 0 && k > ped.waitIndex ? 'leave' : 'walk';
  ped.heading = Math.atan2(b.x - a.x, b.z - a.z);
};

// 交差点まわりだけの人の最初の配置。すぐにぎわって見えるよう、多くは待つ位置に置く。
const placeCrowd = (ped: Ped, random: () => number) => {
  if (random() < 0.6) {
    const wait = ped.path[ped.waitIndex];
    const next = ped.path[ped.waitIndex + 1];
    ped.x = wait.x;
    ped.z = wait.z;
    ped.index = ped.waitIndex;
    ped.state = 'wait';
    ped.heading = Math.atan2(next.x - wait.x, next.z - wait.z);
    return;
  }
  const k = Math.floor(random() * ped.waitIndex);
  const a = ped.path[k];
  const b = ped.path[k + 1];
  const t = random();
  ped.x = a.x + (b.x - a.x) * t;
  ped.z = a.z + (b.z - a.z) * t;
  ped.index = k + 1;
  ped.state = 'walk';
  ped.heading = Math.atan2(b.x - a.x, b.z - a.z);
};

const createPed = (model: Model, crowd: boolean): Ped => {
  const ped: Ped = {
    id: model.nextId++,
    x: 0,
    z: 0,
    heading: 0,
    speed: 1.4,
    state: 'walk',
    path: [],
    index: 1,
    waitIndex: -1,
    delay: 0,
    side: 0,
    look: Math.floor(model.random() * 100000),
    height: range(model.random, 0.9, 1.06),
    crowd
  };
  assignRoute(ped, routeFor(model, crowd), model.random);
  return ped;
};

// 1 回で渡る人数の目安を変える。交差点まわりだけの人を作り直し、街全体を歩く人はそのまま。
export const setCrossers = (model: Model, crossers: number) => {
  model.crowdCount = crowdFor(crossers);
  model.peds = model.peds.filter((ped) => !ped.crowd);
  for (let i = 0; i < model.crowdCount; i++) {
    const ped = createPed(model, true);
    placeCrowd(ped, model.random);
    model.peds.push(ped);
  }
};

const turnTo = (current: number, target: number, amount: number) => {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, amount);
};

const arrive = (model: Model, ped: Ped) => {
  if (ped.index === ped.path.length - 1) {
    // 目的地に着いたら、別の入口から新しい人として現れる
    assignRoute(ped, routeFor(model, ped.crowd), model.random);
    ped.look = Math.floor(model.random() * 100000);
    return;
  }
  if (ped.index === ped.waitIndex) {
    ped.state = 'wait';
    return;
  }
  if (ped.waitIndex >= 0 && ped.index === ped.waitIndex + 1) ped.state = 'leave';
  ped.index++;
};

// 近くの人だけを調べるための格子。1 マスは回避で見る距離（avoidRadius）より大きくし、隣のマスまで見れば足りるようにする。
const GRID_CELL = 1;
export type PedGrid = Map<number, Ped[]>;

const cellOf = (value: number) => Math.floor(value / GRID_CELL) + 1024;
const cellKey = (ix: number, iz: number) => ix * 4096 + iz;

const buildGrid = (model: Model) => {
  for (const list of model.grid.values()) list.length = 0;
  for (const ped of model.peds) {
    const key = cellKey(cellOf(ped.x), cellOf(ped.z));
    const list = model.grid.get(key);
    if (list) list.push(ped);
    else model.grid.set(key, [ped]);
  }
};

// (x, z) のまわり 3×3 マスにいる人を順に渡す
const forEachNear = (grid: PedGrid, x: number, z: number, visit: (other: Ped) => void) => {
  const ix = cellOf(x);
  const iz = cellOf(z);
  for (let i = ix - 1; i <= ix + 1; i++) {
    for (let k = iz - 1; k <= iz + 1; k++) {
      const list = grid.get(cellKey(i, k));
      if (!list) continue;
      for (const other of list) visit(other);
    }
  }
};

// 信号待ちの人どうしが重なりすぎないよう、近すぎる相手から少しだけ離れる（車道側へは出ない）
const separate = (ped: Ped, grid: PedGrid, dt: number) => {
  const gap = 0.55;
  let px = 0;
  let pz = 0;
  forEachNear(grid, ped.x, ped.z, (other) => {
    if (other === ped) return;
    const ox = ped.x - other.x;
    const oz = ped.z - other.z;
    if (Math.abs(ox) > gap || Math.abs(oz) > gap) return;
    const d = Math.hypot(ox, oz);
    if (d > gap || d < 1e-4) return;
    px += (ox / d) * (gap - d);
    pz += (oz / d) * (gap - d);
  });
  if (px === 0 && pz === 0) return;
  const next = { x: ped.x + px * Math.min(1, dt * 3), z: ped.z + pz * Math.min(1, dt * 3) };
  // 建物の中にも押し出さない
  if (isBlocked(next)) return;
  ped.x = next.x;
  ped.z = next.z;
};

const stepPeds = (model: Model, dt: number) => {
  const signal = model.signal;
  const light = pedLight(signal);
  const canStart = signal.phase === 'walk' && signal.elapsed < SIGNAL.walk - SIGNAL.walkStartMargin;
  const radius = PED_RULES.avoidRadius;
  buildGrid(model);
  for (const ped of model.peds) {
    if (ped.state === 'wait') {
      const next = ped.path[ped.index + 1];
      ped.heading = turnTo(ped.heading, Math.atan2(next.x - ped.x, next.z - ped.z), dt * 4);
      if (!canStart || signal.elapsed < ped.delay) {
        separate(ped, model.grid, dt);
        continue;
      }
      ped.state = 'cross';
      ped.index++;
    }
    const target = ped.path[ped.index];
    const dx = target.x - ped.x;
    const dz = target.z - ped.z;
    const dist = Math.hypot(dx, dz);
    if (dist < (ped.index === ped.waitIndex ? 0.25 : PED_RULES.arrive)) {
      arrive(model, ped);
      continue;
    }
    const fx = dx / dist;
    const fz = dz / dist;
    // 前方の近い人を避ける。進行方向に対して相手がいる側と反対へ少しずれる。
    let lateral = 0;
    forEachNear(model.grid, ped.x, ped.z, (other) => {
      if (other === ped) return;
      const ox = other.x - ped.x;
      const oz = other.z - ped.z;
      if (Math.abs(ox) > radius || Math.abs(oz) > radius) return;
      const d = Math.hypot(ox, oz);
      if (d > radius || d < 1e-4) return;
      if (ox * fx + oz * fz < -0.1) return;
      const side = fx * oz - fz * ox;
      lateral -= (side >= 0 ? 1 : -1) * (1 - d / radius);
    });
    lateral = Math.max(-1, Math.min(1, lateral));
    ped.side += (lateral - ped.side) * Math.min(1, dt * 5);
    const hurry = ped.state === 'cross' && light !== 'green' ? PED_RULES.hurry : 1;
    const speed = ped.speed * hurry;
    const vx = fx * speed - fz * ped.side * speed * 0.6;
    const vz = fz * speed + fx * ped.side * speed * 0.6;
    const step = Math.min(dist, Math.hypot(vx, vz) * dt);
    const len = Math.hypot(vx, vz);
    ped.x += (vx / len) * step;
    ped.z += (vz / len) * step;
    ped.heading = turnTo(ped.heading, Math.atan2(vx, vz), dt * 8);
  }
};

export const countCrossing = (model: Model) =>
  model.peds.reduce((sum, ped) => sum + (ped.state === 'cross' ? 1 : 0), 0);

// ---------------------------------------------------------------- 電車

export type TrainState = 'run' | 'dwell' | 'away';
export type Train = {
  // TRAIN_ROUTES の番号（0: 南行き、1: 北行き）
  route: number;
  s: number;
  v: number;
  state: TrainState;
  timer: number;
  served: boolean;
};

export const TRAIN = {
  cars: 6,
  carLength: 19.5,
  carGap: 0.6,
  maxSpeed: 15,
  accel: 0.9,
  brake: 1.1,
  dwell: 9,
  awayMin: 6,
  awayMax: 18
};

export const trainLength = () => TRAIN.cars * TRAIN.carLength + (TRAIN.cars - 1) * TRAIN.carGap;

// 折れ線上で z が初めて target を越える位置
const sAtZ = (line: Polyline, target: number) => {
  for (let s = 0; s < line.length; s += 0.5) {
    const p = sampleAt(line, s);
    if (Math.sign(p.z - target) === Math.sign(line.points[line.points.length - 1].z - target)) return s;
  }
  return line.length;
};

// 山手線は左側通行なので、南行きは東側の線路、北行きは西側の線路を走る
export const TRAIN_ROUTES = [
  { track: 1, line: createPolyline(TRACKS[1]) },
  { track: 0, line: createPolyline([...TRACKS[0]].reverse()) }
].map((route) => ({ ...route, stopS: sAtZ(route.line, STATION_Z) }));

// 編成の中心から offset（進む向きが正）だけずれた位置と進む向き
export const trainPose = (train: Train, offset: number) => sampleAt(TRAIN_ROUTES[train.route].line, train.s + offset);

const stepTrain = (model: Model, train: Train, dt: number) => {
  if (train.state === 'away') {
    train.timer -= dt;
    if (train.timer > 0) return;
    train.state = 'run';
    train.s = -trainLength() / 2;
    train.v = TRAIN.maxSpeed;
    train.served = false;
    return;
  }
  if (train.state === 'dwell') {
    train.timer -= dt;
    if (train.timer <= 0) train.state = 'run';
    return;
  }
  let limit = TRAIN.maxSpeed;
  const route = TRAIN_ROUTES[train.route];
  const stop = route.stopS;
  if (!train.served) {
    const d = stop - train.s;
    if (d < 0.3) {
      train.s = stop;
      train.v = 0;
      train.state = 'dwell';
      train.timer = TRAIN.dwell;
      train.served = true;
      return;
    }
    limit = Math.min(limit, Math.max(0.8, Math.sqrt(2 * TRAIN.brake * d)));
  }
  train.v = Math.min(limit, train.v + TRAIN.accel * dt);
  train.s += train.v * dt;
  if (!train.served && train.s > stop) train.s = stop;
  if (train.s - trainLength() / 2 > route.line.length) {
    train.state = 'away';
    train.timer = range(model.random, TRAIN.awayMin, TRAIN.awayMax);
  }
};

// ---------------------------------------------------------------- 全体

export type Model = {
  time: number;
  dt: number;
  signal: Signal;
  lanes: Lane[];
  peds: Ped[];
  // 交差点まわりだけに出る人の数
  crowdCount: number;
  grid: PedGrid;
  trains: Train[];
  crossing: number;
  nextId: number;
  random: () => number;
};

export const createRandom = (initial: number) => {
  let seed = initial;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
};

const createLanes = (random: () => number): Lane[] =>
  LANE_SPECS.map((spec) => {
    // 北行きは 1 車線しかないので、そのぶん多めに出す
    const single = LANE_SPECS.filter((item) => item.axis === spec.axis && item.dir === spec.dir).length === 1;
    const base = spec.axis === 'A' ? CAR_RULES.spawnMeanA : CAR_RULES.spawnMeanB;
    const spawnMean = single ? base * 0.6 : base;
    return { ...spec, cars: [], spawnTimer: random() * spawnMean, spawnMean };
  });

const SUBSTEP = 1 / 30;

// 停止線を越えて、まだ交差点や横断歩道の上にいる車がいるか
const carsInJunction = (model: Model, axis: Axis) =>
  model.lanes.some(
    (lane) =>
      lane.axis === axis &&
      lane.cars.some((car) => car.s + car.length / 2 > lane.stopS && car.s - car.length / 2 < lane.clearS)
  );

const stepSignal = (model: Model, dt: number) => {
  const signal = model.signal;
  signal.elapsed += dt;
  if (signal.phase === 'redA' || signal.phase === 'redB') {
    const busy = carsInJunction(model, signal.phase === 'redA' ? 'A' : 'B');
    if (signal.elapsed < SIGNAL.allRed || (busy && signal.elapsed < SIGNAL.allRedMax)) return;
    signal.phase = NEXT_PHASE[signal.phase];
    signal.elapsed = 0;
    return;
  }
  if (signal.phase === 'clear') {
    const cleared = signal.elapsed >= SIGNAL.walkClearMin && model.crossing === 0;
    if (!cleared && signal.elapsed < SIGNAL.walkClearMax) return;
    signal.phase = NEXT_PHASE.clear;
    signal.elapsed = 0;
    return;
  }
  const duration = PHASE_DURATION[signal.phase];
  if (signal.elapsed < duration) return;
  signal.phase = NEXT_PHASE[signal.phase];
  signal.elapsed -= duration;
};

const step = (model: Model, dt: number) => {
  model.time += dt;
  model.dt = dt;
  stepSignal(model, dt);
  for (const lane of model.lanes) {
    stepLane(model, lane, dt);
    spawnCar(model, lane);
  }
  stepPeds(model, dt);
  model.crossing = countCrossing(model);
  for (const train of model.trains) stepTrain(model, train, dt);
};

export const stepModel = (model: Model, dt: number) => {
  let rest = dt;
  while (rest > 1e-6) {
    const part = Math.min(SUBSTEP, rest);
    step(model, part);
    rest -= part;
  }
};

// crossers は 1 回のスクランブルで渡る人数の目安
export type ModelOptions = { random?: () => number; warmUp?: number; signal?: Signal; crossers?: number };

// 開いた瞬間から街がにぎわって見えるよう、少し時間を進めてから表示する。
// 初期の信号は、表示が始まって十数秒後にスクランブルになるように選んでいる。
export const createModel = (options: ModelOptions = {}): Model => {
  const random = options.random ?? Math.random;
  const model: Model = {
    time: 0,
    dt: 0,
    signal: options.signal ?? { phase: 'carA', elapsed: 0 },
    lanes: createLanes(random),
    peds: [],
    crowdCount: 0,
    grid: new Map(),
    trains: [
      { route: 0, s: TRAIN_ROUTES[0].stopS * 0.6, v: TRAIN.maxSpeed, state: 'run', timer: 0, served: false },
      { route: 1, s: 0, v: 0, state: 'away', timer: 12, served: false }
    ],
    crossing: 0,
    nextId: 1,
    random
  };
  for (let i = 0; i < PED_RULES.count; i++) {
    const ped = createPed(model, false);
    placeOnRoute(ped, random);
    model.peds.push(ped);
  }
  setCrossers(model, options.crossers ?? PED_RULES.crossersInitial);
  let rest = options.warmUp ?? 0;
  while (rest > 0) {
    const part = Math.min(0.1, rest);
    stepModel(model, part);
    rest -= part;
  }
  return model;
};
