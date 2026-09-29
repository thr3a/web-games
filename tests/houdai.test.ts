import { expect, test } from 'vitest';
import {
  createModel,
  type Enemy,
  getPhase,
  moveCannon,
  pauseModel,
  RULES,
  resumeModel,
  stepModel,
  WORLD
} from '../src/games/houdai/model';

const playing = () => {
  const model = createModel();
  model.status = 'playing';
  model.spawnCooldown = 1000;
  return model;
};

const enemyAt = (hp: number, y = 300): Enemy => ({
  id: 1,
  x: 195,
  anchorX: 195,
  y,
  hp,
  maxHp: hp,
  radius: 40,
  speed: 0,
  phase: 0,
  rotation: 0,
  sides: 6,
  palette: 0,
  hitFlash: 0,
  vx: 0,
  vy: 0,
  reward: 10
});

const advance = (model: ReturnType<typeof createModel>, seconds: number) => {
  for (let frame = 0; frame < seconds * 120; frame++) stepModel(model, 1 / 120, () => 0.5);
};

test('押している間だけ連射し、指を離すと新しい弾を発射しない', () => {
  const model = playing();
  advance(model, 0.2);
  expect(model.bullets.length).toBe(0);
  model.firing = true;
  advance(model, 0.5);
  expect(model.bullets.length).toBe(5);
  model.firing = false;
  advance(model, 1);
  expect(model.bullets.length).toBe(0);
  expect(model.hp).toBe(RULES.maxHp);
});

test('砲台は指の横位置に追従し、画面の外には移動しない', () => {
  const model = playing();
  moveCannon(model, -100);
  advance(model, 1);
  expect(Math.abs(model.cannonX - 30)).toBeLessThan(0.01);
  moveCannon(model, 1000);
  advance(model, 1);
  expect(Math.abs(model.cannonX - (WORLD.width - 30))).toBeLessThan(0.01);
});

test('1発の命中でHPが1だけ減り、撃破前は加点しない', () => {
  const model = playing();
  model.enemies = [enemyAt(3)];
  model.bullets = [{ x: 195, y: 335 }];
  stepModel(model, 1 / 120);
  expect(model.enemies[0].hp).toBe(2);
  expect(model.score).toBe(0);
  expect(model.bullets.length).toBe(0);
});

test('命中するたびに色が変わる', () => {
  const model = playing();
  model.enemies = [enemyAt(5)];
  model.bullets = [{ x: 195, y: 335 }];
  stepModel(model, 1 / 120);
  expect(model.enemies[0].palette).toBe(1);
});

test('「2」に命中すると、小さい「1」の2体に分裂し、この時点では加点しない', () => {
  const model = playing();
  model.enemies = [enemyAt(2)];
  model.nextId = 10;
  model.bullets = [{ x: 195, y: 335 }];
  const events = stepModel(model, 1 / 120);
  expect(model.enemies.length).toBe(2);
  expect(model.enemies.map((enemy) => [enemy.hp, enemy.maxHp, enemy.id])).toEqual([
    [1, 1, 10],
    [1, 1, 11]
  ]);
  expect(model.enemies.every((enemy) => enemy.radius < 40 && enemy.reward === 10)).toBe(true);
  expect(model.enemies[0].vx < 0 && model.enemies[1].vx > 0).toBe(true);
  expect(model.bullets.length).toBe(0);
  expect(model.score).toBe(0);
  expect(model.kills).toBe(0);
  expect(events.filter((event) => event.kind === 'split').length).toBe(1);
});

test('分裂した「1」が見逃されたときは、通常より少ないダメージを受ける', () => {
  const model = playing();
  model.enemies = [{ ...enemyAt(1, WORLD.dangerY), maxHp: 1 }];
  stepModel(model, 1 / 120);
  expect(model.hp).toBe(RULES.maxHp - RULES.splitMissDamage);
  expect(model.enemies.length).toBe(0);
});

test('落ちてきたコインに砲台が触れると、跳ね終わる前でも取得できる', () => {
  const model = playing();
  model.hp = 50;
  model.drops = [{ x: 195, y: WORLD.cannonY - 100, vx: 0, vy: 0, bounces: 0 }];
  advance(model, 0.5);
  expect(model.drops.length).toBe(0);
  expect(model.coins).toBe(1);
  expect(model.hp).toBe(50 + RULES.coinHealing);
});

test('弾が1フレームで敵を横切っても、手前の敵に一度だけ命中する', () => {
  const model = playing();
  model.enemies = [enemyAt(5, 200), { ...enemyAt(5, 400), id: 2 }];
  model.bullets = [{ x: 195, y: 500 }];
  stepModel(model, 0.5);
  expect(model.enemies.map((enemy) => enemy.hp)).toEqual([5, 4]);
});

test('敵のHPが0になると消滅・加点し、コインを確率でドロップする', () => {
  const model = playing();
  model.enemies = [enemyAt(1)];
  model.bullets = [
    { x: 195, y: 330 },
    { x: 195, y: 333 }
  ];
  const events = stepModel(model, 1 / 120, () => 0);
  expect(model.enemies.length).toBe(0);
  expect(model.score).toBe(10);
  expect(model.kills).toBe(1);
  expect(model.drops.length).toBe(1);
  expect(events.filter((event) => event.kind === 'destroy').length).toBe(1);
});

