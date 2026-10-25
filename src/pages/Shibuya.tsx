import { type RefObject, useEffect, useRef, useState } from 'react';
import { type CarLight, PED_RULES, type PedLight } from '../games/shibuya/model';
import { createShibuyaSim, type SimController, type SimSnapshot, VIEWS } from '../games/shibuya/scene';
import { nextPeriod, PERIOD_LABELS, TIME_MODE_LABELS, type TimeMode } from '../games/shibuya/timeOfDay';
import './Shibuya.css';

const INITIAL: SimSnapshot = {
  phase: 2,
  carA: 'red',
  carB: 'green',
  ped: 'red',
  cars: 0,
  waiting: 0,
  view: 0,
  timeMode: 'auto',
  period: 'day',
  fading: false
};

const TIME_MODES: TimeMode[] = ['auto', 'day', 'evening', 'night'];

const PHASE_LABELS: Record<SimSnapshot['phase'], string> = {
  1: '車（東西方向）が青',
  2: '車（南北方向）が青',
  3: '歩行者スクランブル'
};

const LIGHT_LABELS: Record<CarLight | PedLight, string> = {
  green: '青',
  yellow: '黄',
  red: '赤',
  flash: '点滅'
};

const Lamp = ({ name, light }: { name: string; light: CarLight | PedLight }) => (
  <li className='shibuya-lamp'>
    <span className={`shibuya-lamp-dot shibuya-lamp-${light}`} aria-hidden='true' />
    <span className='shibuya-lamp-name'>{name}</span>
    <span className='shibuya-lamp-state'>{LIGHT_LABELS[light]}</span>
  </li>
);

// 北が赤い針の側。カメラの向きに合わせて全体を回す。
const Compass = ({ rose }: { rose: RefObject<HTMLDivElement | null> }) => (
  <div className='shibuya-compass' role='img' aria-label='方位磁針'>
    <div className='shibuya-compass-rose' ref={rose}>
      <svg viewBox='-50 -50 100 100' aria-hidden='true'>
        <circle className='shibuya-compass-ring' r='46' />
        <path className='shibuya-compass-north' d='M0 -32 L10 0 L-10 0 Z' />
        <path className='shibuya-compass-south' d='M0 32 L10 0 L-10 0 Z' />
      </svg>
    </div>
  </div>
);

