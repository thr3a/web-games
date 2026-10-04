import {
  type Clue,
  DEFAULT_CONFIG,
  DIFFICULTIES,
  type Difficulty,
  MAX_CLUE,
  MIN_AREA,
  type Puzzle,
  type Rect,
  type ShikakuConfig,
  sameRect
} from './model';
import { rateDifficulty } from './rating';
import { solve } from './solver';

// 数字の位置を選び直す回数。超えたら別解があるまま採用する。
const MAX_REPAIR_ROUNDS = 30;
const MAX_PARTITION_ATTEMPTS = 1000;
// 難易度に合う問題を探して生成する回数。むずかしい（約 3〜5%）でも外れる確率はごく小さい。
const MAX_DIFFICULTY_ATTEMPTS = 300;
// maxArea の下限。
const MIN_MAX_AREA = 3;
// 分割中、この大きさ以下の閉じた空き領域は長方形で埋められるかを確かめる。
const SMALL_REGION = 8;

const randomInt = (rng: () => number, n: number): number => Math.floor(rng() * n);

const pickWeighted = <T>(items: T[], weights: number[], rng: () => number): T => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
};

// 重みに従ってランダムな順に並べる（重みが大きいものほど前に来やすい）。
const weightedShuffle = <T>(items: T[], weights: number[], rng: () => number): T[] => {
  const restItems = [...items];
  const restWeights = [...weights];
  const result: T[] = [];
  while (restItems.length > 0) {
    const item = pickWeighted(restItems, restWeights, rng);
    const index = restItems.indexOf(item);
    result.push(item);
    restItems.splice(index, 1);
    restWeights.splice(index, 1);
  }
  return result;
};

// 盤面をランダムに長方形へ分割する。行き詰まったら null。
// 行優先で最初の空きマスを左上とする長方形を置いていき、置けなくなったら1つ前に戻って別の形を試す。
export const partition = (
  width: number,
  height: number,
  maxArea: number,
  sizeBias: number,
  rng: () => number,
  maxSteps = 5000
): Rect[] | null => {
  const covered = new Uint8Array(width * height);
  const isFreeAt = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height && covered[y * width + x] === 0;
  const fill = (rect: Rect, value: number) => {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) covered[y * width + x] = value;
    }
  };
  // 閉じた小さな空き領域が、面積 2 以上の長方形で埋められるか（L 字の 3 マスや T 字の 4 マスは埋められない）。
  const canTile = (cells: Set<number>): boolean => {
    if (cells.size === 0) return true;
    const first = Math.min(...cells);
    const x = first % width;
    const y = Math.floor(first / width);
    for (let h = 1; h <= cells.size; h += 1) {
      for (let w = 1; w * h <= Math.min(cells.size, maxArea); w += 1) {
        if (w * h < MIN_AREA) continue;
        const rectCells: number[] = [];
        for (let dy = 0; dy < h; dy += 1) {
          for (let dx = 0; dx < w; dx += 1) {
            if (x + dx < width) rectCells.push((y + dy) * width + x + dx);
          }
        }
        if (rectCells.length !== w * h || !rectCells.every((cell) => cells.has(cell))) continue;
        const rest = new Set(cells);
        for (const cell of rectCells) rest.delete(cell);
        if (canTile(rest)) return true;
      }
    }
    return false;
  };
  // (x, y) を含む空き領域を調べる。SMALL_REGION マス以下で閉じていて、長方形で埋められなければ true。
  const isDeadRegion = (x: number, y: number, seen: Set<number>): boolean => {
    if (!isFreeAt(x, y) || seen.has(y * width + x)) return false;
    const region = new Set<number>([y * width + x]);
    const stack = [y * width + x];
    while (stack.length > 0 && region.size <= SMALL_REGION) {
      const cell = stack.pop() ?? 0;
      const cx = cell % width;
      const cy = Math.floor(cell / width);
      for (const [nx, ny] of [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1]
      ]) {
        const next = ny * width + nx;
        if (!isFreeAt(nx, ny) || region.has(next)) continue;
        region.add(next);
        stack.push(next);
      }
    }
    for (const cell of region) seen.add(cell);
    if (region.size > SMALL_REGION) return false;
    return !canTile(region);
  };
  // 長方形を置くと、周りに埋められない空き領域ができるか。
  const makesDeadRegion = (rect: Rect): boolean => {
    fill(rect, 1);
    const seen = new Set<number>();
    let found = false;
    for (let y = rect.y - 1; y <= rect.y + rect.h && !found; y += 1) {
      for (let x = rect.x - 1; x <= rect.x + rect.w && !found; x += 1) found = isDeadRegion(x, y, seen);
    }
    fill(rect, 0);
    return found;
  };

  // (x, y) を左上とする置ける形を、面積の重みを付けたランダムな順で返す。
  const shapesAt = (x: number, y: number): Rect[] => {
    const shapes: Rect[] = [];
    // 左上から右へ空いている幅を、下の行ほど狭めていく。
    let freeWidth = 0;
    while (isFreeAt(x + freeWidth, y) && freeWidth < maxArea) freeWidth += 1;
    for (let h = 1; h <= maxArea && y + h <= height; h += 1) {
      let rowWidth = 0;
      while (rowWidth < freeWidth && isFreeAt(x + rowWidth, y + h - 1)) rowWidth += 1;
      freeWidth = rowWidth;
      if (freeWidth === 0) break;
      for (let w = 1; w <= freeWidth && w * h <= maxArea; w += 1) {
        if (w * h >= MIN_AREA) shapes.push({ x, y, w, h });
      }
    }
    const valid = shapes.filter((shape) => !makesDeadRegion(shape));
    // 面積ごとの出やすさを a ** sizeBias にし、同じ面積の形どうしは均等にする。
    const shapesPerArea = new Map<number, number>();
    for (const shape of valid) shapesPerArea.set(shape.w * shape.h, (shapesPerArea.get(shape.w * shape.h) ?? 0) + 1);
    const weights = valid.map((shape) => {
      const area = shape.w * shape.h;
      return area ** sizeBias / (shapesPerArea.get(area) ?? 1);
    });
    return weightedShuffle(valid, weights, rng);
  };

  const rects: Rect[] = [];
  let steps = 0;
  const place = (start: number): boolean => {
    let cell = start;
    while (cell < covered.length && covered[cell] === 1) cell += 1;
    if (cell === covered.length) return true;
    for (const rect of shapesAt(cell % width, Math.floor(cell / width))) {
      steps += 1;
      if (steps > maxSteps) return false;
      fill(rect, 1);
      rects.push(rect);
      if (place(cell + 1)) return true;
      rects.pop();
      fill(rect, 0);
    }
    return false;
  };

  return place(0) ? rects : null;
};

