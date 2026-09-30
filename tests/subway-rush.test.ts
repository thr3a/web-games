import { expect, test } from 'vitest';
import {
  blockedSpan,
  createModel,
  createObstacle,
  jump,
  type Lane,
  type Model,
  moveLane,
  type Obstacle,
  type ObstacleSpec,
  obstacleEnd,
  pauseModel,
  RULES,
  resumeModel,
  score,
  slide,
  startModel,
  stepModel,
  TRAIN,
  trainStart,
  trainSurface
} from '../src/games/subway-rush/model';

const FRAME = 1 / 60;

// 自動生成を止め、指定した障害物だけを置いた状態を作る。
const playingWith = (obstacles: ObstacleSpec[]) => {
  const model = createModel(() => 0.5);
  startModel(model);
  model.nextRowZ = Number.POSITIVE_INFINITY;
  model.obstacles = obstacles.map((obstacle, index) => createObstacle(index + 1, obstacle, 0));
  model.coins = [];
  return model;
};

const seeded = (initial: number) => {
  let seed = initial;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
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
  const model = createModel(seeded(1));
  startModel(model);
  const minGap = RULES.rowGapMinSeconds * RULES.runSpeed;
  const seen = new Map<number, number>();
  for (let i = 0; i < 20000; i++) {
    model.player.y = 5; // 当たり判定を避けて走り続けるため、空中に固定する
    model.player.vy = 0;
    stepModel(model, FRAME);
    // 走ってくる電車は z が動くので、列の位置（すれ違う位置）で記録する。
    for (const obstacle of model.obstacles) seen.set(obstacle.id, obstacle.meetZ);
  }
  const rows = [...new Set(seen.values())].sort((a, b) => a - b);
  expect(rows.length).toBeGreaterThan(100);
  expect(rows[0]).toBeGreaterThanOrEqual(RULES.firstRowDistance);
  for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(minGap - 1e-6);
});

test('停車中の電車の正面にぶつかるとゲームオーバー', () => {
  const model = playingWith([{ kind: 'train', lane: 0, z: 20 }]);
  runFor(model, 3);
  expect(model.status).toBe('over');
  expect(model.distance).toBeLessThan(20);
});

test('スロープから屋根に上がり、屋根の端から落ちて着地する', () => {
  const model = playingWith([{ kind: 'train', lane: 0, z: 30, cars: 2, ramp: true }]);
  runUntil(model, 40);
  expect(model.status).toBe('playing');
  expect(model.player.y).toBe(TRAIN.height);
  const end = 30 + 2 * TRAIN.carLength;
  runUntil(model, end + 1);
  expect(model.player.y).toBeLessThan(TRAIN.height);
  runFor(model, 1);
  expect(model.status).toBe('playing');
  expect(model.player.y).toBe(0);
});

test('屋根の上でもジャンプ・スライディング・レーン移動ができる', () => {
  const model = playingWith([{ kind: 'train', lane: 0, z: 20, cars: 3, ramp: true }]);
  runUntil(model, 25);
  jump(model);
  runFor(model, 0.2);
  expect(model.player.y).toBeGreaterThan(TRAIN.height);
  runFor(model, 1);
  expect(model.player.y).toBe(TRAIN.height);
  slide(model);
  expect(model.player.slideTimer).toBeGreaterThan(0);
  moveLane(model, 1);
  runFor(model, 0.6);
  expect(model.status).toBe('playing');
  expect(model.player.y).toBe(0);
});

test('電車の側面にぶつかると元のレーンへ押し戻される', () => {
  const model = playingWith([{ kind: 'train', lane: 1, z: 10, cars: 3 }]);
  runUntil(model, 20);
  moveLane(model, 1);
  runFor(model, 0.5);
  expect(model.status).toBe('playing');
  expect(model.player.lane).toBe(0);
  expect(model.player.x).toBe(0);
  expect(model.bumps).toBe(1);
});

test('スロープの途中へ横から入ろうとすると押し戻される', () => {
  const model = playingWith([{ kind: 'train', lane: 1, z: 30, ramp: true }]);
  runUntil(model, 27);
  moveLane(model, 1);
  runFor(model, 0.3);
  expect(model.status).toBe('playing');
  expect(model.player.lane).toBe(0);
});

test('走ってくる電車に正面からぶつかるとゲームオーバー', () => {
  const model = playingWith([{ kind: 'movingTrain', lane: 0, z: 40 }]);
  const startZ = model.obstacles[0].z;
  runFor(model, 1);
  expect(model.obstacles[0].z).toBeLessThan(startZ);
  runFor(model, 4);
  expect(model.status).toBe('over');
  expect(model.distance).toBeLessThan(40);
  expect(model.distance).toBeGreaterThan(38);
});

test('走ってくる電車はレーン移動で避けられ、屋根には乗れない', () => {
  const model = playingWith([{ kind: 'movingTrain', lane: 0, z: 40 }]);
  moveLane(model, -1);
  runFor(model, 5);
  expect(model.status).toBe('playing');
  expect(model.player.ground).toBe(0);
});

test('コインに触れると取得でき、スコアに加算される', () => {
  const model = playingWith([]);
  model.coins = [
    { id: 100, lane: 0, z: 10, y: 0.9 },
    { id: 101, lane: 1, z: 12, y: 0.9 }
  ];
  runUntil(model, 20);
  expect(model.coinCount).toBe(1);
  expect(model.coins).toHaveLength(1);
  expect(score(model)).toBe(Math.floor(model.distance) + RULES.coinScore);
});

test('速度は初速 18m/s、30枚ごとに +1.5m/s、5段階で上限', () => {
  expect(RULES.runSpeed).toBe(18);
  expect(RULES.coinsPerSpeedUp).toBe(30);
  expect(RULES.speedStep).toBe(1.5);
  expect(RULES.maxSpeedLevel).toBe(5);
  expect(createModel().speed).toBe(18);
});

