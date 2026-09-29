import { expect, test } from 'vitest';
import {
  createModel,
  jump,
  type Model,
  moveLane,
  type ObstacleKind,
  RULES,
  slide,
  startModel,
  stepModel
} from '../src/games/subway-rush/model';

const FRAME = 1 / 60;

// 自動生成を止め、指定した障害物だけを置いた状態を作る。
const playingWith = (obstacles: { kind: ObstacleKind; lane: -1 | 0 | 1; z: number }[]) => {
  const model = createModel(() => 0.5);
  startModel(model);
  model.nextRowZ = Number.POSITIVE_INFINITY;
  model.obstacles = obstacles.map((obstacle, index) => ({ id: index + 1, ...obstacle }));
  return model;
};

const runFor = (model: Model, seconds: number) => {
  for (let t = 0; t < seconds; t += FRAME) stepModel(model, FRAME);
};

const runUntil = (model: Model, distance: number) => {
  while (model.status === 'playing' && model.distance < distance) stepModel(model, FRAME);
};

test('柵にそのまま突っ込むとゲームオーバー', () => {
  const model = playingWith([{ kind: 'fence', lane: 0, z: 20 }]);
  runFor(model, 3);
  expect(model.status).toBe('over');
  expect(model.distance).toBeLessThan(20);
});

test('柵の手前でジャンプすると飛び越えられる', () => {
  const model = playingWith([{ kind: 'fence', lane: 0, z: 20 }]);
  runUntil(model, 17);
  jump(model);
  runFor(model, 2);
  expect(model.status).toBe('playing');
  expect(model.distance).toBeGreaterThan(40);
});

test('バーに立ったまま突っ込むとゲームオーバー', () => {
  const model = playingWith([{ kind: 'bar', lane: 0, z: 20 }]);
  runFor(model, 3);
  expect(model.status).toBe('over');
});

test('バーはジャンプしても越えられない', () => {
  const model = playingWith([{ kind: 'bar', lane: 0, z: 20 }]);
  runUntil(model, 16);
  jump(model);
  runFor(model, 2);
  expect(model.status).toBe('over');
});

test('バーの手前でスライディングするとくぐれる', () => {
  const model = playingWith([{ kind: 'bar', lane: 0, z: 20 }]);
  runUntil(model, 17);
  slide(model);
  runFor(model, 2);
  expect(model.status).toBe('playing');
});

test('スライディングは一定時間で終わる', () => {
  const model = playingWith([]);
  slide(model);
  expect(model.player.slideTimer).toBeGreaterThan(0);
  runFor(model, RULES.slideDuration + 0.05);
  expect(model.player.slideTimer).toBe(0);
});

test('空中で下入力すると急降下し、着地と同時にスライディングになる', () => {
  const model = playingWith([]);
  jump(model);
  runFor(model, 0.15);
  expect(model.player.y).toBeGreaterThan(0);
  slide(model);
  expect(model.player.vy).toBeLessThan(0);
  runFor(model, 0.2);
  expect(model.player.y).toBe(0);
  expect(model.player.slideTimer).toBeGreaterThan(0);
});

test('端のレーンから外側への移動は無視される', () => {
  const model = playingWith([]);
  moveLane(model, -1);
  moveLane(model, -1);
  expect(model.player.lane).toBe(-1);
  moveLane(model, 1);
  moveLane(model, 1);
  moveLane(model, 1);
  expect(model.player.lane).toBe(1);
});

test('隣のレーンへ移動すれば障害物を避けられる', () => {
  const model = playingWith([{ kind: 'fence', lane: 0, z: 20 }]);
  moveLane(model, 1);
  runFor(model, 3);
  expect(model.status).toBe('playing');
});

test('大きなフレーム時間でも障害物をすり抜けない', () => {
  const model = playingWith([{ kind: 'fence', lane: 0, z: 5 }]);
  // 1フレームは最大 RULES.maxFrame 秒に切り詰められ、その中をサブステップで進める。
  for (let i = 0; i < 10; i++) stepModel(model, 5);
  expect(model.status).toBe('over');
  expect(model.distance).toBeLessThan(5);
});

test('空中でジャンプ入力しても二段ジャンプにならない', () => {
  const model = playingWith([]);
  jump(model);
  runFor(model, 0.1);
  const vy = model.player.vy;
  jump(model);
  expect(model.player.vy).toBe(vy);
});

test('生成される障害物の列は同じレーンで一定以上の間隔を空ける', () => {
  let seed = 1;
  const rng = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const model = createModel(rng);
  startModel(model);
  const minGap = RULES.rowGapMinSeconds * RULES.runSpeed;
  const seen = new Map<number, number>();
  for (let i = 0; i < 20000; i++) {
    model.player.y = 5; // 当たり判定を避けて走り続けるため、空中に固定する
    model.player.vy = 0;
    stepModel(model, FRAME);
    for (const obstacle of model.obstacles) seen.set(obstacle.id, obstacle.z);
  }
  const rows = [...new Set(seen.values())].sort((a, b) => a - b);
  expect(rows.length).toBeGreaterThan(100);
  expect(rows[0]).toBeGreaterThanOrEqual(RULES.firstRowDistance);
  for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(minGap - 1e-6);
});
