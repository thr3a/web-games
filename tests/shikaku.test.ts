import { expect, test } from 'vitest';
import { generatePuzzle, generatePuzzleByDifficulty, partition, stripPartition } from '../src/games/shikaku/generator';
import {
  type Board,
  createBoard,
  DIFFICULTIES,
  isFilled,
  isSolved,
  MAX_CLUE,
  type Puzzle,
  placeRect,
  type Rect,
  rectArea,
  rectAt,
  rectsAdjacent,
  rectsOverlap,
  releaseSelection,
  selectionRect
} from '../src/games/shikaku/model';
import { rateDifficulty } from '../src/games/shikaku/rating';
import { countSolutions, solve } from '../src/games/shikaku/solver';

const seeded = (initial: number) => {
  let seed = initial;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
};

// 4x3 の小さな問題。解は上段の 1x4、左下の 2x2、右下の 2x2 の1通り。
//  4 . . .
//  . . . .
//  4 . . 4
const small: Puzzle = {
  width: 4,
  height: 3,
  clues: [
    { x: 0, y: 0, value: 4 },
    { x: 0, y: 2, value: 4 },
    { x: 3, y: 2, value: 4 }
  ],
  solution: [
    { x: 0, y: 0, w: 4, h: 1 },
    { x: 0, y: 1, w: 2, h: 2 },
    { x: 2, y: 1, w: 2, h: 2 }
  ]
};

const placeAll = (board: Board, rects: Rect[]): Board => rects.reduce((next, rect) => placeRect(next, rect), board);

const coversBoardExactly = (puzzle: Puzzle, rects: Rect[]): boolean => {
  const count = new Uint8Array(puzzle.width * puzzle.height);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        if (x < 0 || y < 0 || x >= puzzle.width || y >= puzzle.height) return false;
        count[y * puzzle.width + x] += 1;
      }
    }
  }
  return count.every((value) => value === 1);
};

// ---- ソルバー ----

test('ソルバー: 2x2 を対角の 2 で分ける問題は解が2通り', () => {
  const clues = [
    { x: 0, y: 0, value: 2 },
    { x: 1, y: 1, value: 2 }
  ];
  const result = solve(2, 2, clues, 10);
  expect(result.count).toBe(2);
});

test('ソルバー: 2x2 を同じ列の 2 で分ける問題は解が1通り', () => {
  const clues = [
    { x: 0, y: 0, value: 2 },
    { x: 0, y: 1, value: 2 }
  ];
  const result = solve(2, 2, clues, 10);
  expect(result.count).toBe(1);
  expect(result.solutions[0]).toEqual([
    { x: 0, y: 0, w: 2, h: 1 },
    { x: 0, y: 1, w: 2, h: 1 }
  ]);
});

test('ソルバー: 手作りの問題の唯一解を見つける', () => {
  const result = solve(small.width, small.height, small.clues, 10);
  expect(result.count).toBe(1);
  expect(result.solutions[0]).toEqual(small.solution);
});

test('ソルバー: 解が多い問題でも上限で打ち切る', () => {
  // 1x2 のドミノを 4 枚並べる 4x2 の盤面。数字の位置しだいで解が複数ある。
  const clues = [
    { x: 0, y: 0, value: 2 },
    { x: 1, y: 1, value: 2 },
    { x: 2, y: 0, value: 2 },
    { x: 3, y: 1, value: 2 }
  ];
  expect(solve(4, 2, clues, 10).count).toBeGreaterThan(2);
  expect(countSolutions(4, 2, clues)).toBe(2);
});

test('ソルバー: 面積の合計が合わない・置けない数字がある問題は解なし', () => {
  expect(countSolutions(2, 2, [{ x: 0, y: 0, value: 3 }])).toBe(0);
  // 4 は 1x4 か 4x1 か 2x2 だが、3x3 では 2x2 しか入らず、もう一方の 5 が長方形にならない。
  expect(
    countSolutions(3, 3, [
      { x: 0, y: 0, value: 4 },
      { x: 2, y: 2, value: 5 }
    ])
  ).toBe(0);
});

