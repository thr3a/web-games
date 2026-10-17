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

export type Section = { area: number; side: Side };

export type Choice = {
  label: string;
  correct: boolean;
  section?: Section; // 区画当てで、この選択肢がどの区画か
  rank?: number; // 並べ替えで、この選択肢が正しくは何番目か（0 始まり）
};

export type QuestionKind =
  | 'nearer'
  | 'hand'
  | 'sameSection'
  | 'section'
  | 'between'
  | 'nearest'
  | 'oddOne'
  | 'notInSection'
  | 'whichShop'
  | 'order';

export const QUESTION_KINDS: QuestionKind[] = [
  'nearer',
  'hand',
  'sameSection',
  'section',
  'between',
  'nearest',
  'oddOne',
  'notInSection',
  'whichShop',
  'order'
];

export type Question = {
  kind: QuestionKind;
  text: string;
  choices: Choice[];
  shops: Shop[]; // 答え合わせで場所を見せる店
  keyShops: Shop[]; // 問題文に出る店と正解の店。同じプレイで 2 回出さない対象
  hintShops?: Shop[]; // 出題時にもミニマップを出す場合に点を打つ店（空なら地図だけ）
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

// rng で items から重複なしに count 個選ぶ。
const pickMany = <T>(items: T[], count: number, rng: Rng): T[] => shuffle(items, rng).slice(0, count);

const sameSection = (a: Shop, b: Shop): boolean => a.area === b.area && a.side === b.side;

export const AREAS = [1, 2, 3, 4];
export const SIDES: Side[] = ['left', 'right'];

export const sectionLabel = (section: Section): string =>
  `PALM-${section.area} ${section.side === 'left' ? '左側' : '右側'}`;

const shopChoices = (choiceShops: Shop[], correct: Shop): Choice[] =>
  choiceShops.map((shop) => ({ label: shop.name, correct: shop.id === correct.id }));

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
    shops: [first, second],
    keyShops: [first, second]
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
    shops: [shop],
    keyShops: [shop]
  };
};

// 同じ区画？ 正解が偏らないよう、半々で同じ区画の店を選ぶ。
// 違う区画のときは別エリアの同じ側から選ぶ（同じエリアの反対側は使わない）。
const makeSameSection = (shops: Shop[], rng: Rng): Question => {
  const a = pick(shops, rng);
  const wantSame = rng() < 0.5;
  const b = pick(
    shops.filter((shop) =>
      wantSame ? sameSection(shop, a) && shop.id !== a.id : shop.area !== a.area && shop.side === a.side
    ),
    rng
  );
  const same = sameSection(a, b);
  return {
    kind: 'sameSection',
    text: `「${a.name}」と「${b.name}」は同じ区画？`,
    choices: [
      { label: '同じ区画', correct: same },
      { label: '違う区画', correct: !same }
    ],
    shops: [a, b],
    keyShops: [a, b]
  };
};

// 区画当て。ミニマップの 8 区画をタップして答える。
const makeSection = (shops: Shop[], rng: Rng): Question => {
  const shop = pick(shops, rng);
  const sections = AREAS.flatMap((area) => SIDES.map((side) => ({ area, side })));
  return {
    kind: 'section',
    text: `「${shop.name}」はどこ？`,
    choices: sections.map((section) => ({
      label: sectionLabel(section),
      correct: section.area === shop.area && section.side === shop.side,
      section
    })),
    shops: [shop],
    keyShops: [shop]
  };
};

// 同じ側の店を駅側から並べる。同じ側ならエリアをまたいでも、エリア番号 → 並び順で比べられる。
const sideLine = (shops: Shop[], side: Side): Shop[] =>
  shops.filter((shop) => shop.side === side).sort((a, b) => a.area - b.area || a.order - b.order);

