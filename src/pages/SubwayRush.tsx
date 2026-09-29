import { useEffect, useRef, useState } from 'react';
import { createSubwayRushGame, type GameController, type GameSnapshot } from '../games/subway-rush/game';
import './SubwayRush.css';

const SubwayRush = () => {
  const canvasParent = useRef<HTMLDivElement>(null);
  const controller = useRef<GameController | null>(null);
  const [state, setState] = useState<GameSnapshot>({ status: 'ready', distance: 0 });

  useEffect(() => {
    const parent = canvasParent.current;
    if (!parent) return;
    let disposed = false;
    let game: GameController | null = null;
    const previousTitle = document.title;
    document.title = 'SUBWAY RUSH';
    // StrictMode の初回クリーンアップ後に生成し、Canvas の二重生成を避ける。
    queueMicrotask(() => {
      if (disposed) return;
      game = createSubwayRushGame(parent, (next) => {
        if (disposed) return;
        setState(next);
      });
      controller.current = game;
    });
    return () => {
      disposed = true;
      game?.destroy();
      controller.current = null;
      document.title = previousTitle;
    };
  }, []);

  const start = () => controller.current?.start();

  useEffect(() => {
    if (state.status === 'playing') return;
    // PC ではスペース/Enter でも開始できるようにする（仮のタイトル・リザルト用）。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      controller.current?.start();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.status]);

  return (
    <main className='subway-rush-page'>
      <section className='subway-rush-frame' aria-label='SUBWAY RUSH'>
        <div className='subway-rush-canvas' ref={canvasParent} />
        {state.status === 'playing' && <div className='subway-rush-distance'>{state.distance} m</div>}
        {/* 仮のタイトル・ゲームオーバー表示。画面遷移は後のステップで作り込む。 */}
        {state.status !== 'playing' && (
          <button type='button' className='subway-rush-overlay' onClick={start}>
            <strong>{state.status === 'ready' ? 'SUBWAY RUSH' : 'GAME OVER'}</strong>
            {state.status === 'over' && <span>{state.distance} m</span>}
            <span>{state.status === 'ready' ? 'タップでスタート' : 'タップでリトライ'}</span>
          </button>
        )}
      </section>
    </main>
  );
};

export default SubwayRush;
