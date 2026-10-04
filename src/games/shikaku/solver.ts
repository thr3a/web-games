import type { Clue, Rect } from './model';

export type SolveResult = {
  // 見つけた解の個数（limit で打ち切る）
  count: number;
  // 見つけた解。solutions[k][i] は clues[i] を含む長方形。
  solutions: Rect[][];
};

type Candidate = { clue: number; rect: Rect; cells: number[] };

// 数字ごとに、その数字だけを含み面積が一致する長方形をすべて列挙する。
const listCandidates = (width: number, height: number, clues: Clue[]): Candidate[][] => {
  const clueAt = new Int32Array(width * height).fill(-1);
  clues.forEach((clue, index) => {
    clueAt[clue.y * width + clue.x] = index;
  });

  return clues.map((clue, index) => {
    const result: Candidate[] = [];
    for (let w = 1; w <= Math.min(width, clue.value); w += 1) {
      if (clue.value % w !== 0) continue;
      const h = clue.value / w;
      if (h > height) continue;
      for (let y = Math.max(0, clue.y - h + 1); y <= Math.min(clue.y, height - h); y += 1) {
        for (let x = Math.max(0, clue.x - w + 1); x <= Math.min(clue.x, width - w); x += 1) {
          const cells: number[] = [];
          let ok = true;
          for (let dy = 0; dy < h && ok; dy += 1) {
            for (let dx = 0; dx < w; dx += 1) {
              const cell = (y + dy) * width + x + dx;
              const other = clueAt[cell];
              if (other !== -1 && other !== index) {
                ok = false;
                break;
              }
              cells.push(cell);
            }
          }
          if (ok) result.push({ clue: index, rect: { x, y, w, h }, cells });
        }
      }
    }
    return result;
  });
};

// 解を limit 個まで数える。
// 毎回「置ける候補が最も少ない数字」か「覆える候補が最も少ない空きマス」を選び、その候補を順に試すバックトラック。
// 候補が 0 の数字やマスがあれば行き詰まりとして戻る。候補が 1 つなら実質的に確定する。
export const solve = (width: number, height: number, clues: Clue[], limit = 2): SolveResult => {
  const solutions: Rect[][] = [];
  const total = clues.reduce((sum, clue) => sum + clue.value, 0);
  if (total !== width * height) return { count: 0, solutions };

  const candidates = listCandidates(width, height, clues);
  if (candidates.some((list) => list.length === 0)) return { count: 0, solutions };

  const candidatesByCell: Candidate[][] = Array.from({ length: width * height }, () => []);
  for (const list of candidates) {
    for (const candidate of list) {
      for (const cell of candidate.cells) candidatesByCell[cell].push(candidate);
    }
  }

  const covered = new Uint8Array(width * height);
  const coverCount = new Int32Array(width * height);
  const placed: (Rect | null)[] = clues.map(() => null);
  let placedCount = 0;

  const isOpen = (candidate: Candidate): boolean =>
    placed[candidate.clue] === null && candidate.cells.every((cell) => covered[cell] === 0);

  // 次に試す候補の一覧。行き詰まっていれば null。
  const nextChoices = (): Candidate[] | null => {
    let best: Candidate[] | null = null;
    coverCount.fill(0);
    for (let index = 0; index < clues.length; index += 1) {
      if (placed[index] !== null) continue;
      const open = candidates[index].filter(isOpen);
      if (open.length === 0) return null;
      for (const candidate of open) {
        for (const cell of candidate.cells) coverCount[cell] += 1;
      }
      if (!best || open.length < best.length) best = open;
    }
    let bestCell = -1;
    for (let cell = 0; cell < covered.length; cell += 1) {
      if (covered[cell] === 1) continue;
      if (coverCount[cell] === 0) return null;
      if (best && coverCount[cell] < best.length && (bestCell === -1 || coverCount[cell] < coverCount[bestCell])) {
        bestCell = cell;
      }
    }
    if (bestCell !== -1) return candidatesByCell[bestCell].filter(isOpen);
    return best;
  };

  const search = () => {
    if (placedCount === clues.length) {
      solutions.push(placed.map((rect) => rect ?? { x: 0, y: 0, w: 0, h: 0 }));
      return;
    }
    const choices = nextChoices();
    if (!choices) return;
    for (const candidate of choices) {
      if (solutions.length >= limit) return;
      for (const cell of candidate.cells) covered[cell] = 1;
      placed[candidate.clue] = candidate.rect;
      placedCount += 1;
      search();
      placedCount -= 1;
      placed[candidate.clue] = null;
      for (const cell of candidate.cells) covered[cell] = 0;
    }
  };

  search();
  return { count: solutions.length, solutions };
};

export const countSolutions = (width: number, height: number, clues: Clue[], limit = 2): number =>
  solve(width, height, clues, limit).count;