// 枝刈りなしの総当たりで分割を数える（ソルバーの検算用）。
const bruteForceCount = (puzzle: Puzzle): number => {
  const { width, height } = puzzle;
  const covered = new Uint8Array(width * height);
  const rects: Rect[] = [];
  const walk = (): number => {
    const cell = covered.indexOf(0);
    if (cell === -1) return isSolved(puzzle, rects) ? 1 : 0;
    const x = cell % width;
    const y = Math.floor(cell / width);
    let total = 0;
    for (let h = 1; y + h <= height; h += 1) {
      for (let w = 1; x + w <= width; w += 1) {
        const rect = { x, y, w, h };
        const cells: number[] = [];
        for (let dy = 0; dy < h; dy += 1) {
          for (let dx = 0; dx < w; dx += 1) cells.push((y + dy) * width + x + dx);
        }
        if (cells.some((c) => covered[c] === 1)) continue;
        for (const c of cells) covered[c] = 1;
        rects.push(rect);
        total += walk();
        rects.pop();
        for (const c of cells) covered[c] = 0;
      }
    }
    return total;
  };
  return walk();
};

test('ソルバー: 小さな盤面で総当たりと解の個数が一致する', () => {
  const rng = seeded(21);
  let checked = 0;
  let ambiguous = 0;
  for (let i = 0; i < 40; i += 1) {
    const rects = partition(4, 4, 6, 1, rng);
    if (!rects) continue;
    checked += 1;
    const clues = rects.map((rect) => ({
      x: rect.x + Math.floor(rng() * rect.w),
      y: rect.y + Math.floor(rng() * rect.h),
      value: rectArea(rect)
    }));
    const puzzle: Puzzle = { width: 4, height: 4, clues, solution: rects };
    const expected = bruteForceCount(puzzle);
    if (expected >= 2) ambiguous += 1;
    expect(solve(4, 4, clues, 1000).count).toBe(expected);
  }
  // 解が複数ある問題も含めて検算できていることを確かめる。
  expect(checked).toBeGreaterThanOrEqual(30);
  expect(ambiguous).toBeGreaterThanOrEqual(5);
});

// ---- 生成 ----

const expectValidPuzzle = (puzzle: Puzzle, width: number, height: number) => {
  expect(puzzle.width).toBe(width);
  expect(puzzle.height).toBe(height);
  expect(puzzle.clues).toHaveLength(puzzle.solution.length);
  expect(coversBoardExactly(puzzle, puzzle.solution)).toBe(true);
  puzzle.solution.forEach((rect, i) => {
    const clue = puzzle.clues[i];
    expect(rectArea(rect)).toBeGreaterThanOrEqual(2);
    expect(clue.value).toBe(rectArea(rect));
    expect(clue.value).toBeLessThanOrEqual(MAX_CLUE);
    expect(clue.x >= rect.x && clue.x < rect.x + rect.w && clue.y >= rect.y && clue.y < rect.y + rect.h).toBe(true);
  });
  expect(puzzle.clues.reduce((sum, clue) => sum + clue.value, 0)).toBe(width * height);
  expect(isSolved(puzzle, puzzle.solution)).toBe(true);
  expect(countSolutions(width, height, puzzle.clues, 2)).toBeGreaterThanOrEqual(1);
};

const expectUniquePuzzle = (puzzle: Puzzle, width: number, height: number) => {
  expectValidPuzzle(puzzle, width, height);
  expect(countSolutions(width, height, puzzle.clues, 2)).toBe(1);
};

test('生成: 初期設定（10x12）の問題はどれも解が1通り', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    expectUniquePuzzle(generatePuzzle({}, seeded(seed)), 10, 12);
  }
});

