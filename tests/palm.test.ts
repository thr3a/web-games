import { expect, test } from 'vitest';
import { makeQuestion, makeQuestions, type Question, type Shop } from '../src/games/palm/model';
import { SHOPS } from '../src/games/palm/shops';

// 再現できるよう、シード付きの簡単な乱数を使う。
const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};

const byName = (name: string): Shop => {
  const shop = SHOPS.find((item) => item.name === name);
  if (!shop) throw new Error(`店が見つからない: ${name}`);
  return shop;
};

const quotedNames = (text: string): Shop[] => [...text.matchAll(/「(.+?)」/g)].map((match) => byName(match[1]));
const correctShop = (question: Question): Shop => byName(question.choices.filter((c) => c.correct)[0].label);
const choiceShops = (question: Question): Shop[] => question.choices.map((c) => byName(c.label));
const pos = (shop: Shop): number => shop.area * 1000 + shop.order;
const sameSection = (a: Shop, b: Shop): boolean => a.area === b.area && a.side === b.side;

const collect = (): Map<string, Question[]> => {
  const rng = seeded(42);
  const map = new Map<string, Question[]>();
  for (let i = 0; i < 6000; i++) {
    const question = makeQuestion(SHOPS, rng);
    map.set(question.kind, [...(map.get(question.kind) ?? []), question]);
  }
  return map;
};

const questions = collect();

test('全形式が出題され、正解はちょうど 1 つ', () => {
  expect([...questions.keys()].sort()).toEqual(
    ['between', 'hand', 'nearer', 'nearest', 'notInSection', 'oddOne', 'sameSection', 'section', 'whichShop'].sort()
  );
  for (const list of questions.values()) {
    for (const question of list) {
      expect(question.choices.filter((c) => c.correct)).toHaveLength(1);
      expect(new Set(question.choices.map((c) => c.label)).size).toBe(question.choices.length);
    }
  }
});

test('区画当ては 8 区画から選び、正解が店の区画', () => {
  for (const question of questions.get('section') ?? []) {
    expect(question.choices).toHaveLength(8);
    const [shop] = quotedNames(question.text);
    const correct = question.choices.find((c) => c.correct)?.section;
    expect(correct).toEqual({ area: shop.area, side: shop.side });
  }
});

test('間にある店: すべて同じ側で、正解だけが A と B の間', () => {
  for (const question of questions.get('between') ?? []) {
    const [a, b] = quotedNames(question.text);
    const [lo, hi] = [Math.min(pos(a), pos(b)), Math.max(pos(a), pos(b))];
    const choices = choiceShops(question);
    expect(choices).toHaveLength(4);
    for (const shop of [b, ...choices]) expect(shop.side).toBe(a.side);
    for (const [i, shop] of choices.entries()) {
      const inside = lo < pos(shop) && pos(shop) < hi;
      expect(inside).toBe(question.choices[i].correct);
    }
  }
});

test('いちばん近い: 正解が本当にいちばんで、同じエリアの反対側を含まない', () => {
  for (const question of questions.get('nearest') ?? []) {
    const correct = correctShop(question);
    const others = choiceShops(question).filter((shop) => shop.id !== correct.id);
    const toStation = question.text.includes('駅に近い');
    expect(others.filter((shop) => sameSection(shop, correct))).toHaveLength(1);
    expect(others.filter((shop) => shop.area !== correct.area)).toHaveLength(2);
    for (const shop of others) {
      expect(toStation ? pos(correct) < pos(shop) : pos(correct) > pos(shop)).toBe(true);
    }
  }
});

test('仲間はずれ: 3 店が同じエリアで、正解だけ違うエリア', () => {
  for (const question of questions.get('oddOne') ?? []) {
    const correct = correctShop(question);
    const others = choiceShops(question).filter((shop) => shop.id !== correct.id);
    expect(new Set(others.map((shop) => shop.area)).size).toBe(1);
    expect(others[0].area).not.toBe(correct.area);
  }
});

test('この区画にない店: 3 店が問題文の区画で、正解だけ別の区画', () => {
  for (const question of questions.get('notInSection') ?? []) {
    const match = question.text.match(/PALM-(\d)の(左|右)側/);
    expect(match).not.toBeNull();
    const area = Number(match?.[1]);
    const side = match?.[2] === '左' ? 'left' : 'right';
    for (const [i, shop] of choiceShops(question).entries()) {
      const inSection = shop.area === area && shop.side === side;
      expect(inSection).toBe(!question.choices[i].correct);
    }
    expect(question.hintShops).toEqual([]);
  }
});

test('ここは何の店？: 正解と同じ区画で並び順の差が 3 以内の店は不正解に出ない', () => {
  for (const question of questions.get('whichShop') ?? []) {
    const correct = correctShop(question);
    expect(question.hintShops).toEqual([correct]);
    for (const shop of choiceShops(question)) {
      if (shop.id === correct.id) continue;
      expect(sameSection(shop, correct) && Math.abs(shop.order - correct.order) <= 3).toBe(false);
    }
  }
});

test('1 プレイの中で問題文の店・正解の店がかぶらない', () => {
  const rng = seeded(7);
  for (let i = 0; i < 300; i++) {
    const ids = makeQuestions(SHOPS, rng).flatMap((question) => question.keyShops.map((shop) => shop.id));
    expect(new Set(ids).size).toBe(ids.length);
  }
});
