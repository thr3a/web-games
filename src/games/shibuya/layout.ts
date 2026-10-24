// 渋谷スクランブル交差点の中心部の形（three.js には依存しない）。
// 座標は 1 単位 = 約 1m。x が東、z が南、交差点の中心が原点（osm.ts と同じ）。
// 横断歩道・縁石・車線は航空写真から、道路の中心線と線路は OpenStreetMap から写している。

export type Vec = { x: number; z: number };

const v = (x: number, z: number): Vec => ({ x, z });
const points = (list: [number, number][]): Vec[] => list.map(([x, z]) => v(x, z));

// ---------------------------------------------------------------- 折れ線

export type Polyline = { points: Vec[]; cumulative: number[]; length: number };

export const createPolyline = (list: Vec[]): Polyline => {
  const cumulative = [0];
  for (let i = 1; i < list.length; i++) {
    cumulative.push(cumulative[i - 1] + Math.hypot(list[i].x - list[i - 1].x, list[i].z - list[i - 1].z));
  }
  return { points: list, cumulative, length: cumulative[cumulative.length - 1] };
};

export type Sample = { x: number; z: number; dx: number; dz: number };

// 始点からの距離 s の位置と進む向き。範囲の外は両端の向きのまま延ばす。
export const sampleAt = (line: Polyline, s: number): Sample => {
  const { points: list, cumulative } = line;
  let lo = 0;
  let hi = list.length - 1;
  if (s <= 0) hi = 1;
  else if (s >= line.length) lo = list.length - 2;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] <= s) lo = mid;
      else hi = mid;
    }
  }
  const a = list[lo];
  const b = list[lo + 1];
  const len = cumulative[lo + 1] - cumulative[lo] || 1;
  const t = (s - cumulative[lo]) / len;
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    dx: (b.x - a.x) / len,
    dz: (b.z - a.z) / len
  };
};

// 進む向きに対して左（日本の車が走る側）を正とする法線
export const leftOf = (dx: number, dz: number): Vec => v(dz, -dx);