test('生成: 正方形でない盤面・大きい盤面でも解が1通り', () => {
  expectUniquePuzzle(generatePuzzle({ width: 7, height: 11 }, seeded(3)), 7, 11);
  expectUniquePuzzle(generatePuzzle({ width: 11, height: 5 }, seeded(4)), 11, 5);
  expectUniquePuzzle(generatePuzzle({ width: 15, height: 15 }, seeded(5)), 15, 15);
  expectUniquePuzzle(generatePuzzle({ width: 20, height: 20 }, seeded(6)), 20, 20);
});

test('生成: 小さい盤面・細長い盤面・最大面積が小さい設定でも必ず解ける問題を返す', () => {
  const cases: [number, number, number][] = [
    [2, 1, 12],
    [1, 7, 12],
    [3, 3, 3],
    [5, 7, 2],
    [9, 9, 3],
    [2, 2, 12]
  ];
  for (const [width, height, maxArea] of cases) {
    for (let seed = 1; seed <= 10; seed += 1) {
      expectValidPuzzle(generatePuzzle({ width, height, maxArea }, seeded(seed)), width, height);
    }
  }
});

test('生成: 最大面積 2 は 3 に丸める（奇数マスの盤面も分割できる）', () => {
  const puzzle = generatePuzzle({ width: 5, height: 5, maxArea: 2 }, seeded(10));
  expect(Math.max(...puzzle.clues.map((clue) => clue.value))).toBeLessThanOrEqual(3);
  expectValidPuzzle(puzzle, 5, 5);
});

test('分割（予備）: 帯状の分割は盤面を重なりなく覆い、面積 2〜最大面積に収まる', () => {
  const rng = seeded(11);
  for (const [width, height] of [
    [9, 9],
    [1, 5],
    [2, 1],
    [7, 3]
  ]) {
    const rects = stripPartition(width, height, 3, rng);
    expect(coversBoardExactly({ ...small, width, height }, rects)).toBe(true);
    for (const rect of rects) {
      expect(rectArea(rect)).toBeGreaterThanOrEqual(2);
      expect(rectArea(rect)).toBeLessThanOrEqual(3);
    }
  }
});

test('生成: 最大面積は 12 を超えない（設定で大きくしても丸める）', () => {
  const puzzle = generatePuzzle({ width: 12, height: 12, maxArea: 30 }, seeded(7));
  expect(Math.max(...puzzle.clues.map((clue) => clue.value))).toBeLessThanOrEqual(MAX_CLUE);
});

test('生成: 最大面積を小さくするとそれ以下の長方形だけになる', () => {
  const puzzle = generatePuzzle({ maxArea: 4 }, seeded(8));
  expect(Math.max(...puzzle.clues.map((clue) => clue.value))).toBeLessThanOrEqual(4);
  expectUniquePuzzle(puzzle, 10, 12);
});

test('生成: 同じ乱数なら同じ問題になる', () => {
  expect(generatePuzzle({}, seeded(42))).toEqual(generatePuzzle({}, seeded(42)));
});

test('分割: 盤面を重なりなく覆い、1マスの長方形を作らない', () => {
  const rng = seeded(9);
  let checked = 0;
  for (let i = 0; i < 20; i += 1) {
    const rects = partition(10, 8, 12, 1.5, rng);
    if (!rects) continue;
    checked += 1;
    expect(coversBoardExactly({ ...small, width: 10, height: 8 }, rects)).toBe(true);
    for (const rect of rects) {
      expect(rectArea(rect)).toBeGreaterThanOrEqual(2);
      expect(rectArea(rect)).toBeLessThanOrEqual(12);
    }
  }
  expect(checked).toBeGreaterThanOrEqual(18);
});

// ---- 正誤判定 ----

test('判定: 正解の分割を置くとクリア', () => {
  const board = placeAll(createBoard(small), small.solution);
  expect(board.status).toBe('cleared');
});

test('判定: 正解と違っても条件を満たしていればクリア', () => {
  const puzzle: Puzzle = {
    width: 2,
    height: 2,
    clues: [
      { x: 0, y: 0, value: 2 },
      { x: 1, y: 1, value: 2 }
    ],
    solution: [
      { x: 0, y: 0, w: 2, h: 1 },
      { x: 0, y: 1, w: 2, h: 1 }
    ]
  };
  const board = placeAll(createBoard(puzzle), [
    { x: 0, y: 0, w: 1, h: 2 },
    { x: 1, y: 0, w: 1, h: 2 }
  ]);
  expect(board.status).toBe('cleared');
});

