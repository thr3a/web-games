// /houdai の難易度調整用に、ボットに大量のゲームを遊ばせて生存時間などを集計する。
// 実行: node --import tsx ./src/scripts/houdai-sim.ts
import { createModel, type Enemy, type GameModel, moveCannon, RULES, stepModel } from '../games/houdai/model';

type Bot = {
  name: string;
  // 画面を見てから指を動かすまでの遅れ（秒）
  reaction: number;
  // 狙いのブレ（px）
  aimError: number;
  // 指を離している割合（持ち替え・様子見など）
  idleRate: number;
};

type Result = { time: number; score: number; firstHit: number; healed: number; kills: number };

const BOTS: Bot[] = [
  { name: '上級者', reaction: 0.18, aimError: 8, idleRate: 0.03 },
  { name: '初心者', reaction: 0.35, aimError: 22, idleRate: 0.12 }
];

const DT = 1 / 120;
const LIMIT = 300;

const mulberry32 = (seed: number) => {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// いちばん下（危険）の敵を狙う。
const pickTarget = (model: GameModel): Enemy | undefined =>
  [...model.enemies].sort((a, b) => b.y + b.radius - (a.y + a.radius))[0];

const play = (bot: Bot, seed: number): Result => {
  const random = mulberry32(seed);
  const botRandom = mulberry32(seed * 7 + 1);
  const model = createModel();
  model.status = 'playing';
  let firstHit = -1;
  let healed = 0;
  let decision = 0;
  let aimX = model.cannonX;
  while (model.status === 'playing' && model.elapsed < LIMIT) {
    decision -= DT;
    if (decision <= 0) {
      decision = bot.reaction;
      const target = pickTarget(model);
      model.firing = target !== undefined && botRandom() > bot.idleRate;
      // 反応遅れの分だけ古い位置を狙う。
      if (target) aimX = target.x - target.vx * bot.reaction + (botRandom() - 0.5) * 2 * bot.aimError;
    }
    moveCannon(model, aimX);
    const before = model.hp;
    for (const event of stepModel(model, DT, random)) {
      if (event.kind === 'heal') healed += event.value;
    }
    if (model.hp < before && firstHit < 0) firstHit = model.elapsed;
  }
  return { time: model.elapsed, score: model.score, firstHit, healed, kills: model.kills };
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

const GAMES = 200;
// 例: node --import tsx ./src/scripts/houdai-sim.ts enemyMinHp=10 spawnInterval=2
// @types/node を入れていないので、process.argv は型を確かめながら読む。
const readArgs = (): string[] => {
  const proc: unknown = Reflect.get(globalThis, 'process');
  if (typeof proc !== 'object' || proc === null) return [];
  const argv: unknown = Reflect.get(proc, 'argv');
  if (!Array.isArray(argv)) return [];
  return argv.slice(2).filter((arg): arg is string => typeof arg === 'string');
};
for (const arg of readArgs()) {
  const [key, value] = arg.split('=');
  if (!(key in RULES)) throw new Error(`不明なパラメータ: ${key}`);
  Object.assign(RULES, { [key]: Number(value) });
}
console.log(
  `RULES: hp=${RULES.enemyMinHp}〜${RULES.enemyMinHp + RULES.enemyHpRange - 1} spawn=${RULES.spawnInterval}s miss=${RULES.missDamage}/${RULES.splitMissDamage}`
);
for (const bot of BOTS) {
  const results = Array.from({ length: GAMES }, (_, i) => play(bot, i + 1));
  const times = results.map((result) => result.time);
  const firstHits = results.map((result) => (result.firstHit < 0 ? LIMIT : result.firstHit));
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  console.log(
    [
      bot.name.padEnd(4, '　'),
      `生存 P10=${percentile(times, 0.1).toFixed(0)}s 中央=${percentile(times, 0.5).toFixed(0)}s P90=${percentile(times, 0.9).toFixed(0)}s`,
      `初被弾 中央=${percentile(firstHits, 0.5).toFixed(0)}s`,
      `上限到達=${results.filter((result) => result.time >= LIMIT).length}/${GAMES}`,
      `スコア中央=${percentile(
        results.map((result) => result.score),
        0.5
      )}`,
      `回復平均=${avg(results.map((result) => result.healed)).toFixed(0)}`
    ].join(' | ')
  );
}