// 点ごとに offset を指定して横にずらす（offset は進む向きの左が正）
const offsetEach = (list: Vec[], offsets: number[]): Vec[] =>
  list.map((p, i) => {
    const a = list[Math.max(0, i - 1)];
    const b = list[Math.min(list.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const n = leftOf((b.x - a.x) / len, (b.z - a.z) / len);
    return v(p.x + n.x * offsets[i], p.z + n.z * offsets[i]);
  });

export const offsetPoints = (list: Vec[], offset: number) =>
  offsetEach(
    list,
    list.map(() => offset)
  );

// 等間隔に打ち直す
export const resample = (list: Vec[], step: number): Vec[] => {
  const line = createPolyline(list);
  const count = Math.max(1, Math.round(line.length / step));
  return Array.from({ length: count + 1 }, (_, i) => {
    const p = sampleAt(line, (line.length * i) / count);
    return v(p.x, p.z);
  });
};

// 移動平均で角を丸める（両端は動かさない）
const smooth = (list: Vec[], radius: number): Vec[] =>
  list.map((p, i) => {
    const r = Math.min(radius, i, list.length - 1 - i);
    if (r === 0) return p;
    let x = 0;
    let z = 0;
    for (let k = -r; k <= r; k++) {
      x += list[i + k].x;
      z += list[i + k].z;
    }
    return v(x / (2 * r + 1), z / (2 * r + 1));
  });

// 3 次ベジェで 2 点をなめらかにつなぐ（交差点の中を通る部分）
const connect = (from: Sample, to: Sample, step: number): Vec[] => {
  const chord = Math.hypot(to.x - from.x, to.z - from.z);
  // 制御点を遠くに置くと曲線がふくらんで歩道にはみ出すので、弦の 1/4 にとどめる
  const k = chord / 4;
  const c1 = v(from.x + from.dx * k, from.z + from.dz * k);
  const c2 = v(to.x - to.dx * k, to.z - to.dz * k);
  const count = Math.max(2, Math.round(chord / step));
  const list: Vec[] = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const u = 1 - t;
    list.push(
      v(
        u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
        u * u * u * from.z + 3 * u * u * t * c1.z + 3 * u * t * t * c2.z + t * t * t * to.z
      )
    );
  }
  return list;
};

export const pointInPolygon = (p: Vec, polygon: Vec[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
};

const lerp = (a: Vec, b: Vec, t: number): Vec => v(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);

// ---------------------------------------------------------------- 交差点の車道

// 交差点の中の車道（縁石の内側）。各方向の道路はこの外側に osm.ts の道路がつながる。
export const JUNCTION: Vec[] = points([
  // 北西: 道玄坂の北側 → センター街の入口 → QFRONT 前の広場の角
  [-40, -14.8],
  [-17, -14.3],
  [-13, -13.9],
  [-9, -14.9],
  [-5.5, -16.7],
  [-2.6, -17.3],
  [-1, -18.3],
  [-0.8, -22],
  [-0.4, -27],
  // 北の神宮通り（西側の縁石 → 東側の縁石）
  [0.4, -31],
  [18.4, -31],
  [17.6, -26.5],
  [15.6, -24.5],
  // 北東: MAGNET 前の角
  [15.4, -14.3],
  [14.6, -12],
  [14.8, -9.4],
  [15.6, -8.5],
  [18, -8.3],
  [24, -8.1],
  [30, -5],
  [32, -4],
  // 南東: ハチ公前広場の角
  [32, 10.4],
  [14, 10.6],
  [6.2, 15.5],
  [6.3, 23.5],
  // 南: 神宮通り（南行き）とバス乗り場の島の先端、北行きの 1 車線
  [-6, 23.5],
  [-8, 22.6],
  [-19, 20.4],
  [-21, 21.4],
  [-26.8, 21.6],
  // 南西: 渋谷駅前ビル側の角
  [-25.8, 18],
  [-25.2, 10],
  [-25.8, 6],
  [-29, 2.7],
  [-40, 2.2]
]);

// ---------------------------------------------------------------- 横断歩道

export type CornerId = 'NW' | 'NE' | 'SE' | 'SW';
export type Crosswalk = {
  id: 'N' | 'E' | 'S' | 'W' | 'D';
  from: CornerId;
  to: CornerId;
  // 各端の縁石側の辺（a は from 側、b は to 側）。a[0] と b[0]、a[1] と b[1] が同じ側の長辺になる。
  a: [Vec, Vec];
  b: [Vec, Vec];
};

// 四辺と、QFRONT 前の広場とハチ公前広場を結ぶ斜め横断 1 本
export const CROSSWALKS: Crosswalk[] = [
  { id: 'N', from: 'NW', to: 'NE', a: [v(-0.8, -24.8), v(-0.8, -17.6)], b: [v(15.4, -23.8), v(15.4, -14.3)] },
  { id: 'E', from: 'NE', to: 'SE', a: [v(15.4, -8.4), v(22.8, -8.2)], b: [v(14.6, 10.4), v(22.2, 10.4)] },
  { id: 'S', from: 'SW', to: 'SE', a: [v(-25.2, 10.3), v(-25.4, 17.6)], b: [v(6.2, 15.6), v(6.2, 22)] },
  { id: 'W', from: 'NW', to: 'SW', a: [v(-32.2, -14.6), v(-26, -14.4)], b: [v(-34.2, 2.5), v(-28, 2.7)] },
  { id: 'D', from: 'NW', to: 'SE', a: [v(-12.8, -13.9), v(-5.5, -16.6)], b: [v(6.6, 15.2), v(13.2, 11.1)] }
];

export const crosswalkPolygon = (crosswalk: Crosswalk): Vec[] => [
  crosswalk.a[0],
  crosswalk.a[1],
  crosswalk.b[1],
  crosswalk.b[0]
];

// ---------------------------------------------------------------- 歩道の角と道筋

// 道筋は遠くの入口から角の集まる地点（hub）まで。width は横にばらける幅（片側）。
export type Arm = { weight: number; width: number; line: Vec[] };
// 横断歩道の端で待つ位置の決め方。via を通ってから待つ位置へ行く。setback は縁石から下がる距離の範囲。
// room は人が多いときに下がってよい最大の距離（その先は建物や車道）。
export type CrosswalkEnd = {
  crosswalk: Crosswalk['id'];
  via: Vec[];
  span: [number, number];
  setback: [number, number];
  room: number;
};
export type Corner = { id: CornerId; hub: Vec; arms: Arm[]; ends: CrosswalkEnd[] };

export const CORNERS: Corner[] = [
  {
    // QFRONT 前の広場・センター街の入口・道玄坂の北側の歩道
    id: 'NW',
    hub: v(-20, -19.5),
    arms: [
      {
        weight: 0.34,
        width: 2.6,
        line: points([
          [-97, -71],
          [-70, -65],
          [-63, -62],
          [-44, -45],
          [-30, -31],
          [-27, -27],
          [-23, -23],
          [-20, -19.5]
        ])
      },
      {
        weight: 0.22,
        width: 0.9,
        line: points([
          [-98, -15.5],
          [-75, -19.5],
          [-55, -20.6],
          [-46, -22.6],
          [-36, -23],
          [-28, -22.5],
          [-20, -19.5]
        ])
      },
      {
        weight: 0.24,
        width: 0.9,
        line: points([
          [10.5, -88],
          [5, -65],
          [1.6, -51],
          [-0.4, -40],
          [-2, -30],
          [-9, -28.4],
          [-16, -26.5],
          [-20, -19.5]
        ])
      },
      {
        weight: 0.12,
        width: 1,
        line: points([
          [-12.8, -29.4],
          [-15, -26],
          [-20, -19.5]
        ])
      },
      {
        weight: 0.08,
        width: 0.5,
        line: points([
          [-39.4, -27.6],
          [-30, -24],
          [-20, -19.5]
        ])
      }
    ],
    ends: [
      { crosswalk: 'W', via: [], span: [0.08, 0.92], setback: [0.4, 3.2], room: 10 },
      { crosswalk: 'D', via: [], span: [0.08, 0.92], setback: [0.4, 3.5], room: 10 },
      { crosswalk: 'N', via: [v(-3.6, -19.4)], span: [0.08, 0.92], setback: [0.4, 2.2], room: 9 }
    ]
  },
  {
    // MAGNET 前の角（角に地下鉄の出入口がある）
    id: 'NE',
    hub: v(18.2, -19.4),
    arms: [
      {
        weight: 0.45,
        width: 0.6,
        line: points([
          [34.2, -100],
          [33, -90],
          [31.2, -82],
          [29.8, -74],
          [26.6, -60],
          [23.4, -45],
          [21.3, -35],
          [18.8, -26],
          [18.2, -19.4]
        ])
      },
      {
        weight: 0.45,
        width: 0.6,
        line: points([
          [110, -6.5],
          [80, -6],
          [50, -6.8],
          [44, -10.3],
          [30, -10.3],
          [26, -10.7],
          [23.5, -13.8],
          [18.2, -19.4]
        ])
      },
      {
        weight: 0.1,
        width: 0.4,
        line: points([
          [22.9, -16.3],
          [18.2, -19.4]
        ])
      }
    ],
    ends: [
      { crosswalk: 'N', via: [], span: [0.08, 0.92], setback: [0.4, 2], room: 3.5 },
      { crosswalk: 'E', via: [v(15.6, -15.3), v(15.3, -12.8)], span: [0.12, 0.5], setback: [0.4, 1.4], room: 3 }
    ]
  },
  {
    // ハチ公前広場（駅のハチ公口）
    id: 'SE',
    hub: v(18, 22),
    arms: [
      {
        weight: 0.5,
        width: 3,
        line: points([
          [39.8, 27],
          [30, 25],
          [18, 22]
        ])
      },
      {
        weight: 0.2,
        width: 2,
        line: points([
          [15, 50],
          [12, 35],
          [18, 22]
        ])
      },
      {
        weight: 0.3,
        width: 0.5,
        line: points([
          [92, 11.4],
          [80, 11.3],
          [60, 12.5],
          [42, 13],
          [30, 14.5],
          [18, 22]
        ])
      }
    ],
    ends: [
      { crosswalk: 'E', via: [], span: [0.08, 0.92], setback: [0.4, 3.5], room: 10 },
      { crosswalk: 'D', via: [], span: [0.08, 0.92], setback: [0.4, 3.5], room: 9 },
      { crosswalk: 'S', via: [], span: [0.08, 0.92], setback: [0.4, 3.5], room: 9 }
    ]
  },
  {
    // 渋谷駅前ビルの角
    id: 'SW',
    hub: v(-33, 8.5),
    arms: [
      {
        weight: 0.4,
        width: 1,
        line: points([
          [-100, 5.5],
          [-75, 4.4],
          [-60, 4.8],
          [-50, 5.2],
          [-40, 6.4],
          [-33, 8.5]
        ])
      },
      {
        weight: 0.45,
        width: 0.9,
        line: points([
          [-37.5, 85],
          [-39, 65],
          [-37.5, 50],
          [-35, 40],
          [-34.5, 30],
          [-33.5, 20],
          [-33, 8.5]
        ])
      },
      {
        weight: 0.15,
        width: 1,
        line: points([
          [-47.2, 12.1],
          [-33, 8.5]
        ])
      }
    ],
    ends: [
      { crosswalk: 'W', via: [], span: [0.08, 0.85], setback: [0.4, 3], room: 9 },
      { crosswalk: 'S', via: [], span: [0.08, 0.92], setback: [0.4, 3.5], room: 9 }
    ]
  }
];

export const cornerOf = (id: CornerId): Corner => {
  const corner = CORNERS.find((item) => item.id === id);
  if (!corner) throw new Error(`unknown corner ${id}`);
  return corner;
};

export const crosswalkOf = (id: Crosswalk['id']): Crosswalk => {
  const crosswalk = CROSSWALKS.find((item) => item.id === id);
  if (!crosswalk) throw new Error(`unknown crosswalk ${id}`);
  return crosswalk;
};

// 横断歩道の端の辺上の点（t: 0〜1）から、縁石の外へ setback だけ下がった位置
export const crosswalkEndPoint = (crosswalk: Crosswalk, side: 'a' | 'b', t: number, setback: number): Vec => {
  const near = crosswalk[side];
  const far = side === 'a' ? crosswalk.b : crosswalk.a;
  const p = lerp(near[0], near[1], t);
  const q = lerp(far[0], far[1], t);
  const len = Math.hypot(p.x - q.x, p.z - q.z) || 1;
  return v(p.x + ((p.x - q.x) / len) * setback, p.z + ((p.z - q.z) / len) * setback);
};

// ---------------------------------------------------------------- 車線

export type Axis = 'A' | 'B';
export type Dir = 1 | -1;
// stopS: 停止線の位置、clearS: 交差点と横断歩道を出きった位置（どちらも車線の始点からの距離）
export type LaneSpec = { axis: Axis; dir: Dir; line: Polyline; stopS: number; clearS: number };

// 道路の中心線（交差点から外へ向かう向き）。OpenStreetMap の中心線をもとにしている。
const DOGENZAKA = points([
  [-38, -6.2],
  [-43, -7],
  [-49, -8],
  [-55, -8.5],
  [-61, -9],
  [-69, -9],
  [-76, -8],
  [-88, -6],
  [-94, -5],
  [-102, -2]
]);
// 109 の南を通る道玄坂（2 車線）
const DOGENZAKA_SW = points([
  [-102, -2],
  [-109, 1],
  [-119, 5],
  [-125, 7],
  [-132, 9],
  [-170, 22],
  [-207, 34],
  [-226, 40],
  [-254, 52]
]);
// 109 の北を通る文化村通り（2 車線）
const BUNKAMURA = points([
  [-102, -2],
  [-104, -7],
  [-107, -11],
  [-113, -17],
  [-135, -27],
  [-179, -47],
  [-195, -54],
  [-217, -64],
  [-253, -82]
]);
// 東へ: 旧大山街道（山手線の高架をくぐる）→ 宮益坂
const EAST = points([
  [26, 2.3],
  [35, 3],
  [48, 3.7],
  [80, 3],
  [132, -2],
  [144, -3],
  [163, -6],
  [173, -8],
  [188, -11],
  [194, -12],
  [228, -19],
  [238, -21],
  [301, -34]
]);
// 北へ: 神宮通り
const NORTH = points([
  [9.4, -30],
  [16, -59],
  [20, -76],
  [23, -93],
  [24, -105],
  [24, -123],
  [25, -165],
  [24, -181],
  [24, -200],
  [24, -288]
]);
// 南へ: 神宮通りの南行き（一方通行 3 車線）
const SOUTH_OUT = points([
  [-1.1, 27.5],
  [-2.1, 31],
  [-5, 40],
  [-8, 49],
  [-13, 60],
  [-15, 68],
  [-14, 80],
  [-13, 88],
  [-11, 95],
  [-9, 103],
  [-6, 109],
  [-2, 115],
  [6, 129],
  [7, 141],
  [5, 150],
  [3, 160],
  [3, 169],
  [4, 174],
  [8, 186],
  [10, 192],
  [18, 210],
  [26, 226]
]);
// 北行きの神宮通り（一方通行 1 車線。交差点へ向かう向き）
const SOUTH_IN = points([
  [-6, 177],
  [-9, 170],
  [-11, 166],
  [-14, 157],
  [-16, 146],
  [-18, 141],
  [-22, 130],
  [-27, 113],
  [-28, 104],
  [-31, 87],
  [-31, 82],
  [-34, 64],
  [-34, 60],
  [-33, 56],
  [-29, 40],
  [-27, 31],
  [-26, 27],
  [-24.4, 22.8]
]);

// 北行きは交差点の中で北東へ向きを変えてから北へ（QFRONT 前の角に寄りすぎないように）
const SOUTH_IN_TURN = points([
  [-14, 8],
  [-4, -2]
]);

const reversed = (list: Vec[]) => [...list].reverse();

type Piece = { line: Vec[]; offset: number };

// 道路の中心線の区間をつなぎ、区間ごとの offset でずらしてから角を丸める
const lanePath = (pieces: Piece[]): Vec[] => {
  const raw: Vec[] = [];
  const offsets: number[] = [];
  for (const piece of pieces) {
    const dense = resample(piece.line, 2);
    for (const p of dense) {
      const last = raw[raw.length - 1];
      if (last && Math.hypot(last.x - p.x, last.z - p.z) < 0.5) continue;
      raw.push(p);
      offsets.push(piece.offset);
    }
  }
  return smooth(resample(offsetEach(raw, offsets), 1), 6);
};

// 進入路 → 交差点の中のつなぎ → 退出路
const throughLane = (approach: Vec[], exit: Vec[]): Vec[] => {
  const a = createPolyline(approach);
  const b = createPolyline(exit);
  return [...approach, ...connect(sampleAt(a, a.length), sampleAt(b, 0), 1), ...exit];
};

// 車線が横断歩道に入る手前（停止線）の位置
const stopBefore = (line: Polyline, crosswalk: Crosswalk) => {
  const polygon = crosswalkPolygon(crosswalk);
  for (let s = 0; s < line.length; s += 0.25) {
    if (pointInPolygon(sampleAt(line, s), polygon)) return s - 1.6;
  }
  throw new Error(`lane does not reach crosswalk ${crosswalk.id}`);
};

// 停止線から先で、交差点の車道と横断歩道の外に出たところ（少し余裕を足す）
const clearAfter = (line: Polyline, stopS: number) => {
  const polygons = [JUNCTION, ...CROSSWALKS.map(crosswalkPolygon)];
  let s = stopS + 2;
  while (s < line.length && polygons.some((polygon) => pointInPolygon(sampleAt(line, s), polygon))) s += 0.25;
  return s + 1;
};

const makeLane = (axis: Axis, dir: Dir, path: Vec[], crosswalk: Crosswalk['id']): LaneSpec => {
  const line = createPolyline(path);
  const stopS = stopBefore(line, crosswalkOf(crosswalk));
  return { axis, dir, line, stopS, clearS: clearAfter(line, stopS) };
};

const W4 = { inner: 1.7, outer: 5 };
const N4 = { inner: 2.2, outer: 5.6 };

// A: 東西（道玄坂 ↔ 旧大山街道）、B: 南北（神宮通り）。dir 1 は東行き・南行き。
export const LANE_SPECS: LaneSpec[] = [
  // 東行きは 2 車線とも文化村通りから、西行きは 2 車線とも 109 の南の道玄坂へ（109 の前で車線が交差しないように）
  ...[W4.outer, W4.inner].map((offset) =>
    makeLane(
      'A',
      1,
      throughLane(
        lanePath([
          { line: reversed(BUNKAMURA), offset },
          { line: reversed(DOGENZAKA), offset }
        ]),
        lanePath([{ line: EAST, offset }])
      ),
      'W'
    )
  ),
  ...[W4.inner, W4.outer].map((offset) =>
    makeLane(
      'A',
      -1,
      throughLane(
        lanePath([{ line: reversed(EAST), offset }]),
        lanePath([
          { line: DOGENZAKA, offset },
          { line: DOGENZAKA_SW, offset }
        ])
      ),
      'E'
    )
  ),
  // 南行き: 神宮通りの北から、南行きの一方通行へ
  makeLane(
    'B',
    1,
    throughLane(lanePath([{ line: reversed(NORTH), offset: N4.inner }]), lanePath([{ line: SOUTH_OUT, offset: -1.6 }])),
    'N'
  ),
  makeLane(
    'B',
    1,
    throughLane(lanePath([{ line: reversed(NORTH), offset: N4.outer }]), lanePath([{ line: SOUTH_OUT, offset: 1.6 }])),
    'N'
  ),
  // 北行き: 西側の 1 車線から、神宮通りの北の西側へ
  makeLane(
    'B',
    -1,
    throughLane(
      lanePath([{ line: [...SOUTH_IN, ...SOUTH_IN_TURN], offset: 0 }]),
      lanePath([{ line: NORTH, offset: 5 }])
    ),
    'S'
  )
];

// ---------------------------------------------------------------- 高架線路（OpenStreetMap の山手線・山手貨物線）

// 北から南へ。0: 山手線（西）、1: 山手線（東）、2・3: 山手貨物線（西・東）
export const TRACKS: Vec[][] = [
  points([
    [73, -297],
    [72, -280],
    [67, -193],
    [61, -112],
    [58, -73],
    [55, -40],
    [54, -13],
    [56, 18],
    [58, 40],
    [59, 50],
    [64, 78],
    [73, 112],
    [93, 161],
    [109, 194],
    [123, 223],
    [157, 276],
    [165, 289],
    [184, 318]
  ]),
  points([
    [77, -296],
    [76, -278],
    [71, -193],
    [68, -150],
    [66, -112],
    [63, -72],
    [62, -40],
    [62, -14],
    [65, 18],
    [67, 32],
    [70, 43],
    [73, 59],
    [78, 78],
    [83, 94],
    [88, 108],
    [94, 125],
    [108, 156],
    [123, 189],
    [161, 266],
    [174, 290],
    [182, 304]
  ]),
  points([
    [80, -277],
    [68, -73],
    [68, -39],
    [69, -14],
    [71, 17],
    [74, 41],
    [80, 71],
    [91, 106],
    [97, 124],
    [110, 154],
    [126, 187],
    [133, 204],
    [163, 264],
    [191, 311]
  ]),
  points([
    [84, -276],
    [72, -72],
    [72, -39],
    [74, -14],
    [78, 16],
    [86, 42],
    [91, 67],
    [101, 94],
    [112, 120],
    [126, 149],
    [157, 219],
    [177, 262]
  ])
].map((list) => smooth(resample(list, 2), 3));

// 山手線のホーム（2 本の線路の間の島式ホーム）の範囲
export const PLATFORM = { z0: 18, z1: 118 };
// 電車が止まる位置（編成の中心）の z
export const STATION_Z = 68;