test('ドロップ確率に外れたときはコインを生成しない', () => {
  const model = playing();
  model.enemies = [enemyAt(1)];
  model.bullets = [{ x: 195, y: 330 }];
  stepModel(model, 1 / 120, () => 0.99);
  expect(model.drops.length).toBe(0);
});

test('コインは跳ね終わると自動で取得され、HP上限を超えずに回復する', () => {
  for (const hp of [50, 99, 100]) {
    const model = playing();
    model.hp = hp;
    model.drops = [{ x: 30, y: 250, vx: 0, vy: 0, bounces: 0 }];
    advance(model, 5);
    expect(model.drops.length).toBe(0);
    expect(model.coins).toBe(1);
    expect(model.hp).toBe(Math.min(RULES.maxHp, hp + RULES.coinHealing));
  }
});

test('敵が砲台ラインに到達したときだけHPが減り、同じ敵の二重被弾はない', () => {
  const model = playing();
  model.enemies = [enemyAt(40, WORLD.dangerY - 40)];
  advance(model, 1);
  expect(model.hp).toBe(75);
  expect(model.enemies.length).toBe(0);
  expect(model.score).toBe(0);
});

test('HPが0になるとゲームオーバーになり、同じフレームのコインで復活しない', () => {
  const model = playing();
  model.hp = 10;
  model.firing = true;
  model.enemies = [enemyAt(40, WORLD.dangerY)];
  model.drops = [{ x: 195, y: WORLD.cannonY, vx: 0, vy: 0, bounces: 0 }];
  stepModel(model, 1 / 120);
  expect(model.hp).toBe(0);
  expect(model.status).toBe('over');
  expect(model.firing).toBe(false);
  expect(model.coins).toBe(0);
  const before = structuredClone(model);
  advance(model, 3);
  expect(model).toEqual(before);
});

test('一時停止中は進行せず、再開しても指を押すまで発射しない', () => {
  const model = playing();
  model.firing = true;
  pauseModel(model);
  const before = structuredClone(model);
  advance(model, 10);
  expect(model).toEqual(before);
  resumeModel(model);
  advance(model, 0.2);
  expect(model.status).toBe('playing');
  expect(model.firing).toBe(false);
  expect(model.bullets.length).toBe(0);
});

test('開始待ち・ゲームオーバーから再開操作をしてもプレイ状態にしない', () => {
  const model = createModel();
  resumeModel(model);
  expect(model.status).toBe('ready');
  model.status = 'over';
  pauseModel(model);
  resumeModel(model);
  expect(model.status).toBe('over');
});

test('フェーズが進むと敵の初期HP・同時出現数の上限が引き上がる（速度や出現間隔は変わらない）', () => {
  const early = playing();
  const late = playing();
  early.spawnCooldown = 0;
  late.spawnCooldown = 0;
  late.elapsed = RULES.phaseDuration * 2;
  stepModel(early, 1 / 120, () => 0.5);
  stepModel(late, 1 / 120, () => 0.5);
  expect(getPhase(early.elapsed)).toBe(0);
  expect(getPhase(late.elapsed)).toBe(2);
  expect(late.enemies[0].maxHp).toBeGreaterThan(early.enemies[0].maxHp);
  expect(early.enemies[0].speed).toBeGreaterThanOrEqual(RULES.speedMin);
  expect(early.spawnCooldown).toBe(late.spawnCooldown);
  for (let frame = 0; frame < 120 * (RULES.phaseDuration * 3); frame++) {
    early.hp = 100;
    stepModel(early, 1 / 120, () => 0.5);
    const maxEnemies = RULES.maxEnemies + getPhase(early.elapsed) * RULES.maxEnemiesStepPerPhase;
    expect(early.enemies.length).toBeLessThanOrEqual(maxEnemies);
  }
});

test('60秒経過するとHPが残っていればクリアになり、以降は進行しない', () => {
  const model = playing();
  model.elapsed = RULES.gameDuration - 1 / 120;
  stepModel(model, 1 / 120);
  expect(model.status).toBe('cleared');
  expect(model.firing).toBe(false);
  expect(model.bullets.length).toBe(0);
  const before = structuredClone(model);
  for (let frame = 0; frame < 120; frame++) stepModel(model, 1 / 120);
  expect(model).toEqual(before);
});

test('リトライ用のモデルはスコア・HP・弾・敵・タイマーを初期化する', () => {
  const first = playing();
  first.score = 300;
  first.hp = 0;
  first.status = 'over';
  const next = createModel();
  expect(next.score).toBe(0);
  expect(next.hp).toBe(100);
  expect(next.elapsed).toBe(0);
  expect(next.enemies.length).toBe(0);
  expect(next.bullets.length).toBe(0);
  expect(first.enemies).not.toBe(next.enemies);
});
