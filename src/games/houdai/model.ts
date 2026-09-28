export const WORLD = { width: 390, height: 780, cannonY: 678, dangerY: 674 };

export const RULES = {
  maxHp: 100,
  missDamage: 25,
  splitMissDamage: 10,
  coinHealing: 8,
  coinChance: 0.15,
  shotInterval: 0.12,
  bulletSpeed: 760,
  spawnInterval: 1.2,
  maxEnemies: 5,
  speedMin: 45,
  speedRange: 60,
  enemyMinHp: 8,
  enemyHpRange: 10,
  splitRadius: 22,
  splitSpeedX: 75,
  splitHop: 150,
  coinGravity: 620,
  coinBounces: 3
};

export const PALETTE_COUNT = 5;

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
  vx: number;
  vy: number;
  reward: number;
};
export type Bullet = { x: number; y: number };
export type Coin = { x: number; y: number; vx: number; vy: number; bounces: number };
export type GameEvent = {
  kind: 'hit' | 'split' | 'destroy' | 'damage' | 'heal';
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
  const hp = RULES.enemyMinHp + Math.floor(random() * RULES.enemyHpRange);
  const radius = 30 + hp * 0.8;
  // 画面上部にいる敵となるべく重ならない位置を、いくつかの候補から選ぶ。
  const upper = model.enemies.filter((enemy) => enemy.y < 260);
  const clearance = (x: number) => Math.min(Infinity, ...upper.map((enemy) => Math.abs(enemy.anchorX - x)));
  const candidates = Array.from({ length: 4 }, () => 60 + random() * (WORLD.width - 120));
  const anchorX = candidates.reduce((best, x) => (clearance(x) > clearance(best) ? x : best));
  const speed = RULES.speedMin + random() * RULES.speedRange;
  model.enemies.push({
    id: model.nextId++,
    x: anchorX,
    anchorX,
    y: 112 - radius,
    hp,
    maxHp: hp,
    radius,
    speed,
    phase: random() * Math.PI * 2,
    rotation: random() * Math.PI,
    sides: 5 + Math.floor(random() * 3),
    palette: Math.floor(random() * PALETTE_COUNT),
    hitFlash: 0,
    vx: 0,
    vy: speed,
    reward: hp * 5
  });
};

// 「2」に命中したら、左右に跳ねる小さな「1」を2体生む。
const splitEnemy = (model: GameModel, parent: Enemy) => {
  for (const direction of [-1, 1]) {
    const radius = RULES.splitRadius;
    const anchorX = Math.max(radius, Math.min(WORLD.width - radius, parent.anchorX + direction * (radius + 6)));
    model.enemies.push({
      ...parent,
      id: model.nextId++,
      anchorX,
      x: anchorX,
      hp: 1,
      maxHp: 1,
      radius,
      sides: Math.max(3, parent.sides - 1),
      hitFlash: 0,
      vx: direction * RULES.splitSpeedX,
      vy: -RULES.splitHop
    });
  }
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
    enemy.vy += (enemy.speed - enemy.vy) * Math.min(1, dt * 3);
    enemy.y += enemy.vy * dt;
    enemy.vx *= Math.exp(-2.5 * dt);
    enemy.anchorX += enemy.vx * dt;
    const edge = enemy.radius + 18;
    if (enemy.anchorX < edge || enemy.anchorX > WORLD.width - edge) {
      enemy.anchorX = Math.max(edge, Math.min(WORLD.width - edge, enemy.anchorX));
      enemy.vx = -enemy.vx;
    }
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
    target.palette = (target.palette + 1) % PALETTE_COUNT;
    events.push({ kind: 'hit', x: bullet.x, y: target.y + target.radius / 2, palette: target.palette, value: 1 });
    if (target.hp > 1) continue;

    if (target.hp === 1) {
      target.hp = 0;
      splitEnemy(model, { ...target, hp: 1 });
      events.push({ kind: 'split', x: target.x, y: target.y, palette: target.palette, value: 0 });
      continue;
    }

    model.score += target.reward;
    model.kills += 1;
    events.push({ kind: 'destroy', x: target.x, y: target.y, palette: target.palette, value: target.reward });
    if (random() < RULES.coinChance) {
      model.drops.push({ x: target.x, y: target.y, vx: (random() - 0.5) * 120, vy: -180, bounces: 0 });
    }
  }
  model.bullets = model.bullets.filter((bullet) => bullet.y > 100);

  for (const enemy of model.enemies) {
    if (enemy.hp <= 0 || enemy.y + enemy.radius < WORLD.dangerY) continue;
    enemy.hp = 0;
    const damage = enemy.maxHp === 1 ? RULES.splitMissDamage : RULES.missDamage;
    model.hp = Math.max(0, model.hp - damage);
    events.push({ kind: 'damage', x: enemy.x, y: WORLD.dangerY, palette: enemy.palette, value: damage });
    if (model.hp > 0) continue;

    model.status = 'over';
    model.firing = false;
    model.bullets = [];
    break;
  }
  model.enemies = model.enemies.filter((enemy) => enemy.hp > 0);
  if (model.status === 'over') return events;

  const collected: Coin[] = [];
  for (const coin of model.drops) {
    coin.vy += RULES.coinGravity * dt;
    coin.x += coin.vx * dt;
    coin.y += coin.vy * dt;
    if (coin.x < 14 || coin.x > WORLD.width - 14) {
      coin.x = Math.max(14, Math.min(WORLD.width - 14, coin.x));
      coin.vx = -coin.vx;
    }
    const ground = WORLD.cannonY + 4;
    if (coin.y >= ground) {
      coin.y = ground;
      coin.vy = -Math.abs(coin.vy) * 0.55;
      coin.bounces += 1;
    }
    // 砲台に触れるか、跳ね終わったら自動で取得する。
    const touching = Math.abs(coin.x - model.cannonX) < 40 && coin.y > WORLD.cannonY - 70;
    if (!touching && coin.bounces < RULES.coinBounces) continue;
    collected.push(coin);
    model.coins += 1;
    const healing = Math.min(RULES.coinHealing, RULES.maxHp - model.hp);
    model.hp += healing;
    events.push({ kind: 'heal', x: coin.x, y: WORLD.cannonY - 56, palette: 0, value: healing });
  }
  model.drops = model.drops.filter((coin) => !collected.includes(coin));
  return events;
};
