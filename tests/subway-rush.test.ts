import { expect, test } from 'vitest';
import {
  airTime,
  blockedSpan,
  type Coin,
  createModel,
  createObstacle,
  jump,
  type Lane,
  laneX,
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
  trainSurface,
  WAGON
} from '../src/games/subway-rush/model';

const FRAME = 1 / 60;
const LANES: Lane[] = [-1, 0, 1];

// 自動生成を止め、指定した障害物だけを置いた状態を作る。
const playingWith = (obstacles: ObstacleSpec[]) => {
  const model = createModel(() => 0.5);
  startModel(model);
  model.nextPatternZ = Number.POSITIVE_INFINITY;
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

test('地面から貨車にジャンプで乗り、さらにジャンプで電車の屋根に上がれる', () => {
  const model = playingWith([
    { kind: 'wagon', lane: 0, z: 30, cars: 3 },
    { kind: 'train', lane: 0, z: 30 + 3 * WAGON.carLength, cars: 2 }
  ]);
  runUntil(model, 24);
  jump(model);
  runUntil(model, 42);
  expect(model.status).toBe('playing');
  expect(model.player.y).toBe(WAGON.height);
  runUntil(model, 30 + 3 * WAGON.carLength - 6);
  jump(model);
  runUntil(model, 70);
  expect(model.status).toBe('playing');
  expect(model.player.y).toBe(TRAIN.height);
});

test('貨車の正面にジャンプせずぶつかるとゲームオーバー', () => {
  const model = playingWith([{ kind: 'wagon', lane: 0, z: 30, cars: 2 }]);
  runFor(model, 3);
  expect(model.status).toBe('over');
  expect(model.distance).toBeLessThan(30);
});

test('地面からのジャンプでは電車の屋根に届かない', () => {
  const model = playingWith([{ kind: 'train', lane: 0, z: 30, cars: 2 }]);
  runUntil(model, 26);
  jump(model);
  runFor(model, 2);
  expect(model.status).toBe('over');
});

test('縦に連ねた電車の隙間はジャンプで越えられ、歩いて落ちると次の電車にぶつかる', () => {
  // 初速で 0.25 秒ぶんの隙間
  const gap = 0.25 * RULES.runSpeed;
  const specs: ObstacleSpec[] = [
    { kind: 'train', lane: 0, z: 20, cars: 2, ramp: true },
    { kind: 'train', lane: 0, z: 44 + gap, cars: 2 }
  ];
  const jumped = playingWith(specs);
  runUntil(jumped, 44 + gap / 2 - (airTime(0) * RULES.runSpeed) / 2);
  jump(jumped);
  runUntil(jumped, 65);
  expect(jumped.status).toBe('playing');
  expect(jumped.player.y).toBe(TRAIN.height);

  const walked = playingWith(specs);
  runUntil(walked, 80);
  expect(walked.status).toBe('over');
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
    { id: 100, x: 0, z: 10, y: 0.9 },
    { id: 101, x: RULES.laneWidth, z: 12, y: 0.9 }
  ];
  runUntil(model, 20);
  expect(model.coinCount).toBe(1);
  expect(model.coins).toHaveLength(1);
  expect(score(model)).toBe(Math.floor(model.distance) + RULES.coinScore);
});

test('速度は初速 20m/s、30枚ごとに +10m/s、5段階で上限', () => {
  expect(RULES.runSpeed).toBe(20);
  expect(RULES.coinsPerSpeedUp).toBe(30);
  expect(RULES.speedStep).toBe(10);
  expect(RULES.maxSpeedLevel).toBe(5);
  expect(createModel().speed).toBe(20);
});