test('コイン30枚ごとに加速し、上限で止まる', () => {
  const model = playingWith([]);
  model.coinCount = RULES.coinsPerSpeedUp - 1;
  model.coins = [{ id: 100, lane: 0, z: 5, y: 0.9 }];
  runUntil(model, 8);
  expect(model.speedLevel).toBe(1);
  expect(model.speed).toBe(RULES.runSpeed + RULES.speedStep);
  model.coinCount = RULES.coinsPerSpeedUp * 50;
  model.coins = [{ id: 101, lane: 0, z: 12, y: 0.9 }];
  runUntil(model, 15);
  expect(model.speedLevel).toBe(RULES.maxSpeedLevel);
  expect(model.speed).toBe(RULES.runSpeed + RULES.maxSpeedLevel * RULES.speedStep);
});

test('ポーズ中は進まず、操作も受け付けない', () => {
  const model = playingWith([]);
  runFor(model, 0.5);
  pauseModel(model);
  const distance = model.distance;
  runFor(model, 1);
  moveLane(model, 1);
  expect(model.distance).toBe(distance);
  expect(model.player.lane).toBe(0);
  resumeModel(model);
  runFor(model, 0.5);
  expect(model.distance).toBeGreaterThan(distance);
});

test('リトライすると状態が初期化される', () => {
  const model = playingWith([]);
  model.coinCount = 250;
  model.speedLevel = 2;
  model.speed = RULES.runSpeed + 2 * RULES.speedStep;
  model.status = 'over';
  startModel(model);
  expect(model.status).toBe('playing');
  expect(model.coinCount).toBe(0);
  expect(model.speedLevel).toBe(0);
  expect(model.speed).toBe(RULES.runSpeed);
});

// 当たり判定を無効にしたまま長く走らせ、生成された障害物・コインをすべて集める。
const generate = (seed: number, frames: number) => {
  const model = createModel(seeded(seed));
  startModel(model);
  const obstacles = new Map<number, Obstacle>();
  let coinsInsideTrain = 0;
  let coins = 0;
  const seenCoins = new Set<number>();
  let overlaps = 0;
  for (let i = 0; i < frames; i++) {
    model.player.y = 50;
    model.player.vy = 0;
    stepModel(model, FRAME);
    for (const obstacle of model.obstacles) if (!obstacles.has(obstacle.id)) obstacles.set(obstacle.id, { ...obstacle });
    // プレイヤーより前にある、同じレーンの障害物同士が見た目の上で重なっていないか。
    const ahead = model.obstacles.filter((obstacle) => obstacleEnd(obstacle) > model.distance);
    for (const a of ahead) {
      for (const b of ahead) {
        if (a.id >= b.id || a.lane !== b.lane) continue;
        if (trainStart(a) - 0.2 < obstacleEnd(b) + 0.2 && trainStart(b) - 0.2 < obstacleEnd(a) + 0.2) overlaps++;
      }
    }
    for (const coin of model.coins) {
      if (seenCoins.has(coin.id)) continue;
      seenCoins.add(coin.id);
      coins++;
      const inside = model.obstacles.some((obstacle) => {
        if (obstacle.lane !== coin.lane) return false;
        if (obstacle.kind === 'movingTrain') return coin.z > obstacle.meetZ && coin.z < obstacleEnd(obstacle);
        const surface = trainSurface(obstacle, coin.z);
        return surface !== null && coin.y < surface + 0.5;
      });
      if (inside) coinsInsideTrain++;
    }
  }
  return { model, obstacles: [...obstacles.values()], overlaps, coins, coinsInsideTrain };
};

test('生成される障害物は同じレーンで重ならず、コインは電車の中に置かれない', () => {
  for (const seed of [1, 7, 42]) {
    const result = generate(seed, 15000);
    expect(result.obstacles.filter((obstacle) => obstacle.kind === 'movingTrain').length).toBeGreaterThan(5);
    expect(result.obstacles.filter((obstacle) => obstacle.ramp).length).toBeGreaterThan(5);
    expect(result.overlaps).toBe(0);
    expect(result.coins).toBeGreaterThan(300);
    expect(result.coinsInsideTrain).toBe(0);
  }
});

test('電車でふさがれても、必ず通れるレーンへ移れる（詰みがない）', () => {
  for (const seed of [1, 7, 42, 99, 2024]) {
    const { model, obstacles } = generate(seed, 20000);
    const spans = obstacles.flatMap((obstacle) => {
      const span = blockedSpan(obstacle);
      return span ? [{ lane: obstacle.lane, span }] : [];
    });
    const blockedAt = (d: number) =>
      new Set(spans.filter(({ span }) => d >= span[0] && d <= span[1]).map(({ lane }) => lane));
    const lanes: Lane[] = [-1, 0, 1];
    // レーン移動は一瞬でできるものとして、到達できるレーンの集合を少しずつ進める。
    let reachable = new Set<Lane>([0]);
    for (let d = 0; d < model.distance - RULES.spawnAhead; d += 0.5) {
      const now = blockedAt(d);
      const next = blockedAt(d + 0.5);
      const moved = new Set<Lane>();
      for (const from of reachable) {
        for (const to of lanes) {
          if (next.has(to)) continue;
          const low = Math.min(from, to);
          const high = Math.max(from, to);
          const path = lanes.filter((lane) => lane >= low && lane <= high);
          if (path.some((lane) => lane !== from && now.has(lane))) continue;
          moved.add(to);
        }
      }
      expect(moved.size, `seed ${seed} で ${d}m 地点に逃げ場がない`).toBeGreaterThan(0);
      reachable = moved;
    }
  }
});
