import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createModel,
  type Enemy,
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
  hitFlash: 0
});

const advance = (model: ReturnType<typeof createModel>, seconds: number) => {
  for (let frame = 0; frame < seconds * 120; frame++) stepModel(model, 1 / 120, () => 0.5);
};

test('押している間だけ連射し、指を離すと新しい弾を発射しない', () => {
  const model = playing();
  advance(model, 0.2);
  assert.equal(model.bullets.length, 0);
  model.firing = true;
  advance(model, 0.5);
  assert.equal(model.bullets.length, 5);
  model.firing = false;
  advance(model, 1);
  assert.equal(model.bullets.length, 0);
  assert.equal(model.hp, RULES.maxHp);
});

test('砲台は指の横位置に追従し、画面の外には移動しない', () => {
  const model = playing();
  moveCannon(model, -100);
  advance(model, 1);
  assert.ok(Math.abs(model.cannonX - 30) < 0.01);
  moveCannon(model, 1000);
  advance(model, 1);
  assert.ok(Math.abs(model.cannonX - (WORLD.width - 30)) < 0.01);
});

test('1発の命中でHPが1だけ減り、撃破前は加点しない', () => {
  const model = playing();
  model.enemies = [enemyAt(2)];
  model.bullets = [{ x: 195, y: 335 }];
  stepModel(model, 1 / 120);
  assert.equal(model.enemies[0].hp, 1);
  assert.equal(model.score, 0);
  assert.equal(model.bullets.length, 0);
});

test('弾が1フレームで敵を横切っても、手前の敵に一度だけ命中する', () => {
  const model = playing();
  model.enemies = [enemyAt(5, 200), { ...enemyAt(5, 400), id: 2 }];
  model.bullets = [{ x: 195, y: 500 }];
  stepModel(model, 0.5);
  assert.deepEqual(
    model.enemies.map((enemy) => enemy.hp),
    [5, 4]
  );
});

test('敵のHPが0になると消滅・加点し、コインを確率でドロップする', () => {
  const model = playing();
  model.enemies = [enemyAt(1)];
  model.bullets = [
    { x: 195, y: 330 },
    { x: 195, y: 333 }
  ];
  const events = stepModel(model, 1 / 120, () => 0);
  assert.equal(model.enemies.length, 0);
  assert.equal(model.score, 10);
  assert.equal(model.kills, 1);
  assert.equal(model.drops.length, 1);
  assert.equal(events.filter((event) => event.kind === 'destroy').length, 1);
});

test('ドロップ確率に外れたときはコインを生成しない', () => {
  const model = playing();
  model.enemies = [enemyAt(1)];
  model.bullets = [{ x: 195, y: 330 }];
  stepModel(model, 1 / 120, () => 0.99);
  assert.equal(model.drops.length, 0);
});

test('コインは自動で取得され、HP上限を超えずに回復する', () => {
  for (const hp of [50, 99, 100]) {
    const model = playing();
    model.hp = hp;
    model.drops = [{ x: 30, y: 250, age: 0 }];
    advance(model, 3);
    assert.equal(model.drops.length, 0);
    assert.equal(model.coins, 1);
    assert.equal(model.hp, Math.min(RULES.maxHp, hp + RULES.coinHealing));
  }
});

test('敵が砲台ラインに到達したときだけHPが減り、同じ敵の二重被弾はない', () => {
  const model = playing();
  model.enemies = [enemyAt(40, WORLD.dangerY - 40)];
  advance(model, 1);
  assert.equal(model.hp, 75);
  assert.equal(model.enemies.length, 0);
  assert.equal(model.score, 0);
});

test('HPが0になるとゲームオーバーになり、同じフレームのコインで復活しない', () => {
  const model = playing();
  model.hp = 10;
  model.firing = true;
  model.enemies = [enemyAt(40, WORLD.dangerY)];
  model.drops = [{ x: 195, y: WORLD.cannonY, age: 0 }];
  stepModel(model, 1 / 120);
  assert.equal(model.hp, 0);
  assert.equal(model.status, 'over');
  assert.equal(model.firing, false);
  assert.equal(model.coins, 0);
  const before = structuredClone(model);
  advance(model, 3);
  assert.deepEqual(model, before);
});

test('一時停止中は進行せず、再開しても指を押すまで発射しない', () => {
  const model = playing();
  model.firing = true;
  pauseModel(model);
  const before = structuredClone(model);
  advance(model, 10);
  assert.deepEqual(model, before);
  resumeModel(model);
  advance(model, 0.2);
  assert.equal(model.status, 'playing');
  assert.equal(model.firing, false);
  assert.equal(model.bullets.length, 0);
});

test('開始待ち・ゲームオーバーから再開操作をしてもプレイ状態にしない', () => {
  const model = createModel();
  resumeModel(model);
  assert.equal(model.status, 'ready');
  model.status = 'over';
  pauseModel(model);
  resumeModel(model);
  assert.equal(model.status, 'over');
});

test('時間が経過しても敵のHP・速度・出現間隔は変化せず、同時出現は最大2体', () => {
  const early = playing();
  const late = playing();
  early.spawnCooldown = 0;
  late.spawnCooldown = 0;
  late.elapsed = 600;
  stepModel(early, 1 / 120, () => 0.5);
  stepModel(late, 1 / 120, () => 0.5);
  assert.equal(early.enemies[0].maxHp, late.enemies[0].maxHp);
  assert.equal(early.enemies[0].speed, late.enemies[0].speed);
  assert.equal(early.spawnCooldown, late.spawnCooldown);
  for (let frame = 0; frame < 120 * 120; frame++) {
    early.hp = 100;
    stepModel(early, 1 / 120, () => 0.5);
    assert.ok(early.enemies.length <= RULES.maxEnemies);
  }
});

test('リトライ用のモデルはスコア・HP・弾・敵・タイマーを初期化する', () => {
  const first = playing();
  first.score = 300;
  first.hp = 0;
  first.status = 'over';
  const next = createModel();
  assert.equal(next.score, 0);
  assert.equal(next.hp, 100);
  assert.equal(next.elapsed, 0);
  assert.equal(next.enemies.length, 0);
  assert.equal(next.bullets.length, 0);
  assert.notEqual(first.enemies, next.enemies);
});
