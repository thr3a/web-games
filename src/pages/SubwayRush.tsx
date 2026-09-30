import { type MouseEvent, useEffect, useRef, useState } from 'react';
import { createSubwayRushGame, type GameController, type GameSnapshot } from '../games/subway-rush/game';
import './SubwayRush.css';

const INITIAL: GameSnapshot = { status: 'ready', distance: 0, score: 0, coins: 0, speedLevel: 0 };

const formatScore = (value: number) => String(value).padStart(6, '0');

const SubwayRush = () => {
  const canvasParent = useRef<HTMLDivElement>(null);
  const controller = useRef<GameController | null>(null);
  const [state, setState] = useState<GameSnapshot>(INITIAL);

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
  const pause = (event: MouseEvent<HTMLButtonElement>) => {
    // フォーカスが残ると、PC で Space を押したときにボタンが再び押されてポーズし直してしまう。
    event.currentTarget.blur();
    controller.current?.pause();
  };
  const resume = () => controller.current?.resume();

  useEffect(() => {
    // PC ではキーでも画面を進められるようにする。ポーズ中の Space/Enter は再開（リスタートしない）。
    const onKeyDown = (event: KeyboardEvent) => {
      const confirm = event.key === ' ' || event.key === 'Enter';
      const toggle = event.key === 'Escape' || event.key === 'p' || event.key === 'P';
      if (state.status === 'playing') {
        if (!toggle) return;
        event.preventDefault();
        controller.current?.pause();
        return;
      }
      if (state.status === 'paused') {
        if (!confirm && !toggle) return;
        event.preventDefault();
        controller.current?.resume();
        return;
      }
      if (!confirm) return;
      event.preventDefault();
      controller.current?.start();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.status]);

  const inGame = state.status === 'playing' || state.status === 'paused';

  return (
    <main className='subway-rush-page'>
      <section className='subway-rush-frame' aria-label='SUBWAY RUSH'>
        <div className='subway-rush-canvas' ref={canvasParent} />

        {inGame && (
          <div className='subway-rush-hud'>
            <button type='button' className='subway-rush-pause' onClick={pause} aria-label='ポーズ'>
              <span />
              <span />
            </button>
            <div className='subway-rush-counters'>
              <div className='subway-rush-panel subway-rush-score'>
                <span className='subway-rush-star' aria-hidden='true'>
                  ★
                </span>
                {formatScore(state.score)}
              </div>
              <div className='subway-rush-panel subway-rush-coins'>
                {state.coins}
                <span className='subway-rush-coin' aria-hidden='true' />
              </div>
              <div className='subway-rush-distance'>{state.distance} m</div>
            </div>
          </div>
        )}

        {inGame && state.speedLevel > 0 && (
          <div className='subway-rush-speedup' key={state.speedLevel} aria-live='polite'>
            <div className='subway-rush-speedlines' />
            <strong>SPEED UP!</strong>
          </div>
        )}

        {state.status === 'ready' && (
          <button type='button' className='subway-rush-overlay subway-rush-title' onClick={start}>
            <h1 className='subway-rush-logo'>
              <span>SUBWAY</span>
              <span>RUSH</span>
            </h1>
            <ul className='subway-rush-howto'>
              <li>← → スワイプでレーン移動</li>
              <li>↑ スワイプでジャンプ</li>
              <li>↓ スワイプでスライディング</li>
              <li>コイン30枚ごとにスピードアップ</li>
            </ul>
            <span className='subway-rush-blink'>タップでスタート</span>
          </button>
        )}

        {state.status === 'paused' && (
          <div className='subway-rush-overlay'>
            <div className='subway-rush-card'>
              <h2>PAUSE</h2>
              <button type='button' className='subway-rush-button' onClick={resume}>
                再開する
              </button>
            </div>
          </div>
        )}

        {state.status === 'over' && (
          <div className='subway-rush-overlay'>
            <div className='subway-rush-card'>
              <h2>GAME OVER</h2>
              <dl className='subway-rush-result'>
                <dt>スコア</dt>
                <dd className='subway-rush-result-score'>{state.score}</dd>
                <dt>走行距離</dt>
                <dd>{state.distance} m</dd>
                <dt>コイン</dt>
                <dd>{state.coins} 枚</dd>
              </dl>
              <button type='button' className='subway-rush-button' onClick={start}>
                リトライ
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
};

export default SubwayRush;
