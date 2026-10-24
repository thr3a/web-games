// /shibuya の街並み用に、OpenStreetMap（Overpass API）の JSON から建物と道路を取り出して
// src/games/shibuya/osm.ts を生成する。
//
// node の型定義を入れていないので、型チェック対象の src の外に置いている。
//
// 使い方:
//   1. Overpass API から JSON を保存する（範囲は渋谷駅周辺 約 900m 四方）
//      curl -A shibuya-sim --data-urlencode 'data=[out:json][timeout:150];(way["building"](35.6555,139.6955,35.6635,139.7055);way["highway"~"^(primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|trunk|service)$"](35.6555,139.6955,35.6635,139.7055);way["railway"](35.6555,139.6955,35.6635,139.7055););out body;>;out skel qt;' https://overpass-api.de/api/interpreter -o shibuya-osm.json
//   2. node --import tsx ./tools/shibuyaOsm.ts shibuya-osm.json
//
// 座標はスクランブル交差点の中心を原点に、x が東・z が南（1 単位 = 1m）。

import { readFileSync, writeFileSync } from 'node:fs';

type OsmTags = Record<string, string>;
type OsmNode = { type: 'node'; id: number; lat: number; lon: number };
type OsmWay = { type: 'way'; id: number; nodes: number[]; tags?: OsmTags };
type OsmElement = OsmNode | OsmWay | { type: 'relation'; id: number };
type Point = [number, number];

const ORIGIN = { lat: 35.659482, lon: 139.70056 };
const METERS_PER_LAT = 110574;
const METERS_PER_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
// 交差点から離れすぎた建物は出さない（フォグの外）
const MAX_DISTANCE = 460;

const input = process.argv[2];
if (!input) {
  console.error('usage: node --import tsx ./tools/shibuyaOsm.ts <overpass.json>');
  process.exit(1);
}

const parsed: { elements: OsmElement[]; osm3s?: { timestamp_osm_base?: string } } = JSON.parse(
  readFileSync(input, 'utf8')
);
const nodes = new Map<number, Point>();
const ways: OsmWay[] = [];
for (const element of parsed.elements) {
  if (element.type === 'node') {
    nodes.set(element.id, [
      (element.lon - ORIGIN.lon) * METERS_PER_LON,
      -(element.lat - ORIGIN.lat) * METERS_PER_LAT
    ]);
  }
  if (element.type === 'way') ways.push(element);
}

const round = (value: number) => Math.round(value * 10) / 10;

const wayPoints = (way: OsmWay): Point[] => {
  const list: Point[] = [];
  for (const id of way.nodes) {
    const point = nodes.get(id);
    if (point) list.push(point);
  }
  return list;
};

const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};

// Douglas-Peucker で細かすぎる点を間引く
const simplify = (points: Point[], epsilon: number): Point[] => {
  if (points.length <= 2) return points;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (d > max) {
      max = d;
      index = i;
    }
  }
  if (max <= epsilon) return [points[0], points[points.length - 1]];
  const left = simplify(points.slice(0, index + 1), epsilon);
  const right = simplify(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
};

const signedArea = (ring: Point[]) => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
};

const parseNumber = (value: string | undefined) => {
  if (!value) return undefined;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : undefined;
};

// 高さが無い・明らかにおかしい建物は階数や id から決める
const buildingHeight = (way: OsmWay, area: number) => {
  const tags = way.tags ?? {};
  const height = parseNumber(tags.height);
  const levels = parseNumber(tags['building:levels']);
  if (height !== undefined && levels !== undefined && height < levels * 2.6) return levels * 3.4 + 1;
  if (height !== undefined && height >= 3) return height;
  if (levels !== undefined) return levels * 3.4 + 1;
  const base = area < 60 ? 7 : area < 200 ? 11 : 15;
  return base + (way.id % 13);
};

const SKIP_BUILDING = new Set(['roof', 'bridge', 'construction', 'carport']);

