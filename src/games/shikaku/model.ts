// 盤面の座標は左上が (0, 0)。x は右が正、y は下が正。
export type Cell = { x: number; y: number };

export type Rect = { x: number; y: number; w: number; h: number };

export type Clue = Cell & { value: number };

// clues[i] は solution[i] の中にある数字。生成時の正解は判定には使わない。
export type Puzzle = {
  width: number;
  height: number;
  clues: Clue[];
  solution: Rect[];
};

export type PlacedRect = Rect & { id: number; color: number };

export type BoardStatus = 'playing' | 'cleared';

export type Board = {
  puzzle: Puzzle;
  rects: PlacedRect[];
  nextId: number;
  status: BoardStatus;
};

export type ShikakuConfig = {
  width: number;
  height: number;
  // 長方形の最大面積（= 数字の最大値）。MAX_CLUE を超える値は MAX_CLUE に丸める。
  maxArea: number;
  // 大きい長方形の出やすさ。面積 a の重みを a ** sizeBias にする（0 なら面積ごとに均等）。
  sizeBias: number;
};

export const MAX_CLUE = 12;
export const MIN_AREA = 2;

export const DEFAULT_CONFIG: ShikakuConfig = {
  width: 10,
  height: 12,
  maxArea: 12,
  sizeBias: 1.5
};

// 最初の画面で選べる盤面サイズ。幅と高さ以外は DEFAULT_CONFIG を使う。
export const BOARD_SIZES: { width: number; height: number }[] = [
  { width: 9, height: 9 },
  { width: 10, height: 12 }
];

export type Difficulty = 'easy' | 'normal' | 'hard';

// 最初の画面で選べる難易度。level は rateDifficulty の段階で、この段階の推論がちょうど必要な問題を出す。
export const DIFFICULTIES: { value: Difficulty; label: string; level: 1 | 2 | 3 }[] = [
  { value: 'easy', label: 'かんたん', level: 1 },
  { value: 'normal', label: 'ふつう', level: 2 },
  { value: 'hard', label: 'むずかしい', level: 3 }
];

// 置いた四角の色（参考画像のテイストに合わせた落ち着いたパステル系）。fill が面、shade が下側の厚み。
export const RECT_COLORS = [
  { fill: '#d5c87f', shade: '#bfae5a' },
  { fill: '#b986aa', shade: '#a0668f' },
  { fill: '#a89a8e', shade: '#8d7d70' },
  { fill: '#81977f', shade: '#667c64' },
  { fill: '#d6878a', shade: '#bc666a' },
  { fill: '#8aa8d0', shade: '#6a8bb8' },
  { fill: '#d9a476', shade: '#bf8655' },
  { fill: '#8fbcb5', shade: '#6ea098' }
];

export const rectArea = (rect: Rect): number => rect.w * rect.h;

export const rectContains = (rect: Rect, cell: Cell): boolean =>
  cell.x >= rect.x && cell.x < rect.x + rect.w && cell.y >= rect.y && cell.y < rect.y + rect.h;

export const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

// 辺を共有している（角だけで接しているのは含まない）。
export const rectsAdjacent = (a: Rect, b: Rect): boolean => {
  const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
  const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
  const touchX = a.x + a.w === b.x || b.x + b.w === a.x;
  const touchY = a.y + a.h === b.y || b.y + b.h === a.y;
  return (touchX && overlapY) || (touchY && overlapX);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const clampCell = (puzzle: Puzzle, cell: Cell): Cell => ({
  x: clamp(Math.floor(cell.x), 0, puzzle.width - 1),
  y: clamp(Math.floor(cell.y), 0, puzzle.height - 1)
});

// ドラッグの始点と現在位置から、盤面内に収めた長方形を作る。
export const selectionRect = (puzzle: Puzzle, from: Cell, to: Cell): Rect => {
  const a = clampCell(puzzle, from);
  const b = clampCell(puzzle, to);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
};

export const createBoard = (puzzle: Puzzle): Board => ({ puzzle, rects: [], nextId: 1, status: 'playing' });

export const rectAt = (board: Board, cell: Cell): PlacedRect | undefined =>
  board.rects.find((rect) => rectContains(rect, cell));

// 隣の四角と同じ色を避けて選ぶ。全色が隣で使われていたら、使われている数が最も少ない色から選ぶ。
const pickColor = (rects: PlacedRect[], rect: Rect, rng: () => number): number => {
  const counts = RECT_COLORS.map(() => 0);
  for (const other of rects) {
    if (rectsAdjacent(other, rect)) counts[other.color] += 1;
  }
  const least = Math.min(...counts);
  const choices = counts.flatMap((count, color) => (count === least ? [color] : []));
  return choices[Math.floor(rng() * choices.length)];
};

// 盤面のすべてのマスが四角で埋まっているか（四角同士は重ならない前提）。
export const isFilled = (puzzle: Puzzle, rects: Rect[]): boolean =>
  rects.reduce((sum, rect) => sum + rectArea(rect), 0) === puzzle.width * puzzle.height;

// ルールを満たしているか。生成時の正解とは比べない。
export const isSolved = (puzzle: Puzzle, rects: Rect[]): boolean => {
  if (!isFilled(puzzle, rects)) return false;
  return rects.every((rect) => {
    const inside = puzzle.clues.filter((clue) => rectContains(rect, clue));
    return inside.length === 1 && inside[0].value === rectArea(rect);
  });
};

// 四角を置く。重なった既存の四角はすべて消す。1マスの四角は置かない。
export const placeRect = (board: Board, rect: Rect, rng: () => number = Math.random): Board => {
  if (board.status !== 'playing') return board;
  if (rectArea(rect) < MIN_AREA) return board;
  const kept = board.rects.filter((other) => !rectsOverlap(other, rect));
  const placed: PlacedRect = { ...rect, id: board.nextId, color: pickColor(kept, rect, rng) };
  const rects = [...kept, placed];
  const status: BoardStatus = isSolved(board.puzzle, rects) ? 'cleared' : 'playing';
  return { ...board, rects, nextId: board.nextId + 1, status };
};

export const removeRectAt = (board: Board, cell: Cell): Board => {
  if (board.status !== 'playing') return board;
  const target = rectAt(board, cell);
  if (!target) return board;
  return { ...board, rects: board.rects.filter((rect) => rect.id !== target.id) };
};

// 指を離したときの処理。始点と終点が同じマスならタップとして四角を消し、それ以外は四角を置く。
export const releaseSelection = (board: Board, from: Cell, to: Cell, rng: () => number = Math.random): Board => {
  const rect = selectionRect(board.puzzle, from, to);
  if (rectArea(rect) === 1) return removeRectAt(board, rect);
  return placeRect(board, rect, rng);
};
