// 昼・夕方・夜の見た目の設定と、オートで時間帯を回す時計。three.js には依存しない。

export type Period = 'day' | 'evening' | 'night';
export type TimeMode = Period | 'auto';

export const PERIODS: Period[] = ['day', 'evening', 'night'];

export type Look = {
  skyTop: string;
  skyHorizon: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  // 太陽（夜は月）の向き。長さは scene.ts 側で影のカメラに合わせてそろえる。
  sunDirection: [number, number, number];
  // 窓明かりが点いている窓の割合（0〜1）
  windowLit: number;
  // 車・電車のライトと車内の明かりの強さ（0〜1）
  vehicleLights: number;
  // 看板・ビジョンの明るさの倍率
  signBoost: number;
  bloomStrength: number;
  bloomThreshold: number;
};

// 夜は雰囲気より見やすさを優先し、俯瞰でも人混みがわかる明るさにしている。
export const LOOKS: Record<Period, Look> = {
  day: {
    skyTop: '#3d7fd6',
    skyHorizon: '#d4e6f4',
    fog: '#d4e6f4',
    hemiSky: '#dcebff',
    hemiGround: '#a49684',
    hemiIntensity: 1.5,
    sunColor: '#fff3e0',
    sunIntensity: 2.6,
    sunDirection: [70, 160, 110],
    windowLit: 0,
    vehicleLights: 0,
    signBoost: 1,
    bloomStrength: 0,
    bloomThreshold: 1
  },
  evening: {
    skyTop: '#41528f',
    skyHorizon: '#f39a5b',
    fog: '#d9977a',
    hemiSky: '#f0b48c',
    hemiGround: '#6b5150',
    hemiIntensity: 1.1,
    sunColor: '#ff9c52',
    sunIntensity: 2.4,
    // 西（-x）寄りの低い位置から照らして影を長くする
    sunDirection: [-190, 55, 45],
    windowLit: 0.25,
    vehicleLights: 0.5,
    signBoost: 1.15,
    bloomStrength: 0.35,
    bloomThreshold: 0.85
  },
  night: {
    skyTop: '#060b1c',
    skyHorizon: '#26304f',
    fog: '#1c2440',
    hemiSky: '#6f84bd',
    hemiGround: '#2c2832',
    hemiIntensity: 0.75,
    sunColor: '#a9bde8',
    sunIntensity: 0.4,
    sunDirection: [-60, 170, 90],
    windowLit: 0.55,
    vehicleLights: 1,
    signBoost: 1.15,
    bloomStrength: 0.55,
    bloomThreshold: 0.8
  }
};

export const PERIOD_LABELS: Record<Period, string> = { day: '昼', evening: '夕方', night: '夜' };
export const TIME_MODE_LABELS: Record<TimeMode, string> = { ...PERIOD_LABELS, auto: 'オート' };

// オートでは 1 つの時間帯を HOLD 秒そのまま見せ、FADE 秒かけて次の時間帯へ移る。
export const AUTO = { hold: 50, fade: 10 };
const SPAN = AUTO.hold + AUTO.fade;

export type Clock = { mode: TimeMode; period: Period; elapsed: number };

export const createClock = (mode: TimeMode = 'auto'): Clock => ({ mode, period: 'day', elapsed: 0 });

export const nextPeriod = (period: Period): Period => PERIODS[(PERIODS.indexOf(period) + 1) % PERIODS.length];

// 昼・夕方・夜を選んだら即座にその時間帯で止める。オートは今の時間帯から周回を始める。
export const setClockMode = (clock: Clock, mode: TimeMode) => {
  if (mode === clock.mode) return;
  if (mode === 'auto') {
    clock.mode = 'auto';
    clock.elapsed = 0;
    return;
  }
  clock.mode = mode;
  clock.period = mode;
  clock.elapsed = 0;
};

export const stepClock = (clock: Clock, dt: number) => {
  if (clock.mode !== 'auto') return;
  clock.elapsed += dt;
  while (clock.elapsed >= SPAN) {
    clock.elapsed -= SPAN;
    clock.period = nextPeriod(clock.period);
  }
};

const smoothstep = (t: number) => t * t * (3 - 2 * t);

// 今の時間帯と、次の時間帯へどれだけ移ったか（0〜1）
export const clockBlend = (clock: Clock): { from: Period; to: Period; k: number } => {
  const to = nextPeriod(clock.period);
  if (clock.mode !== 'auto' || clock.elapsed <= AUTO.hold) return { from: clock.period, to, k: 0 };
  return { from: clock.period, to, k: smoothstep(Math.min(1, (clock.elapsed - AUTO.hold) / AUTO.fade)) };
};