// 間にある店はどれ？ A・B・選択肢はすべて同じ側にそろえる。
const makeBetween = (shops: Shop[], rng: Rng): Question => {
  const line = sideLine(shops, pick(SIDES, rng));
  // A と B の間に 1 店以上あり、間に入らない店が不正解用に 3 店以上残るペアだけを候補にする。
  const pairs = line.flatMap((_, i) =>
    line.flatMap((__, j) => (j - i >= 2 && line.length - (j - i + 1) >= 3 ? [[i, j]] : []))
  );
  const [i, j] = pick(pairs, rng);
  const correct = pick(line.slice(i + 1, j), rng);
  const wrongs = pickMany([...line.slice(0, i), ...line.slice(j + 1)], 3, rng);
  const [first, second] = shuffle([line[i], line[j]], rng);
  const choiceShops = shuffle([correct, ...wrongs], rng);
  return {
    kind: 'between',
    text: `「${first.name}」と「${second.name}」の間にある店は？`,
    choices: shopChoices(choiceShops, correct),
    shops: [first, second, ...choiceShops],
    keyShops: [first, second, correct]
  };
};

// いちばん駅（中原街道）に近いのは？ 正解の店を基準に、同じ区画 1 店・別エリア 2 店を足す。
// 注意: 同じエリアの反対側の店は比べられないので入れない。
const makeNearest = (shops: Shop[], rng: Rng): Question => {
  const toStation = rng() < 0.5;
  // 駅版なら正解より駅から遠い店、中原街道版なら正解より駅に近い店だけを他の選択肢に使う。
  const farther = (shop: Shop, base: Shop): boolean =>
    toStation ? isNearerStation(base, shop) : isNearerStation(shop, base);
  const sameCandidates = (base: Shop): Shop[] => shops.filter((shop) => sameSection(shop, base) && farther(shop, base));
  const otherCandidates = (base: Shop): Shop[] =>
    shops.filter((shop) => shop.area !== base.area && farther(shop, base));
  const correct = pick(
    shops.filter((shop) => sameCandidates(shop).length >= 1 && otherCandidates(shop).length >= 2),
    rng
  );
  const choiceShops = shuffle(
    [correct, pick(sameCandidates(correct), rng), ...pickMany(otherCandidates(correct), 2, rng)],
    rng
  );
  const names = choiceShops.map((shop) => `「${shop.name}」`).join('');
  return {
    kind: 'nearest',
    text: `${names}のうち、いちばん${toStation ? '駅' : '中原街道'}に近いのは？`,
    choices: shopChoices(choiceShops, correct),
    shops: choiceShops,
    keyShops: choiceShops
  };
};

// 仲間はずれ。1 つのエリアから 3 店、別のエリアから 1 店（これが正解）。
const makeOddOne = (shops: Shop[], rng: Rng): Question => {
  const area = pick(AREAS, rng);
  const correct = pick(
    shops.filter((shop) => shop.area !== area),
    rng
  );
  const choiceShops = shuffle(
    [
      correct,
      ...pickMany(
        shops.filter((shop) => shop.area === area),
        3,
        rng
      )
    ],
    rng
  );
  return {
    kind: 'oddOne',
    text: '1 つだけエリアが違う店は？',
    choices: shopChoices(choiceShops, correct),
    shops: choiceShops,
    keyShops: [correct]
  };
};

// この区画にない店は？ 1 つの区画から 3 店、別の区画から 1 店（これが正解）。
const makeNotInSection = (shops: Shop[], rng: Rng): Question => {
  const base = pick(shops, rng);
  const correct = pick(
    shops.filter((shop) => !sameSection(shop, base)),
    rng
  );
  const choiceShops = shuffle(
    [
      correct,
      ...pickMany(
        shops.filter((shop) => sameSection(shop, base)),
        3,
        rng
      )
    ],
    rng
  );
  return {
    kind: 'notInSection',
    text: `PALM-${base.area}の${base.side === 'left' ? '左側' : '右側'}にない店は？`,
    choices: shopChoices(choiceShops, correct),
    shops: choiceShops,
    keyShops: [correct],
    hintShops: []
  };
};

// ここは何の店？ ミニマップの点は厳密な位置ではないので、近すぎる店は不正解に使わない。
const makeWhichShop = (shops: Shop[], rng: Rng): Question => {
  const correct = pick(shops, rng);
  const sameRest = shops.filter((shop) => sameSection(shop, correct) && Math.abs(shop.order - correct.order) > 3);
  const otherRest = shops.filter((shop) => !sameSection(shop, correct));
  // 同じ区画の店を優先し、足りない分を他の区画から補う。
  const wrongs = [...pickMany(sameRest, 3, rng), ...pickMany(otherRest, 3, rng)].slice(0, 3);
  const choiceShops = shuffle([correct, ...wrongs], rng);
  return {
    kind: 'whichShop',
    text: 'ミニマップの ● の位置にある店は？',
    choices: shopChoices(choiceShops, correct),
    shops: choiceShops,
    keyShops: [correct],
    hintShops: [correct]
  };
};

