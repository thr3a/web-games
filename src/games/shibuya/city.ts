import * as THREE from 'three';
import {
  type Axis,
  CROSSWALKS,
  createPolyline,
  crosswalkPolygon,
  type Dir,
  JUNCTION,
  LANE_SPECS,
  type LaneSpec,
  leftOf,
  PLATFORM,
  type Polyline,
  pointInPolygon,
  sampleAt,
  TRACKS,
  type Vec
} from './layout';
import { createRandom, LAYOUT } from './model';
import { OSM_BUILDINGS, OSM_ROADS } from './osm';

// 街並みの静的な部分（道路・横断歩道・建物・看板・高架・街路樹・信号機）を組み立てる。
// 描画負荷を抑えるため、同じ材質の面は 1 つの BufferGeometry にまとめる。
// 建物の形と道路の中心線は OpenStreetMap（osm.ts）、交差点の中心部は layout.ts から作る。

type P3 = [number, number, number];
type Batch = { position: number[]; normal: number[]; uv: number[]; color: number[] };

const createBatch = (): Batch => ({ position: [], normal: [], uv: [], color: [] });

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// 法線の向きに合わせて、表から見て反時計回りになるよう頂点の順を整える。
const pushTri = (
  batch: Batch,
  points: [P3, P3, P3],
  normal: P3,
  uvs: [[number, number], [number, number], [number, number]],
  color: THREE.Color
) => {
  const [a, b, c] = points;
  const order = dot(cross(sub(b, a), sub(c, a)), normal) >= 0 ? [0, 1, 2] : [0, 2, 1];
  for (const i of order) {
    batch.position.push(...points[i]);
    batch.normal.push(...normal);
    batch.uv.push(...uvs[i]);
    batch.color.push(color.r, color.g, color.b);
  }
};

const pushQuad = (
  batch: Batch,
  points: [P3, P3, P3, P3],
  normal: P3,
  uvs: [[number, number], [number, number], [number, number], [number, number]],
  color: THREE.Color
) => {
  pushTri(batch, [points[0], points[1], points[2]], normal, [uvs[0], uvs[1], uvs[2]], color);
  pushTri(batch, [points[0], points[2], points[3]], normal, [uvs[0], uvs[2], uvs[3]], color);
};

// 地面に貼る平らな四角形（ペイントや舗装）。4 点は x-z 平面上の点。
const pushFlat = (batch: Batch, corners: [Vec, Vec, Vec, Vec], y: number, color: THREE.Color) => {
  const points: [P3, P3, P3, P3] = [
    [corners[0].x, y, corners[0].z],
    [corners[1].x, y, corners[1].z],
    [corners[2].x, y, corners[2].z],
    [corners[3].x, y, corners[3].z]
  ];
  const uvs: [[number, number], [number, number], [number, number], [number, number]] = [
    [corners[0].x, corners[0].z],
    [corners[1].x, corners[1].z],
    [corners[2].x, corners[2].z],
    [corners[3].x, corners[3].z]
  ];
  pushQuad(batch, points, [0, 1, 0], uvs, color);
};

const pushRect = (batch: Batch, x0: number, x1: number, z0: number, z1: number, y: number, color: THREE.Color) =>
  pushFlat(
    batch,
    [
      { x: x0, z: z0 },
      { x: x1, z: z0 },
      { x: x1, z: z1 },
      { x: x0, z: z1 }
    ],
    y,
    color
  );

// 凹んだ形もありうる多角形を地面に貼る
const pushPolygon = (batch: Batch, ring: Vec[], y: number, color: THREE.Color) => {
  const triangles = THREE.ShapeUtils.triangulateShape(
    ring.map((p) => new THREE.Vector2(p.x, p.z)),
    []
  );
  for (const [i, j, k] of triangles) {
    const tri: [P3, P3, P3] = [
      [ring[i].x, y, ring[i].z],
      [ring[j].x, y, ring[j].z],
      [ring[k].x, y, ring[k].z]
    ];
    pushTri(
      batch,
      tri,
      [0, 1, 0],
      [
        [ring[i].x, ring[i].z],
        [ring[j].x, ring[j].z],
        [ring[k].x, ring[k].z]
      ],
      color
    );
  }
};

// x 東・z 南の座標での符号付き面積。正なら上から見て時計回り。
const ringArea = (ring: Vec[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
};

// 辺 a→b の外向きの法線（ring の巻き方向から決める。凹んだ形でも正しい向きになる）
const outwardNormal = (a: Vec, b: Vec, sign: number): Vec => {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (sign * (b.z - a.z)) / len, z: (-sign * (b.x - a.x)) / len };
};

// uStart は壁の UV の始まり。窓の格子の幅の整数倍にすれば見た目は変わらない。
type PrismOptions = { roof?: Batch; roofColor?: THREE.Color; bottom?: boolean; uStart?: number };

// 多角形の底面を y0 から y1 まで押し出した柱。壁の UV は m 単位（窓の格子をそろえるため）。
const pushPrism = (
  walls: Batch,
  footprint: Vec[],
  y0: number,
  y1: number,
  color: THREE.Color,
  options: PrismOptions = {}
) => {
  const n = footprint.length;
  const sign = ringArea(footprint) >= 0 ? 1 : -1;
  let u = options.uStart ?? 0;
  for (let i = 0; i < n; i++) {
    const a = footprint[i];
    const b = footprint[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const normal = outwardNormal(a, b, sign);
    pushQuad(
      walls,
      [
        [a.x, y0, a.z],
        [b.x, y0, b.z],
        [b.x, y1, b.z],
        [a.x, y1, a.z]
      ],
      [normal.x, 0, normal.z],
      [
        [u, y0],
        [u + len, y0],
        [u + len, y1],
        [u, y1]
      ],
      color
    );
    u += len;
  }
  const roof = options.roof ?? walls;
  const roofColor = options.roofColor ?? color;
  const triangles = THREE.ShapeUtils.triangulateShape(
    footprint.map((p) => new THREE.Vector2(p.x, p.z)),
    []
  );
  for (const [i, j, k] of triangles) {
    const top: [P3, P3, P3] = [
      [footprint[i].x, y1, footprint[i].z],
      [footprint[j].x, y1, footprint[j].z],
      [footprint[k].x, y1, footprint[k].z]
    ];
    pushTri(
      roof,
      top,
      [0, 1, 0],
      [
        [top[0][0], top[0][2]],
        [top[1][0], top[1][2]],
        [top[2][0], top[2][2]]
      ],
      roofColor
    );
    if (!options.bottom) continue;
    const low: [P3, P3, P3] = [
      [top[0][0], y0, top[0][2]],
      [top[1][0], y0, top[1][2]],
      [top[2][0], y0, top[2][2]]
    ];
    pushTri(
      walls,
      low,
      [0, -1, 0],
      [
        [0, 0],
        [0, 0],
        [0, 0]
      ],
      color
    );
  }
};

const circleFootprint = (cx: number, cz: number, r: number, segments: number): Vec[] =>
  Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r };
  });

// 向き付きの箱。along は横方向の単位ベクトル、幅 w・奥行き d。
const pushBox = (
  batch: Batch,
  center: P3,
  size: P3,
  color: THREE.Color,
  along: Vec = { x: 1, z: 0 },
  options: PrismOptions = {}
) => {
  const [w, h, d] = size;
  const across = { x: -along.z, z: along.x };
  const corner = (sa: number, sd: number): Vec => ({
    x: center[0] + along.x * (w / 2) * sa + across.x * (d / 2) * sd,
    z: center[2] + along.z * (w / 2) * sa + across.z * (d / 2) * sd
  });
  pushPrism(
    batch,
    [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)],
    center[1] - h / 2,
    center[1] + h / 2,
    color,
    {
      bottom: true,
      ...options
    }
  );
};

// 2 点を結ぶ箱（線路の桁やレールのように、折れ線に沿って並べるもの）
const pushBeam = (batch: Batch, a: Vec, b: Vec, y: number, height: number, width: number, color: THREE.Color) => {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1e-6) return;
  pushBox(batch, [(a.x + b.x) / 2, y, (a.z + b.z) / 2], [len + 0.04, height, width], color, {
    x: (b.x - a.x) / len,
    z: (b.z - a.z) / len
  });
};

const toGeometry = (batch: Batch) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.color, 3));
  geometry.computeBoundingSphere();
  return geometry;
};

const flatPoints = (flat: number[]): Vec[] => {
  const list: Vec[] = [];
  for (let i = 0; i < flat.length; i += 2) list.push({ x: flat[i], z: flat[i + 1] });
  return list;
};

const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

// ---------------------------------------------------------------- テクスチャ

type Drawer = (ctx: CanvasRenderingContext2D, size: number) => void;

