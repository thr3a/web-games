import { RECT_COLORS } from './model';

// クリア演出。紙吹雪（左右からのクラッカー → 降りそそぐ）と、そのあと終わりなく上がり続ける花火。
// 花火は尾を引く描画をするので、紙吹雪とは別の canvas に描く。

type Tick = (ctx: CanvasRenderingContext2D, dt: number, t: number, w: number, h: number) => void;

type Confetti = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  color: string;
  phase: number;
};

type Rocket = { x: number; y: number; targetY: number; hue: number };

type Spark = { x: number; y: number; vx: number; vy: number; life: number; age: number; hue: number };

const CONFETTI_COLORS = [...RECT_COLORS.map((color) => color.fill), '#ffffff'];
const FIREWORK_HUES = [350, 40, 200, 280, 140, 20];
// 花火が上がり始めるまでの秒数。
const FIREWORK_START = 2.6;
const CONFETTI_TRICKLE_START = 1.2;
const CONFETTI_TRICKLE_END = 3.6;

const rand = (min: number, max: number): number => min + Math.random() * (max - min);

// canvas を画面全体に合わせて、フレームごとに tick を呼ぶ。止めるための関数を返す。
const runLoop = (canvas: HTMLCanvasElement, tick: Tick): (() => void) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const start = performance.now();
  let last = start;
  let frame = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    tick(ctx, dt, (now - start) / 1000, w, h);
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(frame);
};

const createConfettiTick = (): Tick => {
  const bits: Confetti[] = [];
  let cannonsFired = 0;
  let trickleDebt = 0;

  const addBit = (x: number, y: number, vx: number, vy: number, index: number) => {
    bits.push({
      x,
      y,
      vx,
      vy,
      w: rand(6, 11),
      h: rand(4, 8),
      rot: rand(0, 6),
      vr: rand(-9, 9),
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      phase: rand(0, 6)
    });
  };
  // 画面の下の左右の角から、斜め上に打ち出す。
  const fireCannon = (x: number, direction: 1 | -1, h: number) => {
    for (let i = 0; i < 55; i++) {
      const angle = -Math.PI / 2 + direction * rand(0.15, 0.85);
      const speed = rand(380, 780);
      addBit(x, h - 10, Math.cos(angle) * speed, Math.sin(angle) * speed, i);
    }
  };

  return (ctx, dt, t, w, h) => {
    // 1回目は開始直後、2回目は少し遅れて打つ。
    if (cannonsFired === 0 || (cannonsFired === 1 && t > 0.8)) {
      fireCannon(0, 1, h);
      fireCannon(w, -1, h);
      cannonsFired++;
    }
    if (t > CONFETTI_TRICKLE_START && t < CONFETTI_TRICKLE_END) {
      trickleDebt += dt * 120;
      for (; trickleDebt >= 1; trickleDebt--)
        addBit(rand(0, w), -10, rand(-20, 20), rand(60, 140), Math.floor(rand(0, 7)));
    }
    ctx.clearRect(0, 0, w, h);
    for (let i = bits.length - 1; i >= 0; i--) {
      const bit = bits[i];
      bit.vx *= 1 - 1.6 * dt;
      bit.vy += (bit.vy < 0 ? 900 : 260) * dt;
      bit.vy = Math.min(bit.vy, 190);
      bit.x += (bit.vx + Math.sin(t * 5 + bit.phase) * 40) * dt;
      bit.y += bit.vy * dt;
      bit.rot += bit.vr * dt;
      if (bit.y > h + 20) {
        bits.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(bit.x, bit.y);
      ctx.rotate(bit.rot);
      ctx.scale(1, Math.cos(t * 6 + bit.phase));
      ctx.fillStyle = bit.color;
      ctx.fillRect(-bit.w / 2, -bit.h / 2, bit.w, bit.h);
      ctx.restore();
    }
  };
};

const createFireworksTick = (): Tick => {
  const rockets: Rocket[] = [];
  const sparks: Spark[] = [];
  let nextRocket = FIREWORK_START;

  return (ctx, dt, t, w, h) => {
    if (t > nextRocket) {
      nextRocket = t + rand(0.35, 0.9);
      rockets.push({
        x: rand(w * 0.1, w * 0.9),
        y: h,
        targetY: rand(h * 0.12, h * 0.55),
        hue: FIREWORK_HUES[Math.floor(rand(0, FIREWORK_HUES.length))]
      });
    }
    // 少しずつ透明にして、花火が尾を引くようにする。
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = rockets.length - 1; i >= 0; i--) {
      const rocket = rockets[i];
      rocket.y -= 620 * dt;
      ctx.fillStyle = '#ffe9b0';
      ctx.fillRect(rocket.x - 1.5, rocket.y, 3, 14);
      if (rocket.y > rocket.targetY) continue;
      for (let k = 0; k < 70; k++) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(40, 190) * (k % 2 ? 1 : 0.62);
        sparks.push({
          x: rocket.x,
          y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(1, 1.6),
          age: 0,
          hue: rocket.hue + rand(-12, 12)
        });
      }
      rockets.splice(i, 1);
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age > spark.life) {
        sparks.splice(i, 1);
        continue;
      }
      spark.vx *= 0.985;
      spark.vy = spark.vy * 0.985 + 110 * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      ctx.fillStyle = `hsla(${spark.hue} 100% ${70 - spark.age * 12}% / ${1 - spark.age / spark.life})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, 2.4, 0, 7);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  };
};

// 演出を始める。戻り値の関数で止める。
export const startCelebration = (
  confettiCanvas: HTMLCanvasElement,
  fireworksCanvas: HTMLCanvasElement
): (() => void) => {
  const stopConfetti = runLoop(confettiCanvas, createConfettiTick());
  const stopFireworks = runLoop(fireworksCanvas, createFireworksTick());
  return () => {
    stopConfetti();
    stopFireworks();
  };
};
