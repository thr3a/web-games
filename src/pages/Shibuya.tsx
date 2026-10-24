import { useEffect, useRef, useState } from 'react';
import type { CarLight, PedLight } from '../games/shibuya/model';
import { createShibuyaSim, type SimController, type SimSnapshot, VIEWS } from '../games/shibuya/scene';
import './Shibuya.css';

const INITIAL: SimSnapshot = { phase: 2, carA: 'red', carB: 'green', ped: 'red', cars: 0, waiting: 0, view: 0 };

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

const Shibuya = () => {
  const canvasParent = useRef<HTMLDivElement>(null);
  const controller = useRef<SimController | null>(null);
  const [state, setState] = useState<SimSnapshot>(INITIAL);

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
      sim = createShibuyaSim(parent, (next) => {
        if (disposed) return;
        setState(next);
      });
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

      <section className='shibuya-panel' aria-label='信号の状態'>
        <h1 className='shibuya-title'>SHIBUYA SCRAMBLE</h1>
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

      <p className='shibuya-hint'>ドラッグで回転 ・ ホイールでズーム ・ 1〜{VIEWS.length} キーで定点切り替え</p>

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