const canvasTexture = (size: number, draw: Drawer, repeat?: [number, number]) => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (repeat) texture.repeat.set(repeat[0], repeat[1]);
  return texture;
};

// 1 枚が窓 1 区画 × 1 フロア分。canvas の上下と UV の上下は逆なので、下端が床側になる。
const drawGlass: Drawer = (ctx, size) => {
  ctx.fillStyle = '#7f93a6';
  ctx.fillRect(0, 0, size, size);
  const glass = ctx.createLinearGradient(0, 0, size, size);
  glass.addColorStop(0, '#c9dbe9');
  glass.addColorStop(1, '#8aa5bd');
  ctx.fillStyle = glass;
  ctx.fillRect(size * 0.06, size * 0.04, size * 0.88, size * 0.74);
  ctx.fillStyle = '#5f6f80';
  ctx.fillRect(0, size * 0.8, size, size * 0.2);
};

const drawOffice: Drawer = (ctx, size) => {
  ctx.fillStyle = '#e4e1da';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#5b7189';
  ctx.fillRect(0, size * 0.12, size, size * 0.5);
  ctx.fillStyle = '#7f95ab';
  ctx.fillRect(0, size * 0.12, size, size * 0.12);
  ctx.fillStyle = '#d4d0c8';
  ctx.fillRect(size * 0.47, size * 0.12, size * 0.06, size * 0.5);
};

const drawApartment: Drawer = (ctx, size) => {
  ctx.fillStyle = '#e8dccb';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#6a7d90';
  ctx.fillRect(size * 0.2, size * 0.18, size * 0.6, size * 0.48);
  ctx.fillStyle = '#9fb1c2';
  ctx.fillRect(size * 0.2, size * 0.18, size * 0.6, size * 0.1);
  ctx.fillStyle = '#cbbfae';
  ctx.fillRect(0, size * 0.72, size, size * 0.08);
};

const drawDark: Drawer = (ctx, size) => {
  ctx.fillStyle = '#22262d';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#3c4757';
  ctx.fillRect(size * 0.04, size * 0.04, size * 0.92, size * 0.8);
  ctx.fillStyle = 'rgba(160,190,220,0.25)';
  ctx.beginPath();
  ctx.moveTo(size * 0.04, size * 0.6);
  ctx.lineTo(size * 0.5, size * 0.04);
  ctx.lineTo(size * 0.75, size * 0.04);
  ctx.lineTo(size * 0.04, size * 0.84);
  ctx.fill();
};

// 白い壁に赤い窓枠（渋谷駅前ビルのような外観）
const drawFramed: Drawer = (ctx, size) => {
  ctx.fillStyle = '#f2f0ec';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#c8323a';
  ctx.fillRect(size * 0.14, size * 0.16, size * 0.72, size * 0.56);
  ctx.fillStyle = '#5d7590';
  ctx.fillRect(size * 0.2, size * 0.22, size * 0.6, size * 0.44);
  ctx.fillStyle = '#8fa6bd';
  ctx.fillRect(size * 0.2, size * 0.22, size * 0.6, size * 0.1);
};

// 銀色のパネル（109 の外壁）
const drawPanel: Drawer = (ctx, size) => {
  ctx.fillStyle = '#c9ccd0';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#b3b7bc';
  ctx.fillRect(size * 0.48, 0, size * 0.04, size);
  ctx.fillStyle = '#9ea4ab';
  ctx.fillRect(0, size * 0.86, size, size * 0.14);
};

// 歩道のタイル（1 枚 = 2m 四方）
const drawPaving: Drawer = (ctx, size) => {
  ctx.fillStyle = '#c9bcb4';
  ctx.fillRect(0, 0, size, size);
  const random = createRandom(5);
  const cell = size / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const shade = 196 + Math.floor(random() * 18);
      ctx.fillStyle = `rgb(${shade + 8},${shade - 4},${shade - 10})`;
      ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    }
  }
};

const drawAsphalt: Drawer = (ctx, size) => {
  ctx.fillStyle = '#5b5d62';
  ctx.fillRect(0, 0, size, size);
  const random = createRandom(9);
  for (let i = 0; i < 900; i++) {
    const shade = 70 + Math.floor(random() * 40);
    ctx.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
    ctx.fillRect(random() * size, random() * size, 2, 2);
  }
};

// 窓の範囲（1 区画に対する割合で x, y, 幅, 高さ）。夜に明かりを点ける部分。
type WindowRect = [number, number, number, number];
type Style = 'glass' | 'office' | 'apartment' | 'dark' | 'framed' | 'panel';
const STYLE_SPECS: Record<Style, { draw: Drawer; cell: [number, number]; roughness: number; windows: WindowRect[] }> = {
  glass: { draw: drawGlass, cell: [3, 3.8], roughness: 0.35, windows: [[0.06, 0.04, 0.88, 0.74]] },
  office: {
    draw: drawOffice,
    cell: [3.2, 3.6],
    roughness: 0.75,
    windows: [
      [0, 0.12, 0.47, 0.5],
      [0.53, 0.12, 0.47, 0.5]
    ]
  },
  apartment: { draw: drawApartment, cell: [3, 3.1], roughness: 0.85, windows: [[0.2, 0.18, 0.6, 0.48]] },
  dark: { draw: drawDark, cell: [2.6, 3.8], roughness: 0.4, windows: [[0.04, 0.04, 0.92, 0.8]] },
  framed: { draw: drawFramed, cell: [2.4, 3.4], roughness: 0.7, windows: [[0.2, 0.22, 0.6, 0.44]] },
  // 109 の銀色のパネルには窓がない
  panel: { draw: drawPanel, cell: [1.6, 3.6], roughness: 0.45, windows: [] }
};

// 窓の部分だけ白い、夜の明かり用のマスク
const windowMask =
  (windows: WindowRect[]): Drawer =>
  (ctx, size) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    for (const [x, y, w, h] of windows) ctx.fillRect(x * size, y * size, w * size, h * size);
  };

// 窓 1 区画ごとに明かりを点けるかを決めるシェーダー。uWindowLit が上がるほど点いている窓が増える。
const WINDOW_COMMON = /* glsl */ `
#include <common>
uniform float uWindowLit;
float windowHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;
const WINDOW_EMISSIVE = /* glsl */ `
#ifdef USE_EMISSIVEMAP
  float windowSeed = windowHash(floor(vEmissiveMapUv));
  float windowOn = clamp((uWindowLit - windowSeed) * 25.0, 0.0, 1.0);
  vec3 windowTint = mix(vec3(1.0, 0.78, 0.5), vec3(0.82, 0.9, 1.0), step(0.7, fract(windowSeed * 7.31)));
  float windowLevel = 0.45 + 0.5 * fract(windowSeed * 3.17);
  totalEmissiveRadiance *= texture2D(emissiveMap, vEmissiveMapUv).rgb * windowTint * windowLevel * windowOn;
