import { useEffect, useState } from 'react';
import { SHOPS } from '../games/palm/shops';
import { PalmMiniMap } from './PalmMiniMap';
import './PalmDebug.css';

// ミニマップの確認用ページ。店を 1 店選ぶと地図上に位置を出す。
const PalmDebug = () => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'パルム ミニマップ確認';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const filtered = SHOPS.filter((shop) => shop.name.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = SHOPS.find((shop) => shop.id === selectedId);

  return (
    <main className='palm-debug'>
      <h1 className='palm-debug-title'>ミニマップ確認</h1>
      <div className='palm-debug-controls'>
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
          onChange={(event) => setSelectedId(event.target.value ? Number(event.target.value) : null)}
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
            {selected.name}: PALM-{selected.block} {selected.side === 'left' ? '左' : '右'}側 order={selected.order}
            {selected.floor >= 2 ? `（${selected.floor}F）` : ''}
          </p>
        )}
      </div>
      <div className='palm-debug-map'>
        <PalmMiniMap shops={SHOPS} marked={selected ? [selected] : []} />
      </div>
    </main>
  );
};

export default PalmDebug;
