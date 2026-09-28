export const WORLD = { width: 390, height: 780, cannonY: 678, dangerY: 674 };

export const RULES = {
  maxHp: 100,
  missDamage: 25,
  coinHealing: 8,
  coinChance: 0.35,
  shotInterval: 0.12,
  bulletSpeed: 760,
  spawnInterval: 2.8,
  maxEnemies: 2
};

export type GameStatus = 'ready' | 'playing' | 'paused' | 'over';
export type Enemy = {
  id: number;
  x: number;
  y: number;
  anchorX: number;
  hp: number;
  maxHp: number;
  radius: number;
  speed: number;
  phase: number;
  rotation: number;
  sides: number;
  palette: number;
  hitFlash: number;
};
export type Bullet = { x: number; y: number };
export type Coin = { x: number; y: number; age: number };
export type GameEvent = {
  kind: 'hit' | 'destroy' | 'damage' | 'heal';
  x: number;
  y: number;
  palette: number;
  value: number;
};
export type GameModel = {
  status: GameStatus;
  hp: number;
  score: number;
  coins: number;
  kills: number;
  elapsed: number;
  cannonX: number;
  targetX: number;
  firing: boolean;
  shotCooldown: number;
  spawnCooldown: number;
  nextId: number;
  enemies: Enemy[];
  bullets: Bullet[];
  drops: Coin[];
};
export type GameSnapshot = Pick<GameModel, 'status' | 'hp' | 'score' | 'coins' | 'kills' | 'elapsed'>;

export const createModel = (): GameModel => ({
  status: 'ready',
  hp: RULES.maxHp,
  score: 0,
  coins: 0,
  kills: 0,
  elapsed: 0,
  cannonX: WORLD.width / 2,
  targetX: WORLD.width / 2,
  firing: false,
  shotCooldown: 0,
  spawnCooldown: 0.5,
  nextId: 0,
  enemies: [],
  bullets: [],
  drops: []
});

export const snapshot = (model: GameModel): GameSnapshot => ({
  status: model.status,
  hp: model.hp,
  score: model.score,
  coins: model.coins,
  kills: model.kills,
  elapsed: Math.floor(model.elapsed)
});

export const moveCannon = (model: GameModel, x: number) => {
  model.targetX = Math.max(30, Math.min(WORLD.width - 30, x));
};

export const pauseModel = (model: GameModel) => {
  model.firing = false;
  if (model.status !== 'playing') return;
  model.status = 'paused';
};

export const resumeModel = (model: GameModel) => {
  if (model.status !== 'paused') return;
  model.firing = false;
  model.status = 'playing';
};

const spawnEnemy = (model: GameModel, random: () => number) => {
  const hp = 28 + Math.floor(random() * 33);
  const radius = 31 + hp * 0.2;
  let anchorX = 60 + random() * (WORLD.width - 120);
  const previous = model.enemies[0];
  if (previous && Math.abs(previous.anchorX - anchorX) < 110) {
    anchorX = previous.anchorX < WORLD.width / 2 ? 292 : 98;
  }
  model.enemies.push({
    id: model.nextId++,
    x: anchorX,
    anchorX,
    y: 112 - radius,
    hp,
    maxHp: hp,
    radius,
    speed: 62 + random() * 14,
    phase: random() * Math.PI * 2,
    rotation: random() * Math.PI,
    sides: 5 + Math.floor(random() * 3),
    palette: Math.floor(random() * 5),
    hitFlash: 0
  });
};

export const stepModel = (model: GameModel, dt: number, random: () => number = Math.random): GameEvent[] => {
  if (model.status !== 'playing') return [];

  const events: GameEvent[] = [];
  model.elapsed += dt;
  model.cannonX += (model.targetX - model.cannonX) * (1 - Math.exp(-22 * dt));
  model.spawnCooldown -= dt;
  if (model.spawnCooldown <= 0 && model.enemies.length < RULES.maxEnemies) {
    spawnEnemy(model, random);
    model.spawnCooldown = RULES.spawnInterval;
  }

  model.shotCooldown -= dt;
  if (!model.firing) model.shotCooldown = Math.max(0, model.shotCooldown);
  if (model.firing && model.shotCooldown <= 0) {
    model.bullets.push({ x: model.cannonX, y: WORLD.cannonY - 48 });
    model.shotCooldown += RULES.shotInterval;
  }

  for (const enemy of model.enemies) {
    enemy.y += enemy.speed * dt;
    enemy.x = enemy.anchorX + Math.sin(model.elapsed * 1.15 + enemy.phase) * 18;
    enemy.rotation += dt * 0.22;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
  }

  for (const bullet of model.bullets) {
    const previousY = bullet.y;
    bullet.y -= RULES.bulletSpeed * dt;
    // 弾の移動区間で判定し、フレームの間に敵をすり抜けるのを防ぐ。
    const target = model.enemies
      .filter((enemy) => {
        if (enemy.hp <= 0) return false;
        const closestY = Math.max(bullet.y, Math.min(previousY, enemy.y));
        return Math.hypot(bullet.x - enemy.x, closestY - enemy.y) <= enemy.radius * 0.88 + 4;
      })
      .sort((a, b) => b.y - a.y)[0];
    if (!target) continue;

    bullet.y = -100;
    target.hp -= 1;
    target.hitFlash = 0.065;
    events.push({ kind: 'hit', x: bullet.x, y: target.y + target.radius / 2, palette: target.palette, value: 1 });
    if (target.hp > 0) continue;

    const points = target.maxHp * 10;
    model.score += points;
    model.kills += 1;
    events.push({ kind: 'destroy', x: target.x, y: target.y, palette: target.palette, value: points });
    if (random() < RULES.coinChance) {
      model.drops.push({ x: target.x, y: target.y, age: 0 });
    }
  }
  model.bullets = model.bullets.filter((bullet) => bullet.y > 100);

  for (const enemy of model.enemies) {
    if (enemy.hp <= 0 || enemy.y + enemy.radius < WORLD.dangerY) continue;
    enemy.hp = 0;
    model.hp = Math.max(0, model.hp - RULES.missDamage);
    events.push({ kind: 'damage', x: enemy.x, y: WORLD.dangerY, palette: enemy.palette, value: RULES.missDamage });
    if (model.hp > 0) continue;

    model.status = 'over';
    model.firing = false;
    model.bullets = [];
    break;
  }
  model.enemies = model.enemies.filter((enemy) => enemy.hp > 0);
  if (model.status === 'over') return events;

  for (const coin of model.drops) {
    coin.age += dt;
    coin.y += (120 + coin.age * 220) * dt;
    coin.x += (model.cannonX - coin.x) * Math.min(1, dt * 4);
    if (coin.y < WORLD.cannonY - 12) continue;
    model.coins += 1;
    const healing = Math.min(RULES.coinHealing, RULES.maxHp - model.hp);
    model.hp += healing;
    events.push({ kind: 'heal', x: model.cannonX, y: WORLD.cannonY - 56, palette: 0, value: healing });
  }
  model.drops = model.drops.filter((coin) => coin.y < WORLD.cannonY - 12);
  return events;
};