#endif
`;
const STYLES: Style[] = ['glass', 'office', 'apartment', 'dark', 'framed', 'panel'];
const GENERIC_STYLES: Style[] = ['glass', 'office', 'office', 'apartment', 'apartment', 'dark'];

const TINTS: Record<Style, string[]> = {
  glass: ['#ffffff', '#dfeaf3', '#e9f1e8', '#f3ece4'],
  office: ['#ffffff', '#f1e9dc', '#e2e6ea', '#efe2d6', '#d9d4cc'],
  apartment: ['#ffffff', '#f4e4d2', '#e8ddd8', '#dfe4e0', '#f2d9c6'],
  dark: ['#ffffff', '#d7dde6', '#e6dccf'],
  framed: ['#ffffff'],
  panel: ['#ffffff']
};

const SIGN_COLORS = [
  '#e8383d',
  '#f6c445',
  '#2fa84f',
  '#1f6fd1',
  '#ffffff',
  '#ff7a1a',
  '#d6338a',
  '#00a0c6',
  '#7a3fb5',
  '#1a1d24',
  '#9ad13b'
];

// ---------------------------------------------------------------- 大型ビジョン

const SCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 文字は入れず、色と模様だけが切り替わる映像。6 秒ごとに場面を変える。
const SCREEN_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uSeed;
uniform float uAspect;
uniform float uBoost;

const float SCENES = 6.0;

vec3 palette(float t) {
  return 0.55 + 0.45 * cos(6.2831 * (t + vec3(0.0, 0.33, 0.67)));
}

float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

// 広告らしい単色。ときどき白や黒も混ぜる。
vec3 flatColor(float n) {
  float h = hash(n * 7.13 + uSeed * 31.0);
  if (h < 0.14) return vec3(0.95, 0.95, 0.93);
  if (h < 0.24) return vec3(0.08, 0.09, 0.12);
  return palette(uSeed + h * 1.7);
}

vec3 sceneColor(float id, vec2 uv, float t) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  // 斜めに流れる 2 色の縞
  if (id < 0.5) {
    float v = sin((p.x + p.y * 0.6) * 9.0 - t * 2.5);
    return mix(palette(uSeed + t * 0.03), palette(uSeed + 0.45 + t * 0.03), smoothstep(-0.2, 0.2, v));
  }
  // ゆっくりうねる色の雲
  if (id < 1.5) {
    vec2 q = p * 3.0;
    float n = sin(q.x + t * 0.7) + sin(q.y * 1.3 - t * 0.5) + sin((q.x + q.y) * 0.8 + t * 0.9);
    return palette(n * 0.12 + t * 0.04 + uSeed);
  }
  // ブロックごとに色が変わるモザイク
  if (id < 2.5) {
    vec2 cell = floor(uv * vec2(uAspect * 5.0, 5.0));
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233)) + floor(t * 1.5) * 3.1) * 43758.5453);
    return palette(h * 0.5 + uSeed) * (0.55 + 0.45 * h);
  }
  // 色付きのカプセルが 3 段、交互の向きに流れる帯
  if (id < 3.5) {
    vec3 bg = mix(palette(uSeed + 0.55), palette(uSeed + 0.75), uv.y) * 0.3;
    float ry = uv.y * 3.0;
    float row = floor(ry);
    float ly = fract(ry) - 0.5;
    float dir = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
    float lx = uv.x * uAspect * 3.0 + dir * t * (1.6 + (2.0 - row) * 0.5);
    float cellW = 2.6;
    float n = floor(lx / cellW);
    float fx = mod(lx, cellW) - cellW * 0.5;
    float rad = 0.3;
    float hl = 0.45 + 0.7 * hash(n * 12.9 + row * 7.1);
    vec2 d = abs(vec2(fx, ly)) - vec2(hl - rad, 0.0);
    float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rad;
    float on = 1.0 - smoothstep(-0.03, 0.03, sd);
    return mix(bg, palette(uSeed + hash(n * 3.7 + row * 1.3) * 0.7), on);
  }
  // 一面の単色が、大きなブロック単位で次の色へ切り替わる。切り替わる瞬間だけ差し色が走る。
  if (id < 4.5) {
    float span = 3.0;
    float k = floor(t / span);
    float f = smoothstep(0.0, 0.6, fract(t / span));
    vec2 cell = floor(uv * vec2(uAspect * 6.0, 6.0));
    float h = hash(dot(cell, vec2(12.9898, 78.233)) + k * 1.37);
    float order = 0.55 * h + 0.45 * (cell.x / (uAspect * 6.0));
    vec3 col = mix(flatColor(k + 60.0), flatColor(k + 61.0), step(order, f));
    float flash = step(order, f) * step(f - 0.08, order) * step(f, 0.999);
    return mix(col, flatColor(k + 120.0), flash);
  }
  // 白地に角丸のカードが並び、列ごとに違う速さで上へ流れる
  float cols = max(2.0, floor(uAspect * 2.0 + 0.5));
  float cw = uAspect / cols;
  float ci = floor(uv.x * cols);
  float fx = fract(uv.x * cols);
  float yy = (uv.y + t * 0.07 * (1.0 + mod(ci, 2.0) * 0.5)) / cw;
  vec2 q = vec2(fx, fract(yy)) - 0.5;
  float rad = 0.1;
  vec2 d = abs(q) - vec2(0.42 - rad);
  float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rad;
  float on = 1.0 - smoothstep(-0.01, 0.01, sd);
  float n = ci * 31.0 + floor(yy);
  vec3 card = mix(flatColor(n + 200.0), palette(uSeed + hash(n) * 1.7 + 0.15), q.x + q.y + 0.5);
  return mix(vec3(0.92, 0.93, 0.95), card, on);
}

void main() {
  float span = 6.0;
  float t = uTime + uSeed * 17.0;
  float k = floor(t / span);
  float f = fract(t / span);
  float a = mod(k + floor(uSeed * SCENES), SCENES);
  float b = mod(a + 1.0, SCENES);
  vec3 col = mix(sceneColor(a, vUv, t), sceneColor(b, vUv, t), smoothstep(0.88, 1.0, f));
  vec2 px = fract(vUv * vec2(uAspect * 90.0, 90.0));
  col *= 0.86 + 0.14 * step(0.18, px.x) * step(0.18, px.y);
  // カードの色の mix は重みが 0〜1 をはみ出すので色が負になりうる。負の pow は GPU によって NaN になり、
  // ブルームのぼかしで画面全体に広がって夕方・夜が真っ白になるため、先に 0〜1 に収める。
  col = clamp(col, 0.0, 1.0);
  // 色は sRGB で決めているので、ブルームの後処理（リニアで扱う）に合わせて変換する
  gl_FragColor = vec4(pow(col, vec3(2.2)) * uBoost, 1.0);
}
`;

// ---------------------------------------------------------------- 道路の当たり判定（看板・街路樹・縁石の配置用）

type Segment = { a: Vec; b: Vec; half: number };
const CELL = 24;
const cellKey = (cx: number, cz: number) => `${cx},${cz}`;

const createRoadIndex = (segments: Segment[]) => {
  const grid = new Map<string, Segment[]>();
  for (const segment of segments) {
    const pad = segment.half + 1;
    const x0 = Math.floor((Math.min(segment.a.x, segment.b.x) - pad) / CELL);
    const x1 = Math.floor((Math.max(segment.a.x, segment.b.x) + pad) / CELL);
    const z0 = Math.floor((Math.min(segment.a.z, segment.b.z) - pad) / CELL);
    const z1 = Math.floor((Math.max(segment.a.z, segment.b.z) + pad) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = cellKey(cx, cz);
        const list = grid.get(key);
        if (list) list.push(segment);
        else grid.set(key, [segment]);
      }
    }
  }
  // 点が車道の上か（交差点の中も含む）
  return (p: Vec) => {
    if (pointInPolygon(p, JUNCTION)) return true;
    const list = grid.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
    if (!list) return false;
    for (const { a, b, half } of list) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
      if (Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t) < half) return true;
    }
    return false;
  };
};

const createBuildingIndex = (rings: Vec[][]) => {
  const grid = new Map<string, Vec[][]>();
  for (const ring of rings) {
    const xs = ring.map((p) => p.x);
    const zs = ring.map((p) => p.z);
    for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++) {
      for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
        const key = cellKey(cx, cz);
        const list = grid.get(key);
        if (list) list.push(ring);
        else grid.set(key, [ring]);
      }
    }
  }
  return (p: Vec) => {
    const list = grid.get(cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
    return !!list && list.some((ring) => pointInPolygon(p, ring));
  };
};

// ---------------------------------------------------------------- 本体

export type LampSet = { green: THREE.MeshBasicMaterial; yellow: THREE.MeshBasicMaterial; red: THREE.MeshBasicMaterial };
export type City = {
  group: THREE.Group;
  screens: THREE.ShaderMaterial[];
  // 時間帯に合わせて窓明かりと看板・ビジョンの明るさを変える
  setLights: (windowLit: number, signBoost: number) => void;
  lamps: { A: LampSet; B: LampSet; pedGreen: THREE.MeshBasicMaterial; pedRed: THREE.MeshBasicMaterial };
  dispose: () => void;
};

export const LAMP_COLORS = {
  green: new THREE.Color('#19d3a2'),
  yellow: new THREE.Color('#ffc21a'),
  red: new THREE.Color('#ff3b30'),
  off: new THREE.Color('#2a2f36')
};

// 主要な建物の OSM の id
const ID = {
  qfront: 136691386,
  magnet: 116806281,
  ekimae: 60739635,
  centerGaiCorner: 136690966,
  shibuya109: 55895868,
  station: 904652357,
  // 線路の上にかかる駅の一部（ホームの屋根で表すので出さない）
  stationDeck: 904652318
};

// 交差点の角にある地下鉄の出入口などの小屋
const SHELTERS = new Set([155807210, 155807211, 142438895, 142438894, 155807209, 155807215, 1335178869]);

// 109 の円筒の中心と半径（OSM の外形の円弧から求めた）
const TOWER_109 = { x: -138.4, z: -7.5, r: 7 };

// 道路の色（舗装の上に重ねる）
const PLAZA_TINT = '#e6dacb';
const WALK_TINT = '#d8cdd0';

// ハチ公前広場の舗装
const HACHIKO_PLAZA: Vec[] = [
  { x: 6.6, z: 16 },
  { x: 14.2, z: 11.2 },
  { x: 32, z: 11 },
  { x: 40.4, z: 16.3 },
  { x: 44, z: 46 },
  { x: 20, z: 56 },
  { x: 8, z: 40 }
];