test('判定: 全マス埋まっていないとクリアにならない', () => {
  const board = placeAll(createBoard(small), small.solution.slice(0, 2));
  expect(isFilled(small, board.rects)).toBe(false);
  expect(board.status).toBe('playing');
});

test('判定: 全マス埋まっても面積が数字と違えばクリアにならない', () => {
  // 上段 1x4 はそのまま、下2段を 1x2 と 3x2 に分ける（面積 2 と 6 で数字 4 と合わない）。
  const rects = [
    { x: 0, y: 0, w: 4, h: 1 },
    { x: 0, y: 1, w: 1, h: 2 },
    { x: 1, y: 1, w: 3, h: 2 }
  ];
  const board = placeAll(createBoard(small), rects);
  expect(isFilled(small, board.rects)).toBe(true);
  expect(board.status).toBe('playing');
});

test('判定: 数字を含まない・2つ含む四角があるとクリアにならない', () => {
  // 上段を 2 段使った 4x2 は数字 4 を 2 つ含み、下段 1x4 も数字を 2 つ含む。
  expect(
    isSolved(small, [
      { x: 0, y: 0, w: 4, h: 2 },
      { x: 0, y: 2, w: 4, h: 1 }
    ])
  ).toBe(false);
  // 数字を含まない四角がある。
  expect(
    isSolved(small, [
      { x: 0, y: 0, w: 1, h: 3 },
      { x: 1, y: 0, w: 2, h: 3 },
      { x: 3, y: 0, w: 1, h: 3 }
    ])
  ).toBe(false);
});

test('判定: 全マス埋まって条件違反のあとも続けられ、直せばクリアになる', () => {
  let board = placeAll(createBoard(small), [
    { x: 0, y: 0, w: 4, h: 1 },
    { x: 0, y: 1, w: 1, h: 2 },
    { x: 1, y: 1, w: 3, h: 2 }
  ]);
  expect(board.status).toBe('playing');
  board = placeRect(board, { x: 0, y: 1, w: 2, h: 2 });
  expect(board.status).toBe('playing');
  board = placeRect(board, { x: 2, y: 1, w: 2, h: 2 });
  expect(board.status).toBe('cleared');
});

// ---- 四角の配置・置き換え・削除 ----

test('選択範囲: ドラッグの向きによらず長方形になり、盤面の外は盤面内に収める', () => {
  expect(selectionRect(small, { x: 3, y: 2 }, { x: 1, y: 0 })).toEqual({ x: 1, y: 0, w: 3, h: 3 });
  expect(selectionRect(small, { x: 1, y: 1 }, { x: 10, y: -5 })).toEqual({ x: 1, y: 0, w: 3, h: 2 });
  expect(selectionRect(small, { x: -1.5, y: 2.7 }, { x: 0.2, y: 99 })).toEqual({ x: 0, y: 2, w: 1, h: 1 });
});

test('配置: 条件に合わない四角も置ける', () => {
  const board = releaseSelection(createBoard(small), { x: 1, y: 0 }, { x: 2, y: 1 });
  expect(board.rects).toHaveLength(1);
  expect(board.rects[0]).toMatchObject({ x: 1, y: 0, w: 2, h: 2 });
});

test('配置: 何もないマスのタップ（1マスの選択）では何も起きない', () => {
  const board = createBoard(small);
  expect(releaseSelection(board, { x: 2, y: 1 }, { x: 2, y: 1 })).toBe(board);
});