const buildings: { id: number; h: number; b: number; p: number[] }[] = [];
for (const way of ways) {
  const tags = way.tags ?? {};
  if (!tags.building || SKIP_BUILDING.has(tags.building)) continue;
  if (tags.name?.includes('デッキ')) continue;
  let ring = wayPoints(way);
  if (ring.length < 4) continue;
  // 閉じた way の最後の点（最初と同じ点）を落とす
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) ring = ring.slice(0, -1);
  ring = simplify([...ring, ring[0]], 0.3).slice(0, -1);
  if (ring.length < 3) continue;
  const area = signedArea(ring);
  if (Math.abs(area) < 12) continue;
  // x 東・z 南の座標で、上から見て時計回り（signedArea > 0）にそろえる
  if (area < 0) ring.reverse();
  const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
  const cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  if (Math.hypot(cx, cz) > MAX_DISTANCE) continue;
  // layer が 1 以上の建物はデッキや高架の上にあるので、1 階分浮かせる（下を道路が通る）
  const layer = parseNumber(tags.layer) ?? 0;
  const base = layer >= 1 ? 6 : 0;
  const height = Math.max(base + 3, buildingHeight(way, Math.abs(area)));
  buildings.push({ id: way.id, h: round(height), b: base, p: ring.flatMap(([x, z]) => [round(x), round(z)]) });
}

// 道路: 車道は車線数から幅を決める。歩行者用の道は舗装の色を変えるだけ。
type RoadKind = 'car' | 'walk';
const roadSpec = (tags: OsmTags): { kind: RoadKind; width: number } | undefined => {
  const lanes = parseNumber(tags.lanes);
  const byLanes = (fallback: number) => (lanes ? lanes * 3.2 + 1.5 : fallback);
  if (tags.name === '渋谷センター街') return { kind: 'walk', width: 7 };
  // 交差点につながる大通りは、航空写真で測った幅にそろえる（OSM の車線数だけでは狭すぎる）
  if (tags.name === '道玄坂' || tags.name === '文化村通り') return { kind: 'car', width: 16 };
  if (tags.name === '神宮通り' && tags.oneway !== 'yes') return { kind: 'car', width: 18 };
  if (tags.name === '旧大山街道' || tags.name === '宮益坂') return { kind: 'car', width: 14.5 };
  switch (tags.highway) {
    case 'trunk':
    case 'primary':
      return { kind: 'car', width: byLanes(13) };
    case 'secondary':
      return { kind: 'car', width: byLanes(11) };
    case 'tertiary':
      return { kind: 'car', width: byLanes(9) };
    case 'unclassified':
      return { kind: 'car', width: byLanes(6.5) };
    case 'residential':
      return { kind: 'car', width: 5 };
    case 'living_street':
      return { kind: 'car', width: 4.5 };
    case 'pedestrian':
      return { kind: 'walk', width: 6 };
    default:
      return undefined;
  }
};

const roads: { k: RoadKind; w: number; p: number[] }[] = [];
for (const way of ways) {
  const tags = way.tags ?? {};
  if (!tags.highway) continue;
  if (tags.tunnel || tags.bridge || tags.covered === 'yes') continue;
  if (tags.layer && tags.layer !== '0') continue;
  const spec = roadSpec(tags);
  if (!spec) continue;
  const line = simplify(wayPoints(way), 0.2);
  if (line.length < 2) continue;
  if (line.every(([x, z]) => Math.hypot(x, z) > MAX_DISTANCE + 60)) continue;
  roads.push({ k: spec.kind, w: round(spec.width), p: line.flatMap(([x, z]) => [round(x), round(z)]) });
}

const timestamp = parsed.osm3s?.timestamp_osm_base ?? 'unknown';
const lines = [
  '// このファイルは src/scripts/shibuyaOsm.ts で生成している。手で編集しない。',
  `// 出典: © OpenStreetMap contributors（ODbL） データの時点: ${timestamp}`,
  '// 座標はスクランブル交差点の中心が原点、x が東・z が南（m）。p は [x0, z0, x1, z1, ...]。',
  '',
  '// h は屋上の高さ、b は建物の下端の高さ（デッキの上の建物は 0 より上）',
  "export type OsmBuilding = { id: number; h: number; b: number; p: number[] };",
  "export type OsmRoad = { k: 'car' | 'walk'; w: number; p: number[] };",
  '',
  'export const OSM_BUILDINGS: OsmBuilding[] = [',
  ...buildings.map((b) => `  { id: ${b.id}, h: ${b.h}, b: ${b.b}, p: [${b.p.join(', ')}] },`),
  '];',
  '',
  'export const OSM_ROADS: OsmRoad[] = [',
  ...roads.map((r) => `  { k: '${r.k}', w: ${r.w}, p: [${r.p.join(', ')}] },`),
  '];',
  ''
];
writeFileSync(new URL('../src/games/shibuya/osm.ts', import.meta.url), lines.join('\n'));
console.log(`buildings: ${buildings.length}, roads: ${roads.length}`);
