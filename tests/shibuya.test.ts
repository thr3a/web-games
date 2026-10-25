import { expect, test } from 'vitest';
import {
  CORNERS,
  CROSSWALKS,
  crosswalkOf,
  crosswalkPolygon,
  JUNCTION,
  LANE_SPECS,
  pointInPolygon,
  STATION_Z,
  sampleAt,
  type Vec
} from '../src/games/shibuya/layout';
import {
  CAR_SPECS,
  type Car,
  carLight,
  countCars,
  createModel,
  createRandom,
  createRoute,
  type Lane,
  type Model,
  majorPhase,
  PED_RULES,
  type Phase,
  pedLight,
  SIGNAL,
  stepModel,
  TRAIN,
  trainPose
} from '../src/games/shibuya/model';
import { OSM_BUILDINGS, OSM_ROADS } from '../src/games/shibuya/osm';

const FRAME = 1 / 60;

const makeCar = (id: number, s: number, v: number): Car => ({
  id,
  kind: 'sedan',
  s,
  v,
  v0: 11,
  length: CAR_SPECS.sedan.length,
  committed: false,
  look: 0
});

// 歩行者なし・車の自動生成なしで、指定した車だけを置いた状態を作る。
const emptyModel = (phase: Phase) => {
  const model = createModel({
    random: createRandom(7),
    peds: 0,
    crossers: PED_RULES.crossersMin,
    signal: { phase, elapsed: 0 }
  });
  for (const lane of model.lanes) lane.spawnTimer = Number.POSITIVE_INFINITY;
  model.trains = [];
  return model;
};

const laneOf = (model: Model, axis: 'A' | 'B'): Lane => {
  const lane = model.lanes.find((item) => item.axis === axis && item.dir === 1);
  if (!lane) throw new Error('lane not found');
  return lane;
};

// 信号を指定のフェーズに固定したまま進める。
const runHolding = (model: Model, phase: Phase, seconds: number) => {
  for (let t = 0; t < seconds; t += FRAME) {
    model.signal = { phase, elapsed: 1 };
    stepModel(model, FRAME);
  }
};

test('信号は 車A → 車B → 歩行者スクランブル の順に繰り返す', () => {
  const model = createModel({ random: createRandom(1), peds: 0 });
  const seen: Phase[] = [model.signal.phase];
  for (let t = 0; t < 200; t += FRAME) {
    stepModel(model, FRAME);
    if (seen[seen.length - 1] !== model.signal.phase) seen.push(model.signal.phase);
  }
  expect(seen.slice(0, 10)).toEqual([
    'carA',
    'yellowA',
    'redA',
    'carB',
    'yellowB',
    'redB',
    'walk',
    'flash',
    'clear',
    'carA'
  ]);
});

test('信号の色はフェーズに対応する', () => {
  expect(carLight({ phase: 'carA', elapsed: 0 }, 'A')).toBe('green');
  expect(carLight({ phase: 'carA', elapsed: 0 }, 'B')).toBe('red');
  expect(carLight({ phase: 'yellowB', elapsed: 0 }, 'B')).toBe('yellow');
  expect(carLight({ phase: 'walk', elapsed: 0 }, 'A')).toBe('red');
  expect(pedLight({ phase: 'walk', elapsed: 0 })).toBe('green');
  expect(pedLight({ phase: 'flash', elapsed: 0 })).toBe('flash');
  expect(pedLight({ phase: 'carB', elapsed: 0 })).toBe('red');
  expect(majorPhase({ phase: 'redA', elapsed: 0 })).toBe(1);
  expect(majorPhase({ phase: 'yellowB', elapsed: 0 })).toBe(2);
  expect(majorPhase({ phase: 'clear', elapsed: 0 })).toBe(3);
});

test('赤信号の車は停止線の手前で止まる', () => {
  const model = emptyModel('carB');
  const lane = laneOf(model, 'A');
  lane.cars.push(makeCar(1, lane.stopS - 60, 11));
  runHolding(model, 'carB', 30);
  const car = lane.cars[0];
  expect(car.v).toBeLessThan(0.05);
  expect(car.s + car.length / 2).toBeLessThanOrEqual(lane.stopS);
  expect(car.s + car.length / 2).toBeGreaterThan(lane.stopS - 4);
});