test('配置: 置いた四角をタップすると消える', () => {
  let board = releaseSelection(createBoard(small), { x: 0, y: 1 }, { x: 1, y: 2 });
  board = releaseSelection(board, { x: 3, y: 0 }, { x: 3, y: 2 });
  expect(board.rects).toHaveLength(2);
  board = releaseSelection(board, { x: 1, y: 1 }, { x: 1, y: 1 });
  expect(board.rects).toHaveLength(1);
  expect(board.rects[0]).toMatchObject({ x: 3, y: 0, w: 1, h: 3 });
  expect(rectAt(board, { x: 1, y: 1 })).toBeUndefined();
});

test('配置: 重なった既存の四角はすべて消えて新しい四角に置き換わる', () => {
  let board = placeAll(createBoard(small), [
    { x: 0, y: 0, w: 2, h: 1 },
    { x: 2, y: 0, w: 2, h: 1 },
    { x: 0, y: 2, w: 4, h: 1 }
  ]);
  expect(board.rects).toHaveLength(3);
  // 上段の 2 つにまたがる四角を置くと、その 2 つだけ消える。
  board = releaseSelection(board, { x: 1, y: 0 }, { x: 2, y: 1 });
  expect(board.rects).toHaveLength(2);
  expect(board.rects.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([
    { x: 0, y: 2, w: 4, h: 1 },
    { x: 1, y: 0, w: 2, h: 2 }
  ]);
  for (const a of board.rects) {
    for (const b of board.rects) {
      if (a !== b) expect(rectsOverlap(a, b)).toBe(false);
    }
  }
});

test('配置: 同じ範囲に置き直すと前の四角は消えて1つだけ残る', () => {
  let board = releaseSelection(createBoard(small), { x: 0, y: 0 }, { x: 3, y: 0 });
  board = releaseSelection(board, { x: 3, y: 0 }, { x: 0, y: 0 });
  expect(board.rects).toHaveLength(1);
  expect(board.rects[0].id).toBe(2);
});

test('配置: クリア後は置く・消すができない', () => {
  const board = placeAll(createBoard(small), small.solution);
  expect(board.status).toBe('cleared');
  expect(releaseSelection(board, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(board);
  expect(releaseSelection(board, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(board);
});

test('色: 隣り合う四角には違う色を付ける', () => {
  const puzzle = generatePuzzle({}, seeded(11));
  const rng = seeded(12);
  const board = puzzle.solution.reduce((next, rect) => placeRect(next, rect, rng), createBoard(puzzle));
  expect(board.status).toBe('cleared');
  for (const a of board.rects) {
    for (const b of board.rects) {
      if (a !== b && rectsAdjacent(a, b)) expect(a.color).not.toBe(b.color);
    }
  }
});

test('難易度判定: 置き方が1通りの数字だけで解ける問題は段階 1', () => {
  expect(rateDifficulty(small.width, small.height, small.clues)).toBe(1);
});

test('難易度判定: 解が2通りある問題は段階 4', () => {
  // 2x2 に 2 が2つ（縦2本でも横2本でも解ける）。
  const clues = [
    { x: 0, y: 0, value: 2 },
    { x: 1, y: 1, value: 2 }
  ];
  expect(countSolutions(2, 2, clues, 2)).toBe(2);
  expect(rateDifficulty(2, 2, clues)).toBe(4);
});

test('難易度指定の生成: 選んだ難易度の段階になり、解は1通り', () => {
  for (const size of [
    { width: 9, height: 9 },
    { width: 10, height: 12 }
  ]) {
    for (const option of DIFFICULTIES) {
      for (let seed = 1; seed <= 3; seed += 1) {
        const puzzle = generatePuzzleByDifficulty(size, option.value, seeded(seed));
        expectUniquePuzzle(puzzle, size.width, size.height);
        expect(rateDifficulty(size.width, size.height, puzzle.clues)).toBe(option.level);
      }
    }
  }
});

test('難易度指定の生成: 狙った段階が出ない盤面でも必ず解ける問題を返す', () => {
  // 2x1 は段階 1 の問題しか作れない。
  const puzzle = generatePuzzleByDifficulty({ width: 2, height: 1 }, 'hard', seeded(1));
  expectValidPuzzle(puzzle, 2, 1);
});
