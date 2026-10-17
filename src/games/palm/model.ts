export type Side = 'left' | 'right';

export type Shop = {
  id: number;
  area: number;
  side: Side; // 駅から中原街道へ歩いたときの左右
  order: number; // 区画内で駅側から何番目か
  name: string;
  floor: number;
};

export type Direction = 'fromStation' | 'fromNakahara';

export type Choice = { label: string; correct: boolean };

export type QuestionKind = 'nearer' | 'hand' | 'sameArea';

export type Question = {
  kind: QuestionKind;
  text: string;
  choices: Choice[];
  shops: Shop[]; // 答え合わせで場所を見せる店
};

export type Rng = () => number;

export const QUESTION_COUNT = 5;

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

const shuffle = <T>(items: T[], rng: Rng): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const sameSection = (a: Shop, b: Shop): boolean => a.area === b.area && a.side === b.side;

// 歩く向きに合わせた手の左右。中原街道から駅へ歩くと左右が入れ替わる。
const handOf = (shop: Shop, direction: Direction): Side => {
  if (direction === 'fromStation') return shop.side;
  return shop.side === 'left' ? 'right' : 'left';
};

const directionText = (direction: Direction): string =>
  direction === 'fromStation' ? '駅から中原街道へ向かっています。' : '中原街道から駅へ向かっています。';

// 駅により近いのは a か。別エリアならエリア番号、同じ区画なら並び順で決める。
const isNearerStation = (a: Shop, b: Shop): boolean => {
  if (a.area !== b.area) return a.area < b.area;
  return a.order < b.order;
};

// どっちを先に通る？ 半々で、別エリアの 2 店か同じ区画の 2 店を選ぶ。
// 注意: 同じエリアの左右にまたがるペアは並び順で比べられないので出さない。
const makeNearer = (shops: Shop[], direction: Direction, rng: Rng): Question => {
  const a = pick(shops, rng);
  const otherArea = rng() < 0.5;
  const b = pick(
    shops.filter((shop) => (otherArea ? shop.area !== a.area : sameSection(shop, a) && shop.id !== a.id)),
    rng
  );
  // 駅から歩くなら駅に近い方、中原街道から歩くなら中原街道に近い方を先に通る。
  const aNearer = isNearerStation(a, b);
  const aCorrect = direction === 'fromStation' ? aNearer : !aNearer;
  const [first, second] = shuffle([a, b], rng);
  return {
    kind: 'nearer',
    text: `${directionText(direction)}「${first.name}」と「${second.name}」、先に通るのは？`,
    choices: [first, second].map((shop) => ({ label: shop.name, correct: (shop === a) === aCorrect })),
    shops: [first, second]
  };
};

// この店は○○から見て右手？左手？
const makeHand = (shops: Shop[], direction: Direction, rng: Rng): Question => {
  const shop = pick(shops, rng);
  const hand = handOf(shop, direction);
  return {
    kind: 'hand',
    text: `${directionText(direction)}「${shop.name}」は右手？左手？`,
    choices: [
      { label: '左手', correct: hand === 'left' },
      { label: '右手', correct: hand === 'right' }
    ],
    shops: [shop]
  };
};

// 同じエリア？ 正解が偏らないよう、半々で同じエリアの店を選ぶ。
const makeSameArea = (shops: Shop[], rng: Rng): Question => {
  const a = pick(shops, rng);
  const wantSame = rng() < 0.5;
  const b = pick(
    shops.filter((shop) => shop.id !== a.id && (shop.area === a.area) === wantSame),
    rng
  );
  const same = a.area === b.area;
  return {
    kind: 'sameArea',
    text: `「${a.name}」と「${b.name}」は同じエリア？`,
    choices: [
      { label: '同じエリア', correct: same },
      { label: '違うエリア', correct: !same }
    ],
    shops: [a, b]
  };
};

// 出題形式をランダムに混ぜる。
export const makeQuestion = (shops: Shop[], rng: Rng): Question => {
  // 歩く向きは毎問半々で選ぶ。
  const direction: Direction = rng() < 0.5 ? 'fromStation' : 'fromNakahara';
  const makers: (() => Question)[] = [
    () => makeNearer(shops, direction, rng),
    () => makeHand(shops, direction, rng),
    () => makeSameArea(shops, rng)
  ];
  return pick(makers, rng)();
};

// 同じ店ばかり出ないよう、直前までの問題と店がかぶったら作り直す。
export const makeQuestions = (shops: Shop[], rng: Rng): Question[] => {
  const questions: Question[] = [];
  const used = new Set<number>();
  while (questions.length < QUESTION_COUNT) {
    const question = makeQuestion(shops, rng);
    if (question.shops.some((shop) => used.has(shop.id))) continue;
    for (const shop of question.shops) used.add(shop.id);
    questions.push(question);
  }
  return questions;
};