test('青になると停止していた車が交差点を通過する', () => {
  const model = emptyModel('carB');
  const lane = laneOf(model, 'A');
  lane.cars.push(makeCar(1, lane.stopS - 60, 11));
  runHolding(model, 'carB', 30);
  runHolding(model, 'carA', 20);
  expect(lane.cars.length === 0 || lane.cars[0].s > lane.stopS + 40).toBe(true);
});

test('黄信号で止まれない位置の車はそのまま進む', () => {
  const model = emptyModel('yellowA');
  const lane = laneOf(model, 'A');
  // 停止線の 5m 手前を 11m/s で走っている
  lane.cars.push(makeCar(1, lane.stopS - 5 - CAR_SPECS.sedan.length / 2, 11));
  runHolding(model, 'yellowA', 2);
  expect(lane.cars[0].s + lane.cars[0].length / 2).toBeGreaterThan(lane.stopS);
});

test('後続の車は前の車との車間を保ち、重ならない', () => {
  const model = emptyModel('carB');
  const lane = laneOf(model, 'A');
  const base = lane.stopS - 100;
  lane.cars.push(
    makeCar(1, base + 100, 11),
    makeCar(2, base + 85, 11),
    makeCar(3, base + 70, 11),
    makeCar(4, base + 30, 11)
  );
  runHolding(model, 'carB', 30);
  for (let i = 1; i < lane.cars.length; i++) {
    const front = lane.cars[i - 1];
    const back = lane.cars[i];
    expect(front.s - front.length / 2 - (back.s + back.length / 2)).toBeGreaterThan(1);
  }
});

test('長時間動かしても、車の重なり・赤信号での横断開始・車が青の間の横断が起きない', () => {
  const model = createModel({ random: createRandom(42), warmUp: 10 });
  const states = new Map(model.peds.map((ped) => [ped, ped.state]));
  let maxCars = 0;
  let crossedTotal = 0;
  let passedCars = 0;
  const seenCars = new Set<number>();
  for (let t = 0; t < 240; t += FRAME) {
    stepModel(model, FRAME);
    const phase = model.signal.phase;
    for (const ped of model.peds) {
      const before = states.get(ped);
      if (ped.state === 'cross' && before !== 'cross') {
        expect(phase).toBe('walk');
        crossedTotal++;
      }
      states.set(ped, ped.state);
    }
    if (carLight(model.signal, 'A') === 'green' || carLight(model.signal, 'B') === 'green') {
      expect(model.crossing).toBe(0);
    }
    for (const lane of model.lanes) {
      for (let i = 1; i < lane.cars.length; i++) {
        const front = lane.cars[i - 1];
        const back = lane.cars[i];
        expect(front.s - front.length / 2).toBeGreaterThan(back.s + back.length / 2);
      }
      for (const car of lane.cars) {
        if (car.s > lane.stopS + 40 && !seenCars.has(car.id)) {
          seenCars.add(car.id);
          passedCars++;
        }
      }
    }
    maxCars = Math.max(maxCars, countCars(model));
    expect(model.peds.length).toBe(PED_RULES.count);
  }
  expect(crossedTotal).toBeGreaterThan(300);
  expect(passedCars).toBeGreaterThan(40);
  expect(maxCars).toBeGreaterThan(10);
}, 60000);

