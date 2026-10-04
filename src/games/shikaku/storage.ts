import { BOARD_SIZES, type Board, DIFFICULTIES, type Difficulty, RECT_COLORS } from './model';

const STORAGE_KEY = 'shikaku-save-v1';

export type SavedSettings = { size: { width: number; height: number }; difficulty: Difficulty };

export type SavedGame = { settings: SavedSettings; board: Board };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isRectIn = (value: unknown, width: number, height: number): boolean => {
  if (!isRecord(value)) return false;
  const { x, y, w, h } = value;
  if (!isInt(x, 0, width - 1) || !isInt(y, 0, height - 1)) return false;
  return isInt(w, 1, width - x) && isInt(h, 1, height - y);
};

const isBoard = (value: unknown, width: number, height: number): value is Board => {
  if (!isRecord(value)) return false;
  const { puzzle, rects, nextId, status } = value;
  if (status !== 'playing' || !isInt(nextId, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (!isRecord(puzzle) || puzzle.width !== width || puzzle.height !== height) return false;
  const { clues, solution } = puzzle;
  if (!Array.isArray(clues) || !Array.isArray(solution) || !Array.isArray(rects)) return false;
  const cluesValid = clues.every(
    (clue) =>
      isRecord(clue) &&
      isInt(clue.x, 0, width - 1) &&
      isInt(clue.y, 0, height - 1) &&
      isInt(clue.value, 1, width * height)
  );
  const solutionValid = solution.every((rect) => isRectIn(rect, width, height));
  const rectsValid = rects.every(
    (rect) =>
      isRectIn(rect, width, height) &&
      isRecord(rect) &&
      isInt(rect.id, 0, Number.MAX_SAFE_INTEGER) &&
      isInt(rect.color, 0, RECT_COLORS.length - 1)
  );
  return cluesValid && solutionValid && rectsValid && clues.length === solution.length;
};

const findDifficulty = (value: unknown): Difficulty | null =>
  DIFFICULTIES.find((option) => option.value === value)?.value ?? null;

const parseSavedGame = (value: unknown): SavedGame | null => {
  if (!isRecord(value) || !isRecord(value.settings)) return null;
  const { size, difficulty } = value.settings;
  const knownDifficulty = findDifficulty(difficulty);
  if (!isRecord(size) || !knownDifficulty) return null;
  const knownSize = BOARD_SIZES.find((option) => option.width === size.width && option.height === size.height);
  if (!knownSize) return null;
  if (!isBoard(value.board, knownSize.width, knownSize.height)) return null;
  return { settings: { size: knownSize, difficulty: knownDifficulty }, board: value.board };
};

// 保存データが無い・壊れている・読めない場合は null を返す（プライベートモード等で localStorage が使えない場合も含む）。
export const loadGame = (): SavedGame | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return parseSavedGame(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const saveGame = (game: SavedGame): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
  } catch {
    // 容量超過や無効化時は保存を諦めるだけで、ゲームは続けられる。
  }
};

export const clearGame = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 消せなくてもゲームの進行には影響しない。
  }
};