test('コイン30枚ごとに加速し、上限で止まる', () => {
  const model = playingWith([]);
  model.coinCount = RULES.coinsPerSpeedUp - 1;
  model.coins = [{ id: 100, x: 0, z: 5, y: 0.9 }];
  runUntil(model, 8);
  expect(model.speedLevel).toBe(1);
  expect(model.speed).toBe(RULES.runSpeed + RULES.speedStep);
  model.coinCount = RULES.coinsPerSpeedUp * 50;
  model.coins = [{ id: 101, x: 0, z: 12, y: 0.9 }];
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
const generate = (seed: number, frames: number, speedLevel = 0) => {
  const model = createModel(seeded(seed));
  startModel(model);
  model.speedLevel = speedLevel;
  model.speed = RULES.runSpeed + speedLevel * RULES.speedStep;
  const obstacles = new Map<number, Obstacle>();
  const coins = new Map<number, Coin>();
  let coinsInsideTrain = 0;
  let overlaps = 0;
  let maxAliveCoins = 0;
  for (let i = 0; i < frames; i++) {
    model.player.y = 50;
    model.player.vy = 0;
    stepModel(model, FRAME);
    for (const obstacle of model.obstacles)
      if (!obstacles.has(obstacle.id)) obstacles.set(obstacle.id, { ...obstacle });
    maxAliveCoins = Math.max(maxAliveCoins, model.coins.length);
    // プレイヤーより前にある、同じレーンの障害物同士が見た目の上で重なっていないか。
    // 貨車の直後に電車をつなげる「貨車の階段」だけは、端どうしが接していてよい。
    const ahead = model.obstacles.filter((obstacle) => obstacleEnd(obstacle) > model.distance);
    for (const a of ahead) {
      for (const b of ahead) {
        if (a.id >= b.id || a.lane !== b.lane) continue;
        if (a.kind === 'wagon' && Math.abs(obstacleEnd(a) - trainStart(b)) < 1e-6) continue;
        if (trainStart(a) - 0.2 < obstacleEnd(b) + 0.2 && trainStart(b) - 0.2 < obstacleEnd(a) + 0.2) overlaps++;
      }
    }
    for (const coin of model.coins) {
      if (coins.has(coin.id)) continue;
      coins.set(coin.id, { ...coin });
      const inside = model.obstacles.some((obstacle) => {
        if (Math.abs(laneX(obstacle.lane) - coin.x) >= RULES.laneWidth / 2) return false;
        if (obstacle.kind === 'movingTrain') return coin.z > obstacle.meetZ && coin.z < obstacleEnd(obstacle);
        const surface = trainSurface(obstacle, coin.z);
        return surface !== null && coin.y < surface + 0.5;
      });
      if (inside) coinsInsideTrain++;
    }
  }
  return {
    model,
    obstacles: [...obstacles.values()],
    coins: [...coins.values()],
    overlaps,
    coinsInsideTrain,
    maxAliveCoins
  };
};

test('生成される障害物は同じレーンで重ならず、コインは電車の中に置かれない', () => {
  for (const seed of [1, 7, 42]) {
    const result = generate(seed, 15000);
    const kinds = new Set(result.obstacles.map((obstacle) => obstacle.kind));
    expect([...kinds].sort()).toEqual(['bar', 'fence', 'movingTrain', 'train', 'wagon']);
    expect(result.obstacles.filter((obstacle) => obstacle.kind === 'movingTrain').length).toBeGreaterThan(3);
    expect(result.obstacles.filter((obstacle) => obstacle.ramp).length).toBeGreaterThan(5);
    expect(result.overlaps).toBe(0);
    expect(result.coins.length).toBeGreaterThan(300);
    expect(result.coinsInsideTrain).toBe(0);
    expect(result.maxAliveCoins).toBeLessThan(400);
  }
});

test('同じレーンに途切れず並ぶコインは10枚まで、次の列とはコイン3枚ぶん以上空ける', () => {
  for (const [seed, level] of [
    [1, 0],
    [7, 0],
    [42, RULES.maxSpeedLevel]
  ]) {
    const { coins } = generate(seed, 15000, level);
    for (const lane of LANES) {
      // 斜めの列でレーンの間にあるコインは、ここでは数えない。
      const zs = coins
        .filter((coin) => Math.abs(coin.x - laneX(lane)) < 0.01)
        .map((coin) => coin.z)
        .sort((a, b) => a - b);
      let run = 1;
      for (let i = 1; i < zs.length; i++) {
        const gap = zs[i] - zs[i - 1];
        // 列の中の間隔（弧は速度に応じて広がる）と、列と列の間隔のどちらかに必ず分かれる。
        const maxInLine = ((airTime(0) * (RULES.runSpeed + level * RULES.speedStep)) / (RULES.coinLineMax - 1)) * 1.01;
        const inLine = gap <= Math.max(RULES.coinSpacing * 1.3, maxInLine);
        if (!inLine) expect(gap).toBeGreaterThanOrEqual((RULES.coinLineGap + 1) * RULES.coinSpacing - 1e-6);
        run = inLine ? run + 1 : 1;
        expect(run, `seed ${seed} lane ${lane} z ${zs[i]}`).toBeLessThanOrEqual(RULES.coinLineMax);
      }
    }
  }
});

// レーンごとの路面の状態。停車中の車両は、ジャンプで越せる隙間をはさんで続くものを1本の「屋根ルート」にまとめる。
// 屋根ルートは先頭がスロープか貨車のときだけ地上から入れる。走ってくる電車とすれ違う区間は通れない。
type Surface = 'ground' | 'roof' | 'entry' | 'blocked';
const surfaces = (obstacles: Obstacle[]) => {
  const maxSpeed = RULES.runSpeed + RULES.maxSpeedLevel * RULES.speedStep;
  const hopMax = RULES.hopGapMaxSeconds * maxSpeed + 0.01;
  const routes = LANES.map((lane) => {
    const vehicles = obstacles
      .filter((obstacle) => obstacle.lane === lane && (obstacle.kind === 'train' || obstacle.kind === 'wagon'))
      .sort((a, b) => trainStart(a) - trainStart(b));
    const chains: { from: number; to: number; climbable: boolean }[] = [];
    for (const vehicle of vehicles) {
      const last = chains[chains.length - 1];
      if (last && trainStart(vehicle) - last.to <= hopMax) {
        last.to = Math.max(last.to, obstacleEnd(vehicle));
        continue;
      }
      chains.push({
        from: trainStart(vehicle),
        to: obstacleEnd(vehicle),
        climbable: vehicle.ramp || vehicle.kind === 'wagon'
      });
    }
    return chains;
  });
  const moving = obstacles.flatMap((obstacle) => {
    const span = obstacle.kind === 'movingTrain' ? blockedSpan(obstacle) : null;
    return span ? [{ lane: obstacle.lane, span }] : [];
  });
  return (lane: Lane, d: number): Surface => {
    if (moving.some((item) => item.lane === lane && d >= item.span[0] && d <= item.span[1])) return 'blocked';
    const chain = routes[lane + 1].find((item) => d >= item.from && d <= item.to);
    if (!chain) return 'ground';
    return chain.climbable ? 'entry' : 'roof';
  };
};

test('どのパターンでも、地上か屋根の上に必ず通れるルートがある（詰みがない）', () => {
  for (const seed of [1, 7, 42, 99, 2024]) {
    for (const level of [0, RULES.maxSpeedLevel]) {
      const { model, obstacles } = generate(seed, 20000, level);
      const at = surfaces(obstacles);
      const isRoof = (surface: Surface) => surface === 'roof' || surface === 'entry';
      // 状態は「レーン:屋根の上か」。レーン移動は一瞬でできるものとして、到達できる状態を少しずつ進める。
      let reachable = new Set<string>(['0:ground']);
      for (let d = 0; d < model.distance - RULES.spawnAhead; d += 0.5) {
        const moved = new Set<string>();
        for (const state of reachable) {
          const [fromText, height] = state.split(':');
          const from = LANES.find((lane) => String(lane) === fromText) ?? 0;
          const onRoof = height === 'roof';
          for (const to of LANES) {
            const now = at(to, d);
            const next = at(to, d + 0.5);
            const low = Math.min(from, to);
            const high = Math.max(from, to);
            const path = LANES.filter((lane) => lane > low && lane < high);
            if (onRoof) {
              // 屋根の上からは、走ってくる電車のレーン以外なら横切れる。隣の屋根に移るか、地面に降りる。
              if (path.some((lane) => at(lane, d) === 'blocked')) continue;
              if (next === 'blocked') continue;
              if (isRoof(next) && (isRoof(now) || to === from)) moved.add(`${to}:roof`);
              if (next === 'ground') moved.add(`${to}:ground`);
              continue;
            }
            // 地上からは、途中のレーンも地面でなければ横切れない。
            if (path.some((lane) => at(lane, d) !== 'ground' || at(lane, d + 0.5) !== 'ground')) continue;
            if (to !== from && now !== 'ground') continue;
            if (next === 'ground') moved.add(`${to}:ground`);
            // 屋根ルートにはスロープ・貨車のある先頭からだけ入れる。
            if (next === 'entry' && now === 'ground') moved.add(`${to}:roof`);
          }
        }
        expect(moved.size, `seed ${seed} level ${level} で ${d}m 地点に逃げ場がない`).toBeGreaterThan(0);
        reachable = moved;
      }
    }
  }
});
