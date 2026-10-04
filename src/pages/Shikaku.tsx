import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from 'react';
import { generatePuzzleByDifficulty } from '../games/shikaku/generator';
import {
  BOARD_SIZES,
  type Board,
  type Cell,
  clampCell,
  createBoard,
  DEFAULT_CONFIG,
  DIFFICULTIES,
  type Difficulty,
  RECT_COLORS,
  type Rect,
  rectAt,
  releaseSelection,
  selectionRect
} from '../games/shikaku/model';
import { clearGame, loadGame, saveGame } from '../games/shikaku/storage';
import './Shikaku.css';

type Drag = { pointerId: number; from: Cell; to: Cell };

type BoardSize = { width: number; height: number };

type Settings = { size: BoardSize; difficulty: Difficulty };

const newBoard = ({ size, difficulty }: Settings): Board =>
  createBoard(generatePuzzleByDifficulty({ ...DEFAULT_CONFIG, ...size }, difficulty));

const sizeLabel = (size: BoardSize): string => `${size.width}×${size.height}`;

const sameSize = (a: BoardSize, b: BoardSize): boolean => a.width === b.width && a.height === b.height;

// CSS 変数を style に渡すため、React の CSSProperties に無いキーを含む型にする。
type CssVars = CSSProperties & Record<`--${string}`, string | number>;

const rectStyle = (rect: Rect): CssVars => ({
  '--x': rect.x,
  '--y': rect.y,
  '--w': rect.w,
  '--h': rect.h
});

type GameProps = { settings: Settings; initialBoard: Board | null; onBack: () => void };

