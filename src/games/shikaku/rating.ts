import type { Clue } from './model';
import { type Candidate, listCandidates } from './solver';

// 人間の解き方を真似た段階的な推論で問題を解き、必要だった最も高い段階を返す。
// 1: 置き方が1通りの数字を確定する／1つの置き方しか届かないマスを確定する
// 2: 数字のどの置き方にも含まれるマスを他の数字から外す／1つの数字しか届かないマスを含まない置き方を外す
// 3: 置き方を1つ仮置きし、段階 1・2 だけで矛盾が出たらその置き方を外す
// 4: 段階 3 までで解けない（深い仮定が必要、または解が1通りでない）
export type DifficultyLevel = 1 | 2 | 3 | 4;

// alive[j]: 置き方 j がまだ候補に残っているか。placed[k]: 数字 k に確定した置き方（未確定は -1）。
type State = { alive: Uint8Array; placed: Int32Array };

export const rateDifficulty = (width: number, height: number, clues: Clue[]): DifficultyLevel => {
  const cands: Candidate[] = listCandidates(width, height, clues).flat();
  const byClue: number[][] = clues.map(() => []);
  const byCell: number[][] = Array.from({ length: width * height }, () => []);
  cands.forEach((cand, j) => {
    byClue[cand.clue].push(j);
    for (const cell of cand.cells) byCell[cell].push(j);
  });

  const aliveOf = (s: State, list: number[]): number[] => list.filter((j) => s.alive[j] === 1);

  // 置き方 j を確定し、同じ数字の他の置き方と、重なる他の数字の置き方を外す。
  const place = (s: State, j: number) => {
    const cand = cands[j];
    s.placed[cand.clue] = j;
    for (const other of byClue[cand.clue]) if (other !== j) s.alive[other] = 0;
    for (const cell of cand.cells) {
      for (const other of byCell[cell]) if (cands[other].clue !== cand.clue) s.alive[other] = 0;
    }
  };

  const hasContradiction = (s: State): boolean => {
    for (let k = 0; k < clues.length; k += 1) {
      if (s.placed[k] < 0 && aliveOf(s, byClue[k]).length === 0) return true;
    }
    return byCell.some((list) => aliveOf(s, list).length === 0);
  };

  const isSolved = (s: State): boolean => s.placed.every((j) => j >= 0);

  const stepLevel1 = (s: State): boolean => {
    let progress = false;
    for (let k = 0; k < clues.length; k += 1) {
      if (s.placed[k] >= 0) continue;
      const alive = aliveOf(s, byClue[k]);
      if (alive.length !== 1) continue;
      place(s, alive[0]);
      progress = true;
    }
    for (const list of byCell) {
      const alive = aliveOf(s, list);
      if (alive.length !== 1 || s.placed[cands[alive[0]].clue] >= 0) continue;
      place(s, alive[0]);
      progress = true;
    }
    return progress;
  };

  const stepLevel2 = (s: State): boolean => {
    let progress = false;
    for (let k = 0; k < clues.length; k += 1) {
      if (s.placed[k] >= 0) continue;
      const alive = aliveOf(s, byClue[k]);
      if (alive.length === 0) continue;
      const counts = new Map<number, number>();
      for (const j of alive) for (const cell of cands[j].cells) counts.set(cell, (counts.get(cell) ?? 0) + 1);
      for (const [cell, count] of counts) {
        if (count !== alive.length) continue;
        for (const j of byCell[cell]) {
          if (s.alive[j] === 0 || cands[j].clue === k) continue;
          s.alive[j] = 0;
          progress = true;
        }
      }
    }
    byCell.forEach((list, cell) => {
      const alive = aliveOf(s, list);
      if (alive.length === 0) return;
      const k = cands[alive[0]].clue;
      if (s.placed[k] >= 0 || !alive.every((j) => cands[j].clue === k)) return;
      for (const j of byClue[k]) {
        if (s.alive[j] === 0 || cands[j].cells.includes(cell)) continue;
        s.alive[j] = 0;
        progress = true;
      }
    });
    return progress;
  };

  // 段階 1・2 で進められるところまで進める。矛盾が出たら true。
  const propagate = (s: State): boolean => {
    for (;;) {
      if (hasContradiction(s)) return true;
      if (stepLevel1(s) || stepLevel2(s)) continue;
      return false;
    }
  };

  // 1つ外せたら、低い段階からやり直すためにすぐ戻る。
  const stepLevel3 = (s: State): boolean => {
    for (let j = 0; j < cands.length; j += 1) {
      if (s.alive[j] === 0 || s.placed[cands[j].clue] >= 0) continue;
      const trial: State = { alive: s.alive.slice(), placed: s.placed.slice() };
      place(trial, j);
      if (!propagate(trial)) continue;
      s.alive[j] = 0;
      return true;
    }
    return false;
  };

  const state: State = { alive: new Uint8Array(cands.length).fill(1), placed: new Int32Array(clues.length).fill(-1) };
  let level: DifficultyLevel = 1;
  while (!isSolved(state)) {
    if (hasContradiction(state)) return 4;
    if (stepLevel1(state)) continue;
    if (stepLevel2(state)) {
      if (level < 2) level = 2;
      continue;
    }
    if (stepLevel3(state)) {
      level = 3;
      continue;
    }
    return 4;
  }
  return level;
};
