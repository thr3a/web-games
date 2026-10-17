import { useEffect, useState } from 'react';
import type { Shop } from '../games/palm/model';
import { SHOPS } from '../games/palm/shops';
import { HorizontalBandMap } from './PalmMiniMapPatterns';
import './PalmDebug.css';

const SLOTS = [0, 1];

// 全点灯で 1 店ずつ切り替える間隔(ms)
const SWEEP_INTERVAL = 500;

const sectionText = (shop: Shop): string =>
  `PALM-${shop.block} ${shop.side === 'left' ? '左' : '右'}側 order=${shop.order}${shop.floor >= 2 ? `（${shop.floor}F）` : ''}`;

type PickerProps = {
  label: string;
  selectedId: number | null;
  onChange: (id: number | null) => void;
};

// 店名の絞り込み＋選択。絞り込みは欄ごとに持つので、1 店目を選んだまま 2 店目を探せる。
const ShopPicker = ({ label, selectedId, onChange }: PickerProps) => {
  const [query, setQuery] = useState('');
  const filtered = SHOPS.filter(
    (shop) => shop.id === selectedId || shop.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const selected = SHOPS.find((shop) => shop.id === selectedId);

  return (
    <fieldset className='palm-debug-picker'>
      <legend>{label}</legend>
      <input
        type='search'
        className='palm-debug-input'
        placeholder='店名で絞り込み'
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        className='palm-debug-input'
        value={selectedId ?? ''}
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)}
      >
        <option value=''>店を選択（{filtered.length}件）</option>
        {filtered.map((shop) => (
          <option key={shop.id} value={shop.id}>
            PALM-{shop.block} {shop.side === 'left' ? '左' : '右'} {shop.order}: {shop.name}
          </option>
        ))}
      </select>
      {selected && (
        <p className='palm-debug-detail'>
          {selected.name}: {sectionText(selected)}
        </p>
      )}
    </fieldset>
  );
};

const randomShopId = (): number => SHOPS[Math.floor(Math.random() * SHOPS.length)].id;

// ミニマップの確認用ページ。店を 2 店まで選ぶと地図上に位置を出す。
const PalmDebug = () => {
  const [selectedIds, setSelectedIds] = useState<(number | null)[]>([null, null]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'パルム ミニマップ確認';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  // 全点灯中は CSV の何行目の店を出しているか。止まっているときは null。
  const [sweepIndex, setSweepIndex] = useState<number | null>(null);

  useEffect(() => {
    if (sweepIndex === null) return;
    const timer = setTimeout(
      () => setSweepIndex(sweepIndex + 1 < SHOPS.length ? sweepIndex + 1 : null),
      SWEEP_INTERVAL
    );
    return () => clearTimeout(timer);
  }, [sweepIndex]);

  const sweepingShop = sweepIndex === null ? undefined : SHOPS[sweepIndex];
  const marked = sweepingShop ? [sweepingShop] : selectedIds.flatMap((id) => SHOPS.filter((shop) => shop.id === id));

  const changeSlot = (slot: number, id: number | null) =>
    setSelectedIds((ids) => ids.map((current, i) => (i === slot ? id : current)));

  // 同じ区画の近い 2 店は名前が重なりやすいので、それも試せるようにする。
  const pickNearPair = () => {
    const first = SHOPS.find((shop) => shop.id === randomShopId());
    if (!first) return;
    const neighbors = SHOPS.filter(
      (shop) =>
        shop.id !== first.id &&
        shop.block === first.block &&
        shop.side === first.side &&
        Math.abs(shop.order - first.order) <= 2
    );
    const second = neighbors[Math.floor(Math.random() * neighbors.length)];
    setSelectedIds([first.id, second ? second.id : null]);
  };

  return (
    <main className='palm-debug'>
      <h1 className='palm-debug-title'>ミニマップ確認</h1>
      <div className='palm-debug-controls'>
        {SLOTS.map((slot) => (
          <ShopPicker
            key={slot}
            label={`${slot + 1} 店目`}
            selectedId={selectedIds[slot]}
            onChange={(id) => changeSlot(slot, id)}
          />
        ))}
        <div className='palm-debug-buttons'>
          <button
            type='button'
            className='palm-debug-button'
            onClick={() => setSelectedIds([randomShopId(), randomShopId()])}
          >
            ランダム 2 店
          </button>
          <button type='button' className='palm-debug-button' onClick={pickNearPair}>
            同じ区画の近い 2 店
          </button>
          <button
            type='button'
            className='palm-debug-button'
            onClick={() => {
              setSweepIndex(null);
              setSelectedIds([null, null]);
            }}
          >
            クリア
          </button>
          <button
            type='button'
            className='palm-debug-button'
            onClick={() => setSweepIndex(sweepIndex === null ? 0 : null)}
          >
            {sweepIndex === null ? '全点灯' : '停止'}
          </button>
        </div>
        {sweepingShop && sweepIndex !== null && (
          <p className='palm-debug-detail'>
            {sweepIndex + 1}/{SHOPS.length} {sweepingShop.name}: {sectionText(sweepingShop)}
          </p>
        )}
      </div>
      <section className='palm-debug-map'>
        <HorizontalBandMap shops={SHOPS} marked={marked} />
      </section>
    </main>
  );
};

export default PalmDebug;