const ShikakuGame = ({ settings, initialBoard, onBack }: GameProps) => {
  const [board, setBoard] = useState<Board>(() => initialBoard ?? newBoard(settings));
  const [drag, setDrag] = useState<Drag | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { puzzle } = board;
  const cleared = board.status === 'cleared';

  // 途中経過を逐次保存し、リロードしても再開できるようにする。クリア後は保存を消す。
  useEffect(() => {
    if (board.status === 'cleared') {
      clearGame();
      return;
    }
    saveGame({ settings, board });
  }, [board, settings]);

  // 画面上の座標を盤面のマス座標（小数あり）に変換する。盤面の外は selectionRect 側で収める。
  const cellFromPoint = (clientX: number, clientY: number): Cell | null => {
    const element = boardRef.current;
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    return {
      x: ((clientX - bounds.left) / bounds.width) * puzzle.width,
      y: ((clientY - bounds.top) / bounds.height) * puzzle.height
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (cleared || drag) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (!cell) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = clampCell(puzzle, cell);
    setDrag({ pointerId: event.pointerId, from: start, to: start });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cell = cellFromPoint(event.clientX, event.clientY);
    if (!cell) return;
    const to = clampCell(puzzle, cell);
    if (to.x === drag.to.x && to.y === drag.to.y) return;
    setDrag({ ...drag, to });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const cell = cellFromPoint(event.clientX, event.clientY);
    const to = cell ? clampCell(puzzle, cell) : drag.to;
    setBoard(releaseSelection(board, drag.from, to));
    setDrag(null);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDrag(null);
  };

  const nextPuzzle = () => {
    setBoard(newBoard(settings));
    setDrag(null);
  };

  // リタイアは保存データを消してスタート画面に戻る。誤タップで失わないよう確認する。
  const retire = () => {
    if (!window.confirm('リタイアしてスタート画面に戻りますか？')) return;
    clearGame();
    onBack();
  };

  const selection = drag ? selectionRect(puzzle, drag.from, drag.to) : null;
  const cells = Array.from({ length: puzzle.width * puzzle.height }, (_, i) => ({
    x: i % puzzle.width,
    y: Math.floor(i / puzzle.width)
  }));
  const gameStyle: CssVars = { '--cols': puzzle.width, '--rows': puzzle.height };
  const difficultyLabel = DIFFICULTIES.find((option) => option.value === settings.difficulty)?.label ?? '';

  return (
    <div className='shikaku-game' style={gameStyle}>
      <div className='shikaku-header'>
        <p className='shikaku-settings'>
          {sizeLabel(settings.size)}・{difficultyLabel}
        </p>
        {!cleared && (
          <button type='button' className='shikaku-retire' onClick={retire}>
            リタイア
          </button>
        )}
      </div>
      <div
        ref={boardRef}
        className={`shikaku-board${cleared ? ' is-cleared' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {cells.map((cell) => (
          <div key={`${cell.x}-${cell.y}`} className='shikaku-cell' style={rectStyle({ ...cell, w: 1, h: 1 })} />
        ))}
        {board.rects.map((rect) => {
          const color = RECT_COLORS[rect.color];
          const style: CssVars = { ...rectStyle(rect), '--fill': color.fill, '--shade': color.shade };
          return <div key={rect.id} className='shikaku-rect' style={style} />;
        })}
        {selection && <div className='shikaku-selection' style={rectStyle(selection)} />}
        {puzzle.clues.map((clue) => (
          <div
            key={`${clue.x}-${clue.y}`}
            className={`shikaku-clue${rectAt(board, clue) ? ' is-covered' : ''}`}
            style={rectStyle({ ...clue, w: 1, h: 1 })}
          >
            {clue.value}
          </div>
        ))}
      </div>
      <div className='shikaku-footer'>
        {cleared ? (
          <div className='shikaku-clear' role='status'>
            <p className='shikaku-clear-message'>クリア！</p>
            <button type='button' className='shikaku-next' onClick={nextPuzzle}>
              次の問題
            </button>
            <button type='button' className='shikaku-back' onClick={onBack}>
              設定を選び直す
            </button>
          </div>
        ) : (
          <p className='shikaku-hint'>ドラッグで四角を置く・タップで消す</p>
        )}
      </div>
    </div>
  );
};

type StartProps = { settings: Settings; onChange: (settings: Settings) => void; onStart: () => void };

const ShikakuStart = ({ settings, onChange, onStart }: StartProps) => (
  <div className='shikaku-start'>
    <section className='shikaku-option-group'>
      <h2 className='shikaku-option-title'>盤面のサイズ</h2>
      <div className='shikaku-options'>
        {BOARD_SIZES.map((size) => (
          <button
            key={sizeLabel(size)}
            type='button'
            className='shikaku-option'
            aria-pressed={sameSize(size, settings.size)}
            onClick={() => onChange({ ...settings, size })}
          >
            {sizeLabel(size)}
          </button>
        ))}
      </div>
    </section>
    <section className='shikaku-option-group'>
      <h2 className='shikaku-option-title'>難易度</h2>
      <div className='shikaku-options'>
        {DIFFICULTIES.map((option) => (
          <button
            key={option.value}
            type='button'
            className='shikaku-option'
            aria-pressed={option.value === settings.difficulty}
            onClick={() => onChange({ ...settings, difficulty: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
    <button type='button' className='shikaku-next shikaku-start-button' onClick={onStart}>
      スタート
    </button>
  </div>
);

const Shikaku = () => {
  // 保存データがあればスタート画面を飛ばして途中から再開する。
  const [saved] = useState(loadGame);
  const [settings, setSettings] = useState<Settings>(saved?.settings ?? { size: BOARD_SIZES[0], difficulty: 'normal' });
  const [playing, setPlaying] = useState(saved !== null);
  const [restoredBoard, setRestoredBoard] = useState<Board | null>(saved?.board ?? null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '四角に切れ';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className='shikaku-page'>
      {playing ? (
        <ShikakuGame settings={settings} initialBoard={restoredBoard} onBack={() => setPlaying(false)} />
      ) : (
        <>
          <h1 className='shikaku-title'>四角に切れ</h1>
          <ShikakuStart
            settings={settings}
            onChange={setSettings}
            onStart={() => {
              setRestoredBoard(null);
              setPlaying(true);
            }}
          />
        </>
      )}
    </main>
  );
};

export default Shikaku;