const Shibuya = () => {
  const canvasParent = useRef<HTMLDivElement>(null);
  const compassRose = useRef<HTMLDivElement>(null);
  const controller = useRef<SimController | null>(null);
  const [state, setState] = useState<SimSnapshot>(INITIAL);
  const slider = useRef<HTMLInputElement>(null);
  const [crossers, setCrossers] = useState(PED_RULES.crossersInitial);
  const [collapsed, setCollapsed] = useState(false);

  // React の onChange はドラッグ中も呼ばれるので、つまみを離したときに出るネイティブの change で反映する
  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const onCommit = () => controller.current?.setCrossers(Number(input.value));
    input.addEventListener('change', onCommit);
    return () => input.removeEventListener('change', onCommit);
  }, []);

  useEffect(() => {
    const parent = canvasParent.current;
    if (!parent) return;
    let disposed = false;
    let sim: SimController | null = null;
    const previousTitle = document.title;
    document.title = '渋谷スクランブル交差点';
    // StrictMode の初回クリーンアップ後に生成し、Canvas の二重生成を避ける。
    queueMicrotask(() => {
      if (disposed) return;
      sim = createShibuyaSim(
        parent,
        (next) => {
          if (disposed) return;
          setState(next);
        },
        (heading) => {
          const rose = compassRose.current;
          if (!rose) return;
          // カメラが向いている方角が画面の上に来るので、北はその逆向きに回した位置になる
          rose.style.transform = `rotate(${-heading}rad)`;
        }
      );
      controller.current = sim;
    });
    return () => {
      disposed = true;
      sim?.destroy();
      controller.current = null;
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className='shibuya-page'>
      <div className='shibuya-canvas' ref={canvasParent} />

      <section
        className={collapsed ? 'shibuya-panel shibuya-panel-collapsed' : 'shibuya-panel'}
        aria-label='信号の状態'
      >
        <div className='shibuya-panel-head'>
          <h1 className='shibuya-title'>SHIBUYA SCRAMBLE</h1>
          {/* 向きは折りたたんでいても知りたいので、コンパスは見出しの行に置く */}
          <Compass rose={compassRose} />
          <button
            type='button'
            className='shibuya-panel-toggle'
            aria-expanded={!collapsed}
            aria-controls='shibuya-panel-body'
            aria-label={collapsed ? '操作メニューを開く' : '操作メニューを折りたたむ'}
            onClick={(event) => {
              // フォーカスが残ると、数字キーで定点を切り替えたときに枠が出るので外す
              event.currentTarget.blur();
              setCollapsed((value) => !value);
            }}
          >
            <svg className='shibuya-panel-toggle-icon' viewBox='0 0 12 12' aria-hidden='true'>
              <path d='M2.5 7.5 L6 4 L9.5 7.5' />
            </svg>
          </button>
        </div>
        {/* スライダーの change リスナーを保つため、折りたたんでもアンマウントせず hidden で隠す */}
        <div id='shibuya-panel-body' hidden={collapsed}>
          <p className='shibuya-phase'>
            <span className='shibuya-phase-number'>{state.phase}</span>
            {PHASE_LABELS[state.phase]}
          </p>
          <ul className='shibuya-lamps'>
            <Lamp name='車 東西' light={state.carA} />
            <Lamp name='車 南北' light={state.carB} />
            <Lamp name='歩行者' light={state.ped} />
          </ul>
          <p className='shibuya-counts'>
            車 {state.cars} 台 ・ 信号待ち {state.waiting} 人
          </p>
          <label className='shibuya-crossers'>
            <span className='shibuya-crossers-head'>
              <span>1 回で渡る人数</span>
              <span className='shibuya-crossers-value'>約 {crossers} 人</span>
            </span>
            <input
              ref={slider}
              className='shibuya-crossers-input'
              type='range'
              min={PED_RULES.crossersMin}
              max={PED_RULES.crossersMax}
              step={PED_RULES.crossersStep}
              value={crossers}
              onChange={(event) => setCrossers(Number(event.currentTarget.value))}
              // フォーカスが残ると、数字キーで定点を切り替えたときに枠が出るので外す
              onPointerUp={(event) => event.currentTarget.blur()}
            />
          </label>
          <div className='shibuya-time'>
            <span className='shibuya-time-head'>
              <span>時間帯</span>
              {state.timeMode === 'auto' && (
                <span className='shibuya-time-now'>
                  {state.fading
                    ? `${PERIOD_LABELS[state.period]} → ${PERIOD_LABELS[nextPeriod(state.period)]}`
                    : `いま: ${PERIOD_LABELS[state.period]}`}
                </span>
              )}
            </span>
            <div className='shibuya-time-buttons'>
              {TIME_MODES.map((mode) => (
                <button
                  key={mode}
                  type='button'
                  aria-pressed={mode === state.timeMode}
                  className={
                    mode === state.timeMode ? 'shibuya-time-button shibuya-time-button-active' : 'shibuya-time-button'
                  }
                  onClick={(event) => {
                    // フォーカスが残ると、数字キーで定点を切り替えたときに枠が出るので外す
                    event.currentTarget.blur();
                    controller.current?.setTimeMode(mode);
                  }}
                >
                  {TIME_MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <nav className='shibuya-views' aria-label='定点カメラ'>
        {VIEWS.map((view, index) => (
          <button
            key={view.label}
            type='button'
            className={index === state.view ? 'shibuya-view shibuya-view-active' : 'shibuya-view'}
            onClick={(event) => {
              // フォーカスが残ると、数字キーでの切り替えと見た目がずれるので外す
              event.currentTarget.blur();
              controller.current?.setView(index);
            }}
          >
            <span className='shibuya-view-key'>{index + 1}</span>
            {view.label}
          </button>
        ))}
      </nav>

      <p className='shibuya-credit'>
        建物・道路:{' '}
        <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noreferrer'>
          © OpenStreetMap contributors
        </a>
      </p>
    </main>
  );
};

export default Shibuya;