const randomCellIn = (rect: Rect, rng: () => number): { x: number; y: number } => ({
  x: rect.x + randomInt(rng, rect.w),
  y: rect.y + randomInt(rng, rect.h)
});

const clueFor = (rect: Rect, rng: () => number): Clue => ({ ...randomCellIn(rect, rng), value: rect.w * rect.h });

// 帯状に切るだけの単純な分割。ランダムな分割が行き詰まったときの予備で、必ず成功する。
// 長さ n (>= 2) の列を、長さ 2〜maxArea (>= 3) の区間に分ける。残りが 1 にならないように長さを選ぶ。
const splitLine = (n: number, maxArea: number, rng: () => number): number[] => {
  const lengths: number[] = [];
  let rest = n;
  while (rest > 0) {
    const choices: number[] = [];
    for (let len = MIN_AREA; len <= Math.min(maxArea, rest); len += 1) {
      if (rest - len !== 1) choices.push(len);
    }
    const len = choices[randomInt(rng, choices.length)];
    lengths.push(len);
    rest -= len;
  }
  return lengths;
};

export const stripPartition = (width: number, height: number, maxArea: number, rng: () => number): Rect[] => {
  const rects: Rect[] = [];
  // 幅が 1 の盤面だけは縦に切る。
  if (width === 1) {
    let y = 0;
    for (const h of splitLine(height, maxArea, rng)) {
      rects.push({ x: 0, y, w: 1, h });
      y += h;
    }
    return rects;
  }
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    for (const w of splitLine(width, maxArea, rng)) {
      rects.push({ x, y, w, h: 1 });
      x += w;
    }
  }
  return rects;
};

const randomPartition = (
  width: number,
  height: number,
  maxArea: number,
  sizeBias: number,
  rng: () => number
): Rect[] => {
  for (let attempt = 0; attempt < MAX_PARTITION_ATTEMPTS; attempt += 1) {
    const rects = partition(width, height, maxArea, sizeBias, rng);
    if (rects) return rects;
  }
  return stripPartition(width, height, maxArea, rng);
};

// 問題を作る。数字は分割した長方形から置くので、必ず解ける（生成時の分割が1つの解になる）。
// 解はなるべく1通りにする。別解が見つかったら、別解と食い違う長方形だけ数字の位置を選び直す
// （盤面全体を選び直すより収束が速い）。一定回数で1通りにならなければ、別解があるまま採用する。
export const generatePuzzle = (config: Partial<ShikakuConfig> = {}, rng: () => number = Math.random): Puzzle => {
  const { width, height, sizeBias, ...rest } = { ...DEFAULT_CONFIG, ...config };
  // 2 だと奇数マスの盤面を分割できないので、最小を 3 にする。
  const maxArea = Math.max(MIN_MAX_AREA, Math.min(MAX_CLUE, rest.maxArea));
  if (width * height < MIN_AREA) throw new Error(`盤面が小さすぎます: ${width}x${height}`);

  const solution = randomPartition(width, height, maxArea, sizeBias, rng);
  const clues = solution.map((rect) => clueFor(rect, rng));
  for (let round = 0; round < MAX_REPAIR_ROUNDS; round += 1) {
    const result = solve(width, height, clues, 2);
    if (result.count <= 1) break;
    const other = result.solutions.find((found) => found.some((rect, i) => !sameRect(rect, solution[i])));
    if (!other) break;
    solution.forEach((rect, i) => {
      if (!sameRect(rect, other[i])) clues[i] = clueFor(rect, rng);
    });
  }
  return { width, height, clues, solution };
};

// 難易度に合う問題を作る。問題を生成して段階を測り、狙った段階になるまで作り直す。
// 一定回数で見つからなければ、それまでで最も近い段階の問題を返す（段階 4 は別解がある可能性が高いので最後の手段）。
export const generatePuzzleByDifficulty = (
  config: Partial<ShikakuConfig>,
  difficulty: Difficulty,
  rng: () => number = Math.random
): Puzzle => {
  const target = DIFFICULTIES.find((option) => option.value === difficulty)?.level ?? 2;
  const distance = (level: number): number => (level === 4 ? Number.POSITIVE_INFINITY : Math.abs(level - target));
  let best: { puzzle: Puzzle; distance: number } | null = null;
  for (let attempt = 0; attempt < MAX_DIFFICULTY_ATTEMPTS; attempt += 1) {
    const puzzle = generatePuzzle(config, rng);
    const level = rateDifficulty(puzzle.width, puzzle.height, puzzle.clues);
    if (level === target) return puzzle;
    if (!best || distance(level) < best.distance) best = { puzzle, distance: distance(level) };
  }
  return best ? best.puzzle : generatePuzzle(config, rng);
};
