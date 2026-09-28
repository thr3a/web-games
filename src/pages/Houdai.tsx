import { useEffect, useRef, useState } from 'react';
import { createHoudaiGame, type GameController } from '../games/houdai/game';
import { createModel, type GameSnapshot, RULES, snapshot } from '../games/houdai/model';
import './Houdai.css';

const BEST_SCORE_KEY = 'houdai.best-score';

const readBest = () => {
  // 保存領域を利用できないブラウザーでもプレイを継続する。
  try {
    const score = Number(localStorage.getItem(BEST_SCORE_KEY));
    return Number.isSafeInteger(score) && score > 0 ? score : 0;
  } catch {
    return 0;
  }
};

const saveBest = (score: number) => {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    // 保存できない場合も、この画面を開いている間は記録を保持する。
  }
};

const iconPaths = {
  play: 'm9 5 11 7-11 7Z',
  pause: 'M8 5v14M16 5v14',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  trophy: 'M8 3h8v8a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 3v6m-4 0h8',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  drag: 'M4 16h16M7 13l-3 3 3 3m10-6 3 3-3 3M12 5v5m-3-2 3 3 3-3',
  retry: 'M4 10a8 8 0 1 1 1 7M4 4v6h6',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm3 17h2'
};

const Icon = ({ name }: { name: keyof typeof iconPaths }) => (
  <svg
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='1.8'
    strokeLinecap='round'
    strokeLinejoin='round'
    aria-hidden='true'
  >
    <path d={iconPaths[name]} />
  </svg>
);

const formatScore = (score: number) => score.toLocaleString('ja-JP');
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