test('歩行者が青の間、車は横断歩道の上にいない', () => {
  const model = createModel({ random: createRandom(21), warmUp: 10 });
  const polygons = CROSSWALKS.map(crosswalkPolygon);
  let checked = 0;
  for (let t = 0; t < 240; t += FRAME) {
    stepModel(model, FRAME);
    if (pedLight(model.signal) === 'red' && model.signal.phase !== 'clear') continue;
    for (const lane of model.lanes) {
      for (const car of lane.cars) {
        for (const offset of [-car.length / 2, 0, car.length / 2]) {
          const p = sampleAt(lane.line, car.s + offset);
          expect(polygons.some((polygon) => pointInPolygon(p, polygon))).toBe(false);
          checked++;
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(0);
}, 60000);

test('歩行者は信号待ちの間は車道に出ない', () => {
  const model = createModel({ random: createRandom(3), warmUp: 30 });
  for (let t = 0; t < 120; t += FRAME) {
    stepModel(model, FRAME);
    for (const ped of model.peds) {
      if (ped.state !== 'wait') continue;
      expect(pointInPolygon(ped, JUNCTION)).toBe(false);
    }
  }
}, 30000);

test('横断ルートの待つ位置と渡った先は車道の外で、別の角にある', () => {
  const random = createRandom(9);
  const diagonals = new Set<string>();
  for (let i = 0; i < 800; i++) {
    const route = createRoute(random);
    if (route.waitIndex < 0) continue;
    const wait = route.path[route.waitIndex];
    const end = route.path[route.waitIndex + 1];
    for (const point of [wait, end]) expect(pointInPolygon(point, JUNCTION)).toBe(false);
    // 渡った先は横断歩道の反対側（10m 以上離れている）
    expect(Math.hypot(wait.x - end.x, wait.z - end.z)).toBeGreaterThan(10);
    for (const id of ['D', 'X'] as const) {
      const d = crosswalkOf(id);
      const nearA = (p: Vec) => Math.hypot(p.x - d.a[0].x, p.z - d.a[0].z) < 12;
      const nearB = (p: Vec) => Math.hypot(p.x - d.b[0].x, p.z - d.b[0].z) < 12;
      if ((nearA(wait) && nearB(end)) || (nearB(wait) && nearA(end)))
        diagonals.add(nearA(wait) ? `${d.from}→${d.to}` : `${d.to}→${d.from}`);
    }
  }
  expect([...diagonals].sort()).toEqual(['NE→SW', 'NW→SE', 'SE→NW', 'SW→NE']);
});

// ---------------------------------------------------------------- 形状（layout.ts と osm.ts）

// 地面に建つ建物（デッキの上の建物の下は通れる）
const buildingRings = OSM_BUILDINGS.filter((building) => building.b === 0).map((building) => {
  const ring: Vec[] = [];
  for (let i = 0; i < building.p.length; i += 2) ring.push({ x: building.p[i], z: building.p[i + 1] });
  return { id: building.id, ring };
});

// 線分を 0.25m ごとに調べて、建物の中に入る点があればその建物の id を返す
const hitBuilding = (a: Vec, b: Vec) => {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
  for (let k = 0; k <= steps; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / steps, z: a.z + ((b.z - a.z) * k) / steps };
    const hit = buildingRings.find((item) => pointInPolygon(p, item.ring));
    if (hit) return `${hit.id} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;
  }
  return undefined;
};

test('白線の斜め横断は 1 本だけで、北東 ↔ 南西は白線なし。横断歩道は交差点の車道にかかっている', () => {
  expect(CROSSWALKS.map((item) => item.id).sort()).toEqual(['D', 'E', 'N', 'S', 'W', 'X']);
  expect(CROSSWALKS.filter((item) => item.unmarked).map((item) => item.id)).toEqual(['X']);
  const diagonal = crosswalkOf('D');
  expect([diagonal.from, diagonal.to].sort()).toEqual(['NW', 'SE']);
  const unmarked = crosswalkOf('X');
  expect([unmarked.from, unmarked.to].sort()).toEqual(['NE', 'SW']);
  for (const crosswalk of CROSSWALKS) {
    const polygon = crosswalkPolygon(crosswalk);
    const center = {
      x: polygon.reduce((sum, p) => sum + p.x, 0) / 4,
      z: polygon.reduce((sum, p) => sum + p.z, 0) / 4
    };
    expect(pointInPolygon(center, JUNCTION)).toBe(true);
  }
});

test('車線は建物を通らない', () => {
  for (const lane of LANE_SPECS) {
    const points = lane.line.points;
    for (let i = 1; i < points.length; i++) {
      expect(hitBuilding(points[i - 1], points[i]), `${lane.axis}${lane.dir} #${i}`).toBeUndefined();
    }
  }
});

test('車線は車道（交差点の中か道路の帯の中）からはみ出さない', () => {
  const roads = OSM_ROADS.filter((road) => road.k === 'car').map((road) => {
    const line: Vec[] = [];
    for (let i = 0; i < road.p.length; i += 2) line.push({ x: road.p[i], z: road.p[i + 1] });
    return { line, half: road.w / 2 };
  });
  const onRoad = (p: Vec) =>
    pointInPolygon(p, JUNCTION) ||
    roads.some(({ line, half }) =>
      line.slice(1).some((b, i) => {
        const a = line[i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t) < half;
      })
    );
  for (const lane of LANE_SPECS) {
    for (let s = 0; s < lane.line.length; s += 1) {
      const p = sampleAt(lane.line, s);
      if (Math.hypot(p.x, p.z) > 250) continue;
      // 車体の幅（左右 0.9m）まで車道に収まる
      for (const side of [-0.9, 0, 0.9]) {
        const q = { x: p.x + p.dz * side, z: p.z - p.dx * side };
        expect(onRoad(q), `${lane.axis}${lane.dir} (${q.x.toFixed(1)}, ${q.z.toFixed(1)})`).toBe(true);
      }
    }
  }
});

test('車線は交差点を出きった位置（clearS）より先で横断歩道に戻らない', () => {
  const polygons = CROSSWALKS.map(crosswalkPolygon);
  for (const lane of LANE_SPECS) {
    expect(lane.clearS).toBeGreaterThan(lane.stopS + 20);
    for (let s = lane.clearS; s < lane.clearS + 60; s += 0.5) {
      const p = sampleAt(lane.line, s);
      expect(polygons.some((polygon) => pointInPolygon(p, polygon))).toBe(false);
    }
  }
});

test('歩行者の道筋は建物を通らない', () => {
  for (const corner of CORNERS) {
    for (const arm of corner.arms) {
      for (const offset of [-arm.width, 0, arm.width]) {
        const line = arm.line.map((p, i) => {
          const a = arm.line[Math.max(0, i - 1)];
          const b = arm.line[Math.min(arm.line.length - 1, i + 1)];
          const len = Math.hypot(b.x - a.x, b.z - a.z);
          return { x: p.x + ((b.z - a.z) / len) * offset, z: p.z - ((b.x - a.x) / len) * offset };
        });
        for (let i = 1; i < line.length; i++) {
          expect(
            hitBuilding(line[i - 1], line[i]),
            `${corner.id} arm ${arm.line[0].x},${arm.line[0].z}`
          ).toBeUndefined();
        }
      }
    }
  }
  const random = createRandom(11);
  for (let i = 0; i < 600; i++) {
    const route = createRoute(random);
    if (route.waitIndex < 0) continue;
    // 角の hub から待つ位置まで、渡った先から hub まで
    const from = route.waitIndex - 1;
    for (let k = from; k < route.waitIndex + 3; k++) {
      expect(hitBuilding(route.path[k], route.path[k + 1]), `route segment ${k}`).toBeUndefined();
    }
  }
});

test('電車は駅に停車してから走り去る', () => {
  const model = emptyModel('carA');
  model.trains = [{ route: 0, s: 0, v: TRAIN.maxSpeed, state: 'run', timer: 0, served: false }];
  const train = model.trains[0];
  let dwelled = false;
  let left = false;
  for (let t = 0; t < 120; t += FRAME) {
    stepModel(model, FRAME);
    if (train.state === 'dwell') {
      dwelled = true;
      expect(trainPose(train, 0).z).toBeCloseTo(STATION_Z, 0);
    }
    if (dwelled && train.state === 'away') left = true;
  }
  expect(dwelled).toBe(true);
  expect(left).toBe(true);
});

test('スクランブルの青は所定の長さだけ続く', () => {
  const model = createModel({ random: createRandom(5), peds: 0, signal: { phase: 'redB', elapsed: 0 } });
  let walk = 0;
  for (let t = 0; t < 40; t += FRAME) {
    stepModel(model, FRAME);
    if (model.signal.phase === 'walk') walk += FRAME;
  }
  expect(walk).toBeCloseTo(SIGNAL.walk, 0);
});