export const createCity = (): City => {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const random = createRandom(2024);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];
  const c = (hex: string) => new THREE.Color(hex);

  const walls: Record<Style, Batch> = {
    glass: createBatch(),
    office: createBatch(),
    apartment: createBatch(),
    dark: createBatch(),
    framed: createBatch(),
    panel: createBatch()
  };
  const roofs = createBatch();
  const plain = createBatch();
  const signs = createBatch();
  const paint = createBatch();
  const paving = createBatch();
  const asphalt = createBatch();
  const screens: THREE.ShaderMaterial[] = [];

  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, shadow: boolean) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(geometry, material);
    return mesh;
  };

  const building = (footprint: Vec[], y0: number, height: number, style: Style, tint: string) => {
    const shade = 0.62 + random() * 0.2;
    // 建物ごとに窓の格子の番号をずらし、隣どうしで窓明かりの点き方がそろわないようにする。
    // 共有の random を使うと以降の配置がすべて変わるので、外形の座標から決める。
    const offset = Math.abs(Math.floor(footprint[0].x * 7.13 + footprint[0].z * 3.71)) % 512;
    pushPrism(walls[style], footprint, y0, height, c(tint), {
      uStart: offset * STYLE_SPECS[style].cell[0],
      roof: roofs,
      roofColor: new THREE.Color(shade, shade, shade * 0.98),
      bottom: y0 > 0
    });
  };

  const addScreenMesh = (geometry: THREE.BufferGeometry, aspect: number, side: THREE.Side = THREE.FrontSide) => {
    const material = new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERTEX,
      fragmentShader: SCREEN_FRAGMENT,
      side,
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: random() },
        uAspect: { value: aspect },
        uBoost: { value: 1 }
      }
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    disposables.push(geometry, material);
    screens.push(material);
    return mesh;
  };

  const screen = (width: number, height: number, center: P3, yaw: number) => {
    const mesh = addScreenMesh(new THREE.PlaneGeometry(width, height), width / height);
    mesh.position.set(...center);
    mesh.rotation.y = yaw;
    // 黒い枠
    const facing = { x: Math.sin(yaw), z: Math.cos(yaw) };
    pushBox(
      signs,
      [center[0] - facing.x * 0.2, center[1], center[2] - facing.z * 0.2],
      [width + 0.8, height + 0.8, 0.35],
      c('#15171c'),
      { x: facing.z, z: -facing.x }
    );
  };

  // 壁の面 a→b（外向きの法線 normal）の中央に貼るビジョン
  const wallScreen = (a: Vec, b: Vec, normal: Vec, y0: number, y1: number, margin: number) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const width = len - margin * 2;
    if (width < 2) return;
    const mid = lerp(a, b, 0.5);
    screen(
      width,
      y1 - y0,
      [mid.x + normal.x * 0.45, (y0 + y1) / 2, mid.z + normal.z * 0.45],
      Math.atan2(normal.x, normal.z)
    );
  };

  // 曲面のビジョン（折れ線に沿って立てた帯）
  const curvedScreen = (line: Vec[], y0: number, y1: number) => {
    const position: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const total = createPolyline(line).length;
    let u = 0;
    line.forEach((p, i) => {
      if (i > 0) u += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z);
      position.push(p.x, y0, p.z, p.x, y1, p.z);
      uv.push(u / total, 0, u / total, 1);
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(index);
    // 裏から見たときに透けないよう両面にする
    addScreenMesh(geometry, total / (y1 - y0), THREE.DoubleSide);
  };

  // 壁から突き出した縦長の袖看板。色違いの段を積み重ねる。
  const bladeSign = (base: Vec, normal: Vec, y0: number, y1: number) => {
    const along = { x: normal.x, z: normal.z };
    const segments = 2 + Math.floor(random() * 3);
    const step = (y1 - y0) / segments;
    for (let i = 0; i < segments; i++) {
      const cy = y0 + step * (i + 0.5);
      pushBox(
        signs,
        [base.x + normal.x * 1.1, cy, base.z + normal.z * 1.1],
        [1.8, step - 0.15, 0.4],
        c(pick(SIGN_COLORS)),
        along
      );
    }
  };

  // 壁に貼った横長の看板（枠の色と中の色を変える）
  const wallSign = (base: Vec, tangent: Vec, normal: Vec, cy: number, width: number, height: number) => {
    const frame = pick(SIGN_COLORS);
    let inner = pick(SIGN_COLORS);
    if (inner === frame) inner = '#ffffff';
    pushBox(signs, [base.x + normal.x * 0.2, cy, base.z + normal.z * 0.2], [width, height, 0.3], c(frame), tangent);
    pushBox(
      signs,
      [base.x + normal.x * 0.38, cy, base.z + normal.z * 0.38],
      [width * 0.84, height * 0.62, 0.06],
      c(inner),
      tangent
    );
  };

  type Facade = { start: Vec; tangent: Vec; normal: Vec; length: number; height: number };
  const decorateFacade = (face: Facade, busy: number) => {
    const at = (a: number): Vec => ({ x: face.start.x + face.tangent.x * a, z: face.start.z + face.tangent.z * a });
    if (random() < 0.75 * busy && face.length > 4) {
      const y0 = 4 + random() * 2;
      const y1 = Math.min(face.height - 1, y0 + 6 + random() * 14);
      if (y1 > y0 + 3) bladeSign(at(0.8 + random() * 1.5), face.normal, y0, y1);
    }
    if (random() < 0.5 * busy && face.length > 8) {
      const y0 = 4 + random() * 2;
      const y1 = Math.min(face.height - 1, y0 + 5 + random() * 10);
      if (y1 > y0 + 3) bladeSign(at(face.length - 0.8 - random() * 1.5), face.normal, y0, y1);
    }
    const boards = Math.floor(random() * 3 * busy);
    for (let i = 0; i < boards; i++) {
      const width = Math.min(face.length - 2, 4 + random() * 7);
      if (width < 3) break;
      const cy = 3.2 + random() * Math.max(1, face.height - 6);
      wallSign(
        at(1 + width / 2 + random() * (face.length - width - 2)),
        face.tangent,
        face.normal,
        cy,
        width,
        1.4 + random() * 1.6
      );
    }
    // 1 階の店先のひさし
    if (random() < 0.7) {
      pushBox(
        signs,
        [at(face.length / 2).x + face.normal.x * 0.6, 3.4, at(face.length / 2).z + face.normal.z * 0.6],
        [face.length - 1, 0.5, 1.2],
        c(pick(SIGN_COLORS)),
        face.tangent
      );
    }
  };

  // ---------------- 道路
  const carRoads = OSM_ROADS.filter((road) => road.k === 'car').map((road) => ({
    line: flatPoints(road.p),
    half: road.w / 2
  }));
  const walkRoads = OSM_ROADS.filter((road) => road.k === 'walk').map((road) => ({
    line: flatPoints(road.p),
    half: road.w / 2
  }));
  const segments: Segment[] = carRoads.flatMap((road) =>
    road.line.slice(1).map((b, i) => ({ a: road.line[i], b, half: road.half }))
  );
  const onRoad = createRoadIndex(segments);
  const groundRings = OSM_BUILDINGS.filter((item) => item.b === 0).map((item) => flatPoints(item.p));
  const inBuilding = createBuildingIndex(groundRings);

  // 道路の帯。折れ目の外側に隙間ができないよう、頂点に多角形の円を置く。
  const ribbon = (batch: Batch, line: Vec[], half: number, y: number, color: THREE.Color) => {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const n = leftOf((b.x - a.x) / len, (b.z - a.z) / len);
      pushFlat(
        batch,
        [
          { x: a.x + n.x * half, z: a.z + n.z * half },
          { x: b.x + n.x * half, z: b.z + n.z * half },
          { x: b.x - n.x * half, z: b.z - n.z * half },
          { x: a.x - n.x * half, z: a.z - n.z * half }
        ],
        y,
        color
      );
    }
    for (let i = 1; i < line.length - 1; i++)
      pushPolygon(batch, circleFootprint(line[i].x, line[i].z, half, 12), y, color);
  };

  const L = 900;
  const pavingTexture = canvasTexture(128, drawPaving, [0.5, 0.5]);
  const asphaltTexture = canvasTexture(128, drawAsphalt, [0.12, 0.12]);
  pushRect(paving, -L, L, -L, L, 0, c('#ffffff'));
  // ハチ公前広場とセンター街などの歩行者の道は少し色の違う舗装
  pushPolygon(paving, HACHIKO_PLAZA, 0.012, c(PLAZA_TINT));
  for (const road of walkRoads) ribbon(paving, road.line, road.half, 0.012, c(WALK_TINT));
  for (const road of carRoads) ribbon(asphalt, road.line, road.half, 0.025, c('#ffffff'));
  pushPolygon(asphalt, JUNCTION, 0.027, c('#ffffff'));

  // 縁石: 車道の縁のうち、外側が別の車道でないところだけ
  const curb = c('#d9d6d0');
  const curbEdge = (a: Vec, b: Vec, normal: Vec) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.5) return;
    const steps = Math.ceil(len / 1.2);
    let runStart = -1;
    const flush = (end: number) => {
      if (runStart < 0) return;
      const p = lerp(a, b, runStart / steps);
      const q = lerp(a, b, end / steps);
      const shift = { x: normal.x * 0.12, z: normal.z * 0.12 };
      pushBeam(
        plain,
        { x: p.x + shift.x, z: p.z + shift.z },
        { x: q.x + shift.x, z: q.z + shift.z },
        0.08,
        0.16,
        0.25,
        curb
      );
      runStart = -1;
    };
    for (let k = 0; k < steps; k++) {
      const m = lerp(a, b, (k + 0.5) / steps);
      const outside = { x: m.x + normal.x * 0.4, z: m.z + normal.z * 0.4 };
      const valid = Math.hypot(m.x, m.z) < 330 && !onRoad(outside);
      if (valid && runStart < 0) runStart = k;
      if (!valid) flush(k);
    }
    flush(steps);
  };
  for (const road of carRoads) {
    for (let i = 1; i < road.line.length; i++) {
      const a = road.line[i - 1];
      const b = road.line[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const n = leftOf((b.x - a.x) / len, (b.z - a.z) / len);
      for (const side of [1, -1]) {
        const edge = (p: Vec): Vec => ({ x: p.x + n.x * road.half * side, z: p.z + n.z * road.half * side });
        curbEdge(edge(a), edge(b), { x: n.x * side, z: n.z * side });
      }
    }
  }
  const junctionSign = ringArea(JUNCTION) >= 0 ? 1 : -1;
  JUNCTION.forEach((a, i) => {
    const b = JUNCTION[(i + 1) % JUNCTION.length];
    curbEdge(a, b, outwardNormal(a, b, junctionSign));
  });

  // ---------------- 路面のペイント
  const white = c('#f4f4f0');
  const yellow = c('#f0c03a');
  const red = c('#a8574d');
  const PAINT_Y = 0.06;
  // 横断歩道。縞は車の進む向きと平行で、歩く向きに 0.9m おきに並ぶ。
  for (const crosswalk of CROSSWALKS) {
    if (crosswalk.unmarked) continue;
    const [a0, a1] = crosswalk.a;
    const [b0, b1] = crosswalk.b;
    const length = Math.hypot((a0.x + a1.x) / 2 - (b0.x + b1.x) / 2, (a0.z + a1.z) / 2 - (b0.z + b1.z) / 2);
    const bars = Math.floor((length - 0.3) / 0.9);
    const margin = (length - bars * 0.9 + 0.45) / 2 / length;
    for (let k = 0; k < bars; k++) {
      const u0 = margin + (k * 0.9) / length;
      const u1 = u0 + 0.45 / length;
      // 縞の両端は縁から 0.3m 内側
      const inset = (p: Vec, q: Vec): [Vec, Vec] => {
        const len = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        const t = 0.3 / len;
        return [lerp(p, q, t), lerp(p, q, 1 - t)];
      };
      const [p0, p1] = inset(lerp(a0, b0, u0), lerp(a1, b1, u0));
      const [q0, q1] = inset(lerp(a0, b0, u1), lerp(a1, b1, u1));
      pushFlat(paint, [p0, p1, q1, q0], PAINT_Y + 0.004, white);
    }
  }
  // 停止線・車線境界・中央線（車線の中心線から決める）
  const insideCrossing = (p: Vec) =>
    pointInPolygon(p, JUNCTION) || CROSSWALKS.some((item) => pointInPolygon(p, crosswalkPolygon(item)));
  const laneLine = (lane: LaneSpec, offset: number, color: THREE.Color, dash: boolean, keep: (p: Vec) => boolean) => {
    const step = 1;
    for (let s = 0; s < lane.line.length - step; s += step) {
      if (dash && Math.floor(s / 3) % 3 !== 0) continue;
      const p = sampleAt(lane.line, s);
      const q = sampleAt(lane.line, s + step);
      const np = leftOf(p.dx, p.dz);
      const nq = leftOf(q.dx, q.dz);
      const pa = { x: p.x + np.x * offset, z: p.z + np.z * offset };
      const qa = { x: q.x + nq.x * offset, z: q.z + nq.z * offset };
      if (Math.hypot(pa.x, pa.z) > 300 || !keep(pa) || insideCrossing(pa) || insideCrossing(qa)) continue;
      pushFlat(
        paint,
        [
          { x: pa.x + np.x * 0.08, z: pa.z + np.z * 0.08 },
          { x: qa.x + nq.x * 0.08, z: qa.z + nq.z * 0.08 },
          { x: qa.x - nq.x * 0.08, z: qa.z - nq.z * 0.08 },
          { x: pa.x - np.x * 0.08, z: pa.z - np.z * 0.08 }
        ],
        PAINT_Y,
        color
      );
    }
  };
  for (const lane of LANE_SPECS) {
    // 停止線
    const p = sampleAt(lane.line, lane.stopS + 0.9);
    const n = leftOf(p.dx, p.dz);
    const back = { x: p.dx * 0.22, z: p.dz * 0.22 };
    pushFlat(
      paint,
      [
        { x: p.x + n.x * 1.7 - back.x, z: p.z + n.z * 1.7 - back.z },
        { x: p.x + n.x * 1.7 + back.x, z: p.z + n.z * 1.7 + back.z },
        { x: p.x - n.x * 1.7 + back.x, z: p.z - n.z * 1.7 + back.z },
        { x: p.x - n.x * 1.7 - back.x, z: p.z - n.z * 1.7 - back.z }
      ],
      PAINT_Y,
      white
    );
    const siblings = LANE_SPECS.filter((item) => item.axis === lane.axis && item.dir === lane.dir);
    const isInner = siblings.length === 1 || siblings.indexOf(lane) === (lane.axis === 'A' ? 1 : 0);
    // 同じ向きの 2 車線の間の破線（内側の車線の左側）
    if (siblings.length > 1 && isInner) laneLine(lane, 1.65, white, true, () => true);
    // 神宮通りの北側の外側の車線は赤いカラー舗装（バス優先レーン）
    const outer = lane.axis === 'B' && (siblings.length === 1 || siblings.indexOf(lane) === 1);
    if (outer) {
      for (let t = 0; t < lane.line.length - 1; t += 1) {
        const p = sampleAt(lane.line, t);
        const q = sampleAt(lane.line, t + 1);
        if (p.z > -32 || p.z < -110 || q.z > -32) continue;
        const np = leftOf(p.dx, p.dz);
        const nq = leftOf(q.dx, q.dz);
        pushFlat(
          paint,
          [
            { x: p.x + np.x * 1.5, z: p.z + np.z * 1.5 },
            { x: q.x + nq.x * 1.5, z: q.z + nq.z * 1.5 },
            { x: q.x - nq.x * 1.5, z: q.z - nq.z * 1.5 },
            { x: p.x - np.x * 1.5, z: p.z - np.z * 1.5 }
          ],
          PAINT_Y - 0.02,
          red
        );
      }
    }
    // 対向車線との間の黄色い中央線（東西の道路と、神宮通りの北側）
    if (siblings.length > 1 && isInner && lane.dir === 1) {
      laneLine(lane, -1.7, yellow, false, (q) => lane.axis === 'A' || q.z < 0);
    }
  }

  // ---------------- 建物（OpenStreetMap）
  const towerFootprint = circleFootprint(TOWER_109.x, TOWER_109.z, TOWER_109.r, 32);
  const special = new Set<number>([
    ID.qfront,
    ID.magnet,
    ID.ekimae,
    ID.shibuya109,
    ID.station,
    ID.stationDeck,
    ...SHELTERS
  ]);
  const decorate = (ring: Vec[], height: number, busyBase: number) => {
    const sign = ringArea(ring) >= 0 ? 1 : -1;
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 4) return;
      const normal = outwardNormal(a, b, sign);
      const mid = lerp(a, b, 0.5);
      // 道路に面した壁だけ飾る
      if (!onRoad({ x: mid.x + normal.x * 6, z: mid.z + normal.z * 6 })) return;
      decorateFacade(
        { start: a, tangent: { x: (b.x - a.x) / length, z: (b.z - a.z) / length }, normal, length, height },
        busyBase
      );
    });
  };

  for (const item of OSM_BUILDINGS) {
    if (special.has(item.id)) continue;
    const ring = flatPoints(item.p);
    const cx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length;
    const cz = ring.reduce((sum, p) => sum + p.z, 0) / ring.length;
    const dist = Math.hypot(cx, cz);
    const style =
      item.h > 60 ? pick<Style>(['glass', 'glass', 'dark']) : GENERIC_STYLES[item.id % GENERIC_STYLES.length];
    building(ring, item.b, item.h, style, TINTS[style][item.id % TINTS[style].length]);
    // 屋上の設備
    if (random() < 0.45 && item.h < 120) {
      const w = 2 + random() * 4;
      const d = 2 + random() * 4;
      if (pointInPolygon({ x: cx, z: cz }, ring)) pushBox(plain, [cx, item.h + 1, cz], [w, 2, d], c('#b9bcbf'));
    }
    const busy = dist < 70 ? 1 : dist < 150 ? 0.6 : dist < 240 ? 0.25 : 0;
    if (busy > 0 && item.h > 6) decorate(ring, item.h, busy);
    // 交差点の近くの屋上の看板（交差点の方を向ける）
    if (
      dist < 130 &&
      dist > 40 &&
      item.h < 50 &&
      item.h > 12 &&
      random() < 0.3 &&
      pointInPolygon({ x: cx, z: cz }, ring)
    ) {
      const face = { x: -cx / dist, z: -cz / dist };
      pushBox(signs, [cx, item.h + 3.2, cz], [9, 5, 0.4], c(pick(SIGN_COLORS)), { x: -face.z, z: face.x });
    }
  }

  // 地下鉄の出入口などの小屋（ガラスの箱に屋根）
  for (const item of OSM_BUILDINGS) {
    if (!SHELTERS.has(item.id)) continue;
    const ring = flatPoints(item.p);
    pushPrism(walls.glass, ring, 0, 2.8, c('#eef4f6'), { roof: roofs, roofColor: c('#8d949b') });
    pushPrism(plain, ring, 2.8, 3.2, c('#8d949b'));
  }

  const ringOf = (id: number) => {
    const item = OSM_BUILDINGS.find((entry) => entry.id === id);
    return item ? flatPoints(item.p) : [];
  };

  // QFRONT: 交差点に向いた曲面のガラス面に大型ビジョン、屋上に鉄骨の枠
  const qfront = ringOf(ID.qfront);
  if (qfront.length > 0) {
    building(qfront, 0, 38, 'glass', '#e4eef6');
    const front: Vec[] = Array.from({ length: 13 }, (_, i) => {
      // 南東の面は (-4.4, -33.1) から (-22.1, -31.5) へゆるく張り出した弧
      const t = i / 12;
      const bulge = Math.sin(t * Math.PI) * 1.1;
      return { x: -4.4 + (-22.1 + 4.4) * t + bulge * 0.09, z: -33.1 + (-31.5 + 33.1) * t + bulge };
    });
    curvedScreen(
      front.map((p) => ({ x: p.x, z: p.z + 0.5 })),
      12,
      33
    );
    // 低層の店舗の帯
    for (let i = 1; i < front.length; i++) {
      pushBeam(
        signs,
        { x: front[i - 1].x, z: front[i - 1].z + 0.6 },
        { x: front[i].x, z: front[i].z + 0.6 },
        4.4,
        1.2,
        0.3,
        c('#1a1d24')
      );
    }
    // 屋上の枠（柱と上の輪）
    const sign = ringArea(qfront) >= 0 ? 1 : -1;
    qfront.forEach((a, i) => {
      const b = qfront[(i + 1) % qfront.length];
      const n = outwardNormal(a, b, sign);
      const inset = (p: Vec) => ({ x: p.x - n.x * 0.6, z: p.z - n.z * 0.6 });
      pushBeam(plain, inset(a), inset(b), 45.4, 0.5, 0.5, c('#c7cdd3'));
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      for (let k = 0; k <= Math.floor(len / 4); k++) {
        const p = inset(lerp(a, b, k / Math.max(1, Math.floor(len / 4))));
        pushBox(plain, [p.x, 41.7, p.z], [0.35, 7.4, 0.35], c('#c7cdd3'));
      }
    });
  }

  // MAGNET（北東）: 黒いガラスのビル。交差点に向いた角の面と南の面にビジョン。
  const magnet = ringOf(ID.magnet);
  if (magnet.length > 0) {
    building(magnet, 0, 34.2, 'dark', '#ffffff');
    const chamferA = { x: 20.2, z: -21.5 };
    const chamferB = { x: 27.2, z: -12.4 };
    const sign = ringArea(magnet) >= 0 ? 1 : -1;
    const chamferNormal = outwardNormal(chamferB, chamferA, sign);
    wallScreen(chamferB, chamferA, chamferNormal, 11, 27, 0.8);
    const southA = { x: 44.4, z: -11.5 };
    wallScreen(southA, chamferB, outwardNormal(southA, chamferB, sign), 18, 27, 2.5);
    // 縦長の看板
    for (let i = 0; i < 6; i++) {
      pushBox(
        signs,
        [20.9 + chamferNormal.x * 0.8, 5 + i * 1.9, -20.6 + chamferNormal.z * 0.8],
        [0.4, 1.7, 2.6],
        c(SIGN_COLORS[(i * 3) % SIGN_COLORS.length]),
        { x: chamferNormal.x, z: chamferNormal.z }
      );
    }
    pushBox(signs, [36, 36.4, -12.6], [14, 3.6, 0.4], c('#e8383d'));
  }

  // 渋谷駅前ビル（南西の角）: 白い壁に赤い窓枠、壁一面の看板、屋上に大型ビジョン 2 面
  const ekimae = ringOf(ID.ekimae);
  if (ekimae.length > 0) {
    building(ekimae, 0, 35.1, 'framed', '#ffffff');
    const sign = ringArea(ekimae) >= 0 ? 1 : -1;
    const northA = { x: -68.9, z: 7.3 };
    const northB = { x: -51.8, z: 7.9 };
    const chamferB = { x: -41.7, z: 19.9 };
    const northNormal = outwardNormal(northA, northB, sign);
    const chamferNormal = outwardNormal(northB, chamferB, sign);
    const faces: [Vec, Vec, Vec][] = [
      [northA, northB, northNormal],
      [northB, chamferB, chamferNormal]
    ];
    for (const [a, b, n] of faces) {
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const tangent = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
      for (let row = 0; row < 6; row++) {
        const mid = lerp(a, b, 0.5);
        wallSign(mid, tangent, n, 6 + row * 3.6, len * 0.8, 2.4);
      }
    }
    // 屋上のビジョン（交差点を向く）と下の白い帯
    const roofScreen = (a: Vec, b: Vec, n: Vec) => {
      const p = lerp(a, b, 0.5);
      const inward = { x: p.x - n.x * 3, z: p.z - n.z * 3 };
      const len = Math.hypot(b.x - a.x, b.z - a.z) * 0.85;
      const tangent = {
        x: (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z),
        z: (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z)
      };
      screen(len, 9, [inward.x + n.x * 0.3, 44.5, inward.z + n.z * 0.3], Math.atan2(n.x, n.z));
      pushBox(signs, [inward.x + n.x * 0.3, 38.4, inward.z + n.z * 0.3], [len, 2.2, 0.4], c('#ffffff'), tangent);
      pushBox(plain, [inward.x - n.x * 1.2, 40.5, inward.z - n.z * 1.2], [len, 11, 0.6], c('#3a3f45'), tangent);
    };
    roofScreen({ x: -62, z: 7.55 }, northB, northNormal);
    roofScreen(northB, chamferB, chamferNormal);
    // 角の縦長の看板
    bladeSign({ x: -42.6, z: 19 }, chamferNormal, 5, 30);
  }

  // センター街の入口の西側のビル: 屋上に大きな看板、交差点向きの面にビジョン
  const corner = ringOf(ID.centerGaiCorner);
  if (corner.length > 0) {
    const a = { x: -44, z: -25.3 };
    const b = { x: -37.6, z: -31.1 };
    const sign = ringArea(corner) >= 0 ? 1 : -1;
    // 外形の頂点は b → a の順に並んでいるので、外向きの法線は b → a で求める
    const n = outwardNormal(b, a, sign);
    // 実物の DHC のビジョンと同じく上の方、屋上のすぐ下に置く（枠は実物の青ではなく他と同じ黒）
    wallScreen(a, b, n, 13.5, 21.5, 0.6);
    const center = lerp(a, b, 0.5);
    const tangent = {
      x: (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z),
      z: (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z)
    };
    // サロンパスの看板: 下が緑、上が青で、間に白い線
    pushBox(signs, [center.x - n.x * 2, 30, center.z - n.z * 2], [10, 6.5, 0.5], c('#2fa84f'), tangent);
    pushBox(signs, [center.x - n.x * 2, 33.5, center.z - n.z * 2], [10, 0.5, 0.5], c('#ffffff'), tangent);
    pushBox(signs, [center.x - n.x * 2, 36.35, center.z - n.z * 2], [10, 5.2, 0.5], c('#1f6fd1'), tangent);
    // 後ろの板は青い看板の上にはみ出さない高さまで（y 24〜38.9）
    pushBox(plain, [center.x - n.x * 2.6, 31.45, center.z - n.z * 2.6], [10, 14.9, 0.4], c('#9ca2a8'), tangent);
  }

  // 109: 道玄坂と文化村通りの分かれ目に立つ。銀色の円筒の塔の上に白い看板の筒、正面に縦長の広告。
  const shibuya109 = ringOf(ID.shibuya109);
  if (shibuya109.length > 0) {
    building(shibuya109, 0, 33.6, 'panel', '#ffffff');
    pushPrism(walls.panel, towerFootprint, 0, 41, c('#f2f3f5'), { roof: roofs, roofColor: c('#aeb3b8') });
    // 上の看板の筒（白地に赤い帯。文字は入れない）
    pushPrism(signs, circleFootprint(TOWER_109.x, TOWER_109.z, TOWER_109.r + 0.25, 32), 41, 47.5, c('#f7f7f7'));
    pushPrism(signs, circleFootprint(TOWER_109.x, TOWER_109.z, TOWER_109.r + 0.32, 32), 43.2, 45.6, c('#d2232f'));
    pushPrism(plain, circleFootprint(TOWER_109.x, TOWER_109.z, TOWER_109.r - 0.4, 32), 47.5, 48.2, c('#9ca2a8'));
    // 交差点（東）を向いた正面の縦長の広告
    const front = Array.from({ length: 9 }, (_, i) => {
      const angle = -0.6 + (1.2 * i) / 8;
      return {
        x: TOWER_109.x + Math.cos(angle) * (TOWER_109.r + 0.3),
        z: TOWER_109.z + Math.sin(angle) * (TOWER_109.r + 0.3)
      };
    });
    curvedScreen(front, 14, 36);
    // 縦の銀色のリブ
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2;
      if (Math.cos(angle) > 0.8) continue;
      pushBox(
        plain,
        [
          TOWER_109.x + Math.cos(angle) * (TOWER_109.r + 0.15),
          20.5,
          TOWER_109.z + Math.sin(angle) * (TOWER_109.r + 0.15)
        ],
        [0.35, 41, 0.35],
        c('#dfe2e6')
      );
    }
  }

  // 駅舎: 高架の下の低い建物（線路とホームは別に作る）
  const station = ringOf(ID.station);
  if (station.length > 0) building(station, 0, LAYOUT.railY - 1.6, 'office', '#efe7da');

  // ハチ公像
  pushBox(plain, [27, 0.7, 24], [1.2, 1.4, 1.6], c('#8d8a85'));
  pushBox(plain, [27, 1.75, 24.05], [0.35, 0.45, 0.9], c('#6b5a3c'));
  pushBox(plain, [27, 2.1, 24.55], [0.32, 0.38, 0.38], c('#6b5a3c'));

  // ---------------- 高架線路と駅のホーム
  const concrete = c('#b3afa7');
  const railTop = LAYOUT.railY - 0.2;
  // 道路をまたぐ部分（旧大山街道の上）は鋼製の桁
  const overRoad = (p: Vec) => onRoad(p);
  TRACKS.forEach((track, index) => {
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1];
      const b = track[i];
      const mid = lerp(a, b, 0.5);
      const steel = overRoad(mid) && Math.abs(mid.z) < 30;
      pushBeam(plain, a, b, railTop - 0.6, 1.2, 4.9, steel ? c('#4d7a5a') : concrete);
      pushBeam(plain, a, b, railTop + 0.05, 0.1, 3, c('#7d7a75'));
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const n = leftOf((b.x - a.x) / len, (b.z - a.z) / len);
      for (const r of [-0.53, 0.53]) {
        pushBeam(
          plain,
          { x: a.x + n.x * r, z: a.z + n.z * r },
          { x: b.x + n.x * r, z: b.z + n.z * r },
          railTop + 0.16,
          0.14,
          0.12,
          c('#5d5c5a')
        );
      }
      // 外側の壁（山手線の西側と貨物線の東側）
      const wallSide = index === 0 ? 1 : index === 3 ? -1 : 0;
      if (wallSide !== 0) {
        const off = 2.45 * wallSide;
        pushBeam(
          plain,
          { x: a.x + n.x * off, z: a.z + n.z * off },
          { x: b.x + n.x * off, z: b.z + n.z * off },
          railTop + 0.5,
          1.2,
          0.35,
          steel ? c('#4d7a5a') : c('#c4c0b8')
        );
      }
    }
  });
  // 橋脚と架線柱（山手線の西の線路と貨物線の東の線路の間に渡す）
  const west = createPolyline(TRACKS[0]);
  const eastTrack = createPolyline(TRACKS[3]);
  const nearestOnEast = (p: Vec) => {
    let best = eastTrack.points[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const q of eastTrack.points) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
    return { point: best, distance: bestD };
  };
  for (let s = 10; s < west.length; s += 24) {
    const p = sampleAt(west, s);
    const { point: q, distance } = nearestOnEast(p);
    if (distance > 40) continue;
    const mid = lerp(p, q, 0.5);
    const inStation = pointInPolygon(mid, station);
    if (!overRoad(mid) && !inStation) {
      for (const t of [0.12, 0.88]) {
        const pier = lerp(p, q, t);
        if (overRoad(pier)) continue;
        pushBox(plain, [pier.x, (railTop - 1.2) / 2, pier.z], [1.8, railTop - 1.2, 1.8], concrete);
      }
      pushBeam(plain, p, q, railTop - 1.6, 1, 2, concrete);
    }
    if (Math.floor(s / 24) % 2 === 0) {
      const n = leftOf(p.dx, p.dz);
      const outer = { x: p.x + n.x * 2.3, z: p.z + n.z * 2.3 };
      const len = Math.hypot(q.x - outer.x, q.z - outer.z) || 1;
      const outerEast = { x: q.x + ((q.x - outer.x) / len) * 2.3, z: q.z + ((q.z - outer.z) / len) * 2.3 };
      for (const post of [outer, outerEast])
        pushBox(plain, [post.x, railTop + 3.4, post.z], [0.3, 6.8, 0.3], c('#8a8d90'));
      pushBeam(plain, outer, outerEast, railTop + 6.6, 0.3, 0.3, c('#8a8d90'));
    }
  }
  // 山手線の島式ホームと屋根
  const yamanoteWest = createPolyline(TRACKS[0]);
  const yamanoteEast = createPolyline(TRACKS[1]);
  const atZ = (line: Polyline, z: number) => {
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1];
      const b = line.points[i];
      if ((a.z - z) * (b.z - z) <= 0 && a.z !== b.z) return lerp(a, b, (z - a.z) / (b.z - a.z));
    }
    return line.points[0];
  };
  const platformTop = railTop + 1.1;
  for (let z = PLATFORM.z0; z < PLATFORM.z1; z += 2) {
    const w0 = atZ(yamanoteWest, z);
    const e0 = atZ(yamanoteEast, z);
    const w1 = atZ(yamanoteWest, z + 2);
    const e1 = atZ(yamanoteEast, z + 2);
    const edge0 = { x: w0.x + 1.75, z: w0.z };
    const edge1 = { x: e0.x - 1.75, z: e0.z };
    const edge2 = { x: e1.x - 1.75, z: e1.z };
    const edge3 = { x: w1.x + 1.75, z: w1.z };
    pushFlat(plain, [edge0, edge1, edge2, edge3], platformTop, c('#c9c5bd'));
    pushFlat(plain, [edge0, edge1, edge2, edge3], railTop + 6.2, c('#8d98a1'));
    const sides: [Vec, Vec][] = [
      [edge0, edge3],
      [edge1, edge2]
    ];
    for (const [a, b] of sides) {
      pushBeam(plain, a, b, (railTop + platformTop) / 2, platformTop - railTop, 0.2, c('#b9b4ab'));
    }
    if (Math.round(z) % 12 === 0) {
      const mid = lerp(edge0, edge1, 0.5);
      pushBox(
        plain,
        [mid.x, (platformTop + railTop + 6.2) / 2, mid.z],
        [0.4, railTop + 6.2 - platformTop, 0.4],
        c('#8a8d90')
      );
    }
  }

  // ---------------- 信号機
  const pole = c('#7b8086');
  const housing = c('#3a3f45');
  const lampGeometry = new THREE.CircleGeometry(0.17, 16);
  const pedLampGeometry = new THREE.PlaneGeometry(0.3, 0.3);
  disposables.push(lampGeometry, pedLampGeometry);
  const lampMaterial = () => {
    const material = new THREE.MeshBasicMaterial({ color: LAMP_COLORS.off });
    disposables.push(material);
    return material;
  };
  const lamps = {
    A: { green: lampMaterial(), yellow: lampMaterial(), red: lampMaterial() },
    B: { green: lampMaterial(), yellow: lampMaterial(), red: lampMaterial() },
    pedGreen: lampMaterial(),
    pedRed: lampMaterial()
  };
  const addLamp = (geometry: THREE.BufferGeometry, material: THREE.Material, position: P3, yaw: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.rotation.y = yaw;
    group.add(mesh);
  };
  // 歩行者用信号: 横断歩道の両端の柱に、向こう岸を向けて付ける
  for (const crosswalk of CROSSWALKS) {
    if (crosswalk.unmarked) continue;
    const ends: [[Vec, Vec], [Vec, Vec]][] = [
      [crosswalk.a, crosswalk.b],
      [crosswalk.b, crosswalk.a]
    ];
    for (const [near, far] of ends) {
      const p = near[0];
      const q = far[0];
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const facing = { x: (q.x - p.x) / len, z: (q.z - p.z) / len };
      const along = { x: near[0].x - near[1].x, z: near[0].z - near[1].z };
      const alen = Math.hypot(along.x, along.z) || 1;
      const base = {
        x: p.x - facing.x * 0.7 + (along.x / alen) * 0.4,
        z: p.z - facing.z * 0.7 + (along.z / alen) * 0.4
      };
      pushBox(plain, [base.x, 1.9, base.z], [0.16, 3.8, 0.16], pole);
      const center: P3 = [base.x + facing.x * 0.2, 2.9, base.z + facing.z * 0.2];
      pushBox(plain, center, [0.42, 0.9, 0.28], housing, { x: -facing.z, z: facing.x });
      const yaw = Math.atan2(facing.x, facing.z);
      const front = (y: number): P3 => [center[0] + facing.x * 0.15, y, center[2] + facing.z * 0.15];
      addLamp(pedLampGeometry, lamps.pedRed, front(3.1), yaw);
      addLamp(pedLampGeometry, lamps.pedGreen, front(2.7), yaw);
    }
  }
  // 車用信号: 交差点の向こう側の歩道から、車線の上へ腕を伸ばす
  const axes: Axis[] = ['A', 'B'];
  const dirs: Dir[] = [1, -1];
  for (const axis of axes) {
    for (const dir of dirs) {
      const set = axis === 'A' ? lamps.A : lamps.B;
      const lanes = LANE_SPECS.filter((lane) => lane.axis === axis && lane.dir === dir);
      // 交差点を出たところ（車線の点の平均）
      const exits = lanes.map((lane) => {
        let s = lane.stopS + 4;
        while (s < lane.line.length && insideCrossing(sampleAt(lane.line, s))) s += 0.5;
        return sampleAt(lane.line, s + 1.5);
      });
      const head = {
        x: exits.reduce((sum, p) => sum + p.x, 0) / exits.length,
        z: exits.reduce((sum, p) => sum + p.z, 0) / exits.length
      };
      const travel = { x: exits[0].dx, z: exits[0].dz };
      const left = leftOf(travel.x, travel.z);
      // 道路の外（左側の歩道）まで柱をずらす
      let reach = 3;
      while (reach < 16 && onRoad({ x: head.x + left.x * reach, z: head.z + left.z * reach })) reach += 0.5;
      reach += 0.8;
      const base = { x: head.x + left.x * reach, z: head.z + left.z * reach };
      pushBox(plain, [base.x, 3.1, base.z], [0.22, 6.2, 0.22], pole);
      pushBeam(plain, base, head, 5.9, 0.14, 0.14, pole);
      pushBox(plain, [head.x, 5.5, head.z], [1.5, 0.5, 0.34], housing, left);
      const facing = { x: -travel.x, z: -travel.z };
      const yaw = Math.atan2(facing.x, facing.z);
      const lampAt = (offset: number): P3 => [
        head.x + left.x * offset + facing.x * 0.18,
        5.5,
        head.z + left.z * offset + facing.z * 0.18
      ];
      addLamp(lampGeometry, set.green, lampAt(0.45), yaw);
      addLamp(lampGeometry, set.yellow, lampAt(0), yaw);
      addLamp(lampGeometry, set.red, lampAt(-0.45), yaw);
    }
  }

  // ---------------- メッシュ化
  const windowLit = { value: 0 };
  for (const style of STYLES) {
    const spec = STYLE_SPECS[style];
    const repeat: [number, number] = [1 / spec.cell[0], 1 / spec.cell[1]];
    const map = canvasTexture(128, spec.draw, repeat);
    disposables.push(map);
    const material = new THREE.MeshStandardMaterial({
      map,
      vertexColors: true,
      roughness: spec.roughness,
      metalness: 0.05
    });
    if (spec.windows.length > 0) {
      // 区画の番号を map と同じ繰り返しで数えるため、マスクにも同じ repeat を付ける
      const mask = canvasTexture(64, windowMask(spec.windows), repeat);
      disposables.push(mask);
      material.emissiveMap = mask;
      material.emissive.set('#ffffff');
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uWindowLit = windowLit;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', WINDOW_COMMON)
          .replace('#include <emissivemap_fragment>', WINDOW_EMISSIVE);
      };
    }
    addMesh(toGeometry(walls[style]), material, true);
  }
  addMesh(toGeometry(roofs), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), true);
  addMesh(toGeometry(plain), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true);
  const signMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  addMesh(toGeometry(signs), signMaterial, false);
  disposables.push(pavingTexture, asphaltTexture);
  addMesh(
    toGeometry(paving),
    new THREE.MeshStandardMaterial({ map: pavingTexture, vertexColors: true, roughness: 0.95 }),
    false
  );
  const road = addMesh(
    toGeometry(asphalt),
    new THREE.MeshStandardMaterial({
      map: asphaltTexture,
      vertexColors: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    }),
    false
  );
  road.renderOrder = 1;
  const marks = addMesh(
    toGeometry(paint),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    }),
    false
  );
  marks.renderOrder = 2;

  // ---------------- 街路樹
  const trees: { x: number; z: number; scale: number }[] = [];
  // 大通りの両側の歩道に 14m おき（建物・別の道路・交差点のまわりは避ける）
  for (const roadItem of carRoads) {
    if (roadItem.half < 6) continue;
    const line = createPolyline(roadItem.line);
    for (let s = 7; s < line.length; s += 14) {
      const p = sampleAt(line, s);
      const n = leftOf(p.dx, p.dz);
      for (const side of [1, -1]) {
        const t = { x: p.x + n.x * (roadItem.half + 1.1) * side, z: p.z + n.z * (roadItem.half + 1.1) * side };
        const dist = Math.hypot(t.x, t.z);
        if (dist < 38 || dist > 320) continue;
        if (onRoad(t) || inBuilding(t)) continue;
        // 高架の下には植えない
        if (t.x > 45 && t.x < 100 && t.z > -300 && t.z < 200) continue;
        trees.push({ x: t.x, z: t.z, scale: 0.85 + random() * 0.3 });
      }
    }
  }
  // ハチ公前広場と南西の角の大きな木
  for (const [x, z] of [
    [23, 13.2],
    [34.5, 12.6],
    [13, 33],
    [33, 32],
    [-31.5, 15.5],
    [-36.5, 28]
  ]) {
    trees.push({ x, z, scale: 1.5 + random() * 0.3 });
  }
  const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.24, 3, 6);
  trunkGeometry.translate(0, 1.5, 0);
  const crownGeometry = new THREE.IcosahedronGeometry(1.7, 1);
  crownGeometry.translate(0, 4.2, 0);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: '#6e5038', roughness: 0.9 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
  disposables.push(trunkGeometry, crownGeometry, trunkMaterial, crownMaterial);
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, trees.length);
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  trees.forEach((tree, i) => {
    matrix.makeRotationY(random() * Math.PI);
    matrix.scale(new THREE.Vector3(tree.scale, tree.scale, tree.scale));
    matrix.setPosition(tree.x, 0, tree.z);
    trunks.setMatrixAt(i, matrix);
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(i, color.setHSL(0.27 + random() * 0.06, 0.45 + random() * 0.15, 0.32 + random() * 0.1));
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    disposables.push(mesh);
  }

  const setLights = (lit: number, signBoost: number) => {
    windowLit.value = lit;
    signMaterial.color.setScalar(signBoost);
    for (const material of screens) material.uniforms.uBoost.value = signBoost;
  };

  return {
    group,
    screens,
    setLights,
    lamps,
    dispose: () => {
      for (const item of disposables) item.dispose();
    }
  };
};