const Houdai = () => {
  const canvasParent = useRef<HTMLDivElement>(null);
  const controller = useRef<GameController | null>(null);
  const [state, setState] = useState<GameSnapshot>(() => snapshot(createModel()));
  const [best, setBest] = useState(readBest);
  const bestRef = useRef(best);
  const [newRecord, setNewRecord] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const status = state.status;

  useEffect(() => {
    const parent = canvasParent.current;
    if (!parent) return;
    let disposed = false;
    let game: GameController | null = null;
    const previousTitle = document.title;
    document.title = 'HOUDAI — 空と、砲台。';
    // StrictMode の初回クリーンアップ後に生成し、Canvas の二重生成を避ける。
    queueMicrotask(() => {
      if (disposed) return;
      game = createHoudaiGame(parent, (next) => {
        if (disposed) return;
        setLoaded(true);
        setState(next);
        if (next.status !== 'over' || next.score <= bestRef.current) return;
        bestRef.current = next.score;
        setBest(next.score);
        setNewRecord(true);
        saveBest(next.score);
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

  const start = () => {
    setNewRecord(false);
    controller.current?.start();
  };

  return (
    <main className='houdai-page'>
      <section className='houdai-frame' aria-label='HOUDAI シューティングゲーム'>
        <div
          className='houdai-canvas'
          ref={canvasParent}
          role='img'
          aria-label='画面下部を押したまま左右にドラッグして砲台を操作'
        />
        <header className='houdai-hud'>
          <div className='houdai-brand-row'>
            <span className='houdai-wordmark'>
              <span className='houdai-brand-mark' /> HOUDAI<span className='houdai-brand-dot'>®</span>
            </span>
            <span className='houdai-mode'>
              <span /> ENDLESS PLAY
            </span>
          </div>
          <div className='houdai-score-row'>
            <div className='houdai-score'>
              <span className='houdai-label'>スコア</span>
              <strong>{String(state.score).padStart(6, '0')}</strong>
            </div>
            <div className='houdai-hud-actions'>
              <output className='houdai-coin-count' aria-label={`コイン ${state.coins}枚`}>
                <span className='houdai-coin-icon'>C</span>
                <strong>{state.coins}</strong>
              </output>
              <button
                type='button'
                className='houdai-pause'
                aria-label='一時停止'
                disabled={status !== 'playing'}
                onClick={() => controller.current?.pause()}
              >
                <Icon name='pause' />
              </button>
            </div>
          </div>
          <div className={`houdai-health${state.hp <= 25 ? ' houdai-health-low' : ''}`}>
            <Icon name='heart' />
            <meter
              className='houdai-visually-hidden'
              aria-label='プレイヤーHP'
              min={0}
              max={RULES.maxHp}
              value={state.hp}
            />
            <div className='houdai-health-track' aria-hidden='true'>
              <span style={{ width: `${state.hp}%` }} />
            </div>
            <span className='houdai-health-number'>
              {state.hp}
              <span> / {RULES.maxHp}</span>
            </span>
          </div>
        </header>

        {status === 'ready' && (
          <div className='houdai-welcome'>
            <span className='houdai-eyebrow'>空と、砲台。</span>
            <h1>
              HOUDAI<span className='houdai-subtitle'>気づけば、もう一回。</span>
            </h1>
            <p className='houdai-intro'>
              降ってくるカタチを、撃ちくだこう。
              <br />
              指ひとつで遊ぶ、小さなシューティング。
            </p>
            <button type='button' className='houdai-primary' onClick={start} disabled={!loaded}>
              <Icon name='play' />
              <span>{loaded ? 'プレイする' : '準備しています…'}</span>
              <Icon name='arrow' />
            </button>
            <div className='houdai-best'>
              <Icon name='trophy' />
              <span>ベスト</span>
              <strong>{formatScore(best)}</strong>
            </div>
          </div>
        )}

        {(status === 'paused' || status === 'over') && (
          <div className='houdai-overlay'>
            <section className='houdai-result' role='dialog' aria-modal='true' aria-labelledby='houdai-dialog-title'>
              <span className='houdai-result-symbol'>
                <Icon name={status === 'paused' ? 'pause' : 'trophy'} />
              </span>
              <span className='houdai-eyebrow'>
                {status === 'paused' ? 'TAKE A BREATH' : newRecord ? 'NEW BEST!' : 'NICE TRY!'}
              </span>
              <h2 id='houdai-dialog-title'>{status === 'paused' ? 'ちょっと、ひと休み。' : 'もう一回、空へ。'}</h2>
              <div className='houdai-result-score'>
                <span className='houdai-label'>今回のスコア</span>
                <strong>{formatScore(state.score)}</strong>
              </div>
              <div className='houdai-result-stats'>
                <div>
                  <span>撃破</span>
                  <strong>
                    {state.kills}
                    <small> 体</small>
                  </strong>
                </div>
                <div>
                  <span>コイン</span>
                  <strong>
                    {state.coins}
                    <small> 枚</small>
                  </strong>
                </div>
                <div>
                  <span>プレイ時間</span>
                  <strong>{formatTime(state.elapsed)}</strong>
                </div>
              </div>
              <div className='houdai-best'>
                <Icon name='trophy' />
                <span>ベスト</span>
                <strong>{formatScore(best)}</strong>
              </div>
              <button
                type='button'
                className='houdai-primary'
                onClick={status === 'paused' ? () => controller.current?.resume() : start}
              >
                <Icon name={status === 'paused' ? 'play' : 'retry'} />
                <span>{status === 'paused' ? 'つづける' : 'もう一回プレイ'}</span>
                <Icon name='arrow' />
              </button>
              {status === 'paused' && (
                <button type='button' className='houdai-text-button' onClick={start}>
                  最初から遊ぶ
                </button>
              )}
            </section>
          </div>
        )}

        <footer className='houdai-footer'>
          <div className='houdai-drag-hint'>
            <span />
            <Icon name='drag' />
            <span />
          </div>
          <p>押し続けて連射 · 左右にドラッグ</p>
          <span className='houdai-heal-hint'>
            <span className='houdai-small-coin'>C</span> コインを拾うと HP が回復
          </span>
        </footer>
      </section>
      <div className='houdai-rotate'>
        <Icon name='phone' />
        <strong>縦向きで、空へ。</strong>
        <p>スマートフォンを縦にして遊んでね。</p>
      </div>
    </main>
  );
};

export default Houdai;
