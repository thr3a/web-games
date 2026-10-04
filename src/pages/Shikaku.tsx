import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from 'react';
import { generatePuzzle } from '../games/shikaku/generator';
import {
  type Board,
  type Cell,
  clampCell,
  createBoard,
  DEFAULT_CONFIG,
  RECT_COLORS,
  type Rect,
  rectAt,
  releaseSelection,
  selectionRect
} from '../games/shikaku/model';
import './Shikaku.css';

type Drag = { pointerId: number; from: Cell; to: Cell };

const newBoard = (): Board => createBoard(generatePuzzle(DEFAULT_CONFIG));

// CSS 変数を style に渡すため、React の CSSProperties に無いキーを含む型にする。
type CssVars = CSSProperties & Record<`--${string}`, string | number>;

const rectStyle = (rect: Rect): CssVars => ({
  '--x': rect.x,
  '--y': rect.y,
  '--w': rect.w,
  '--h': rect.h
});

const Shikaku = () => {
  const [board, setBoard] = useState<Board>(newBoard);
  const [drag, setDrag] = useState<Drag | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { puzzle } = board;
  const cleared = board.status === 'cleared';

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '四角に切れ';
    return () => {
      document.title = previousTitle;
    };
  }, []);

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
    setBoard(newBoard());
    setDrag(null);
  };

  const selection = drag ? selectionRect(puzzle, drag.from, drag.to) : null;
  const cells = Array.from({ length: puzzle.width * puzzle.height }, (_, i) => ({
    x: i % puzzle.width,
    y: Math.floor(i / puzzle.width)
  }));
  const boardStyle: CssVars = { '--cols': puzzle.width, '--rows': puzzle.height };

  return (
    <main className='shikaku-page'>
      <h1 className='shikaku-title'>四角に切れ</h1>
      <div
        ref={boardRef}
        className={`shikaku-board${cleared ? ' is-cleared' : ''}`}
        style={boardStyle}
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
          </div>
        ) : (
          <p className='shikaku-hint'>ドラッグで四角を置く・タップで消す</p>
        )}
      </div>
    </main>
  );
};

export default Shikaku;