// 並べ替え。同じ区画の 2 店（側もそろえる）と、別エリアの 2 店（側は問わない）を見える順にタップする。
// 注意: 同じエリアの左右にまたがる店は比べられないので、4 店は 3 つのエリアにまたがるようにする。
const makeOrder = (shops: Shop[], direction: Direction, rng: Rng): Question => {
  const a = pick(
    shops.filter((shop) => shops.some((other) => sameSection(other, shop) && other.id !== shop.id)),
    rng
  );
  const b = pick(
    shops.filter((shop) => sameSection(shop, a) && shop.id !== a.id),
    rng
  );
  const others = pickMany(
    AREAS.filter((area) => area !== a.area),
    2,
    rng
  ).map((area) =>
    pick(
      shops.filter((shop) => shop.area === area),
      rng
    )
  );
  const sorted = [a, b, ...others].sort((x, y) => (isNearerStation(x, y) ? -1 : 1));
  // 中原街道から歩くなら見える順は逆になる。
  const answerOrder = direction === 'fromStation' ? sorted : [...sorted].reverse();
  const choiceShops = shuffle(answerOrder, rng);
  return {
    kind: 'order',
    text: `${directionText(direction)}見える順にタップしてね`,
    choices: choiceShops.map((shop) => ({
      label: shop.name,
      correct: false,
      rank: answerOrder.findIndex((ordered) => ordered.id === shop.id)
    })),
    shops: choiceShops,
    keyShops: choiceShops
  };
};

// 並べ替えの答え（選択肢の番号をタップした順に並べたもの）が合っているか。
export const isCorrectOrder = (question: Question, order: number[]): boolean =>
  order.length === question.choices.length && order.every((choiceIndex, i) => question.choices[choiceIndex].rank === i);

// 出題形式をランダムに混ぜる。kinds を渡すとその形式だけから選ぶ（デバッグ用）。
export const makeQuestion = (shops: Shop[], rng: Rng, kinds: QuestionKind[] = QUESTION_KINDS): Question => {
  // 歩く向きは毎問半々で選ぶ。
  const direction: Direction = rng() < 0.5 ? 'fromStation' : 'fromNakahara';
  const makers: Record<QuestionKind, () => Question> = {
    nearer: () => makeNearer(shops, direction, rng),
    hand: () => makeHand(shops, direction, rng),
    sameSection: () => makeSameSection(shops, rng),
    section: () => makeSection(shops, rng),
    between: () => makeBetween(shops, rng),
    nearest: () => makeNearest(shops, rng),
    oddOne: () => makeOddOne(shops, rng),
    notInSection: () => makeNotInSection(shops, rng),
    whichShop: () => makeWhichShop(shops, rng),
    order: () => makeOrder(shops, direction, rng)
  };
  return makers[pick(kinds, rng)]();
};

// 同じ店ばかり出ないよう、直前までの問題と店がかぶったら作り直す。
export const makeQuestions = (shops: Shop[], rng: Rng, kinds: QuestionKind[] = QUESTION_KINDS): Question[] => {
  const questions: Question[] = [];
  const used = new Set<number>();
  while (questions.length < QUESTION_COUNT) {
    const question = makeQuestion(shops, rng, kinds);
    if (question.keyShops.some((shop) => used.has(shop.id))) continue;
    for (const shop of question.keyShops) used.add(shop.id);
    questions.push(question);
  }
  return questions;
};

// URL の ?kind=order,hand のような指定を出題形式の一覧にする。正しい形式が 1 つもなければ全形式。
export const parseKinds = (param: string | null): QuestionKind[] => {
  if (!param) return QUESTION_KINDS;
  const kinds = QUESTION_KINDS.filter((kind) => param.split(',').includes(kind));
  return kinds.length > 0 ? kinds : QUESTION_KINDS;
};
