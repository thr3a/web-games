export type Side = 'left' | 'right';

export type Shop = {
  id: number;
  block: number;
  side: Side; // 駅から中原街道へ歩いたときの左右
  order: number; // 区画内で駅側から何番目か
  name: string;
  floor: number;
};

export type Direction = 'fromStation' | 'fromNakahara';

export type Choice = { label: string; correct: boolean };

export type QuestionKind = 'nearer' | 'hand' | 'sameBlock';

export type Question = {
  kind: QuestionKind;
  text: string;
  choices: Choice[];
  shops: Shop[]; // 答え合わせで場所を見せる店
};

export type Rng = () => number;

export const QUESTION_COUNT = 10;

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

const shuffle = <T>(items: T[], rng: Rng): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

const sideLabel = (side: Side): string => (side === 'left' ? '左' : '右');

const sameSection = (a: Shop, b: Shop): boolean => a.block === b.block && a.side === b.side;

// 歩く向きに合わせた手の左右。中原街道から駅へ歩くと左右が入れ替わる。
const handOf = (shop: Shop, direction: Direction): Side => {
  if (direction === 'fromStation') return shop.side;
  return shop.side === 'left' ? 'right' : 'left';
};

const directionText = (direction: Direction): string =>
  direction === 'fromStation' ? '駅から中原街道へ向かっています。' : '中原街道から駅へ向かっています。';

// 駅により近いのは a か。別ブロックならブロック番号、同じ区画なら並び順で決める。
const isNearerStation = (a: Shop, b: Shop): boolean => {
  if (a.block !== b.block) return a.block < b.block;
  return a.order < b.order;
};

// どっちを先に通る？ 半々で、別ブロックの 2 店か同じ区画の 2 店を選ぶ。
// 注意: 同じブロックの左右にまたがるペアは並び順で比べられないので出さない。
const makeNearer = (shops: Shop[], direction: Direction, rng: Rng): Question => {
  const a = pick(shops, rng);
  const otherBlock = rng() < 0.5;
  const b = pick(
    shops.filter((shop) => (otherBlock ? shop.block !== a.block : sameSection(shop, a) && shop.id !== a.id)),
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

// 同じブロック？ 正解が偏らないよう、半々で同じブロックの店を選ぶ。
const makeSameBlock = (shops: Shop[], rng: Rng): Question => {
  const a = pick(shops, rng);
  const wantSame = rng() < 0.5;
  const b = pick(
    shops.filter((shop) => shop.id !== a.id && (shop.block === a.block) === wantSame),
    rng
  );
  const same = a.block === b.block;
  return {
    kind: 'sameBlock',
    text: `「${a.name}」と「${b.name}」は同じブロック？`,
    choices: [
      { label: '同じブロック', correct: same },
      { label: '違うブロック', correct: !same }
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
    () => makeSameBlock(shops, rng)
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

// 区画内で駅側から何軒目か（出題対象の店だけで数える）。
const rankInSection = (shops: Shop[], shop: Shop): number =>
  shops.filter((other) => sameSection(other, shop) && other.order <= shop.order).length;

// 答え合わせ用の説明。例: 「マクドナルド: PALM-2 右側」（左右は駅から見たもの）
// 同じ区画どうしの問題では、並び順で判定するので駅側から何軒目かも添える。
export const describeShops = (question: Question, shops: Shop[]): string[] => {
  const withRank = question.shops.length === 2 && sameSection(question.shops[0], question.shops[1]);
  return question.shops.map((shop) => {
    const floor = shop.floor >= 2 ? `（${shop.floor}F）` : '';
    const rank = withRank ? ` 駅側から${rankInSection(shops, shop)}軒目` : '';
    return `${shop.name}: PALM-${shop.block} ${sideLabel(shop.side)}側${rank}${floor}`;
  });
};
