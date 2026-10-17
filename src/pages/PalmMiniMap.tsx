import type { Shop } from '../games/palm/model';
import './PalmMiniMap.css';

// 縦長のミニマップ。下が駅、上へ PALM-1 → 4、最上部が中原街道。
// 左列は駅から中原街道へ歩いたときの左側、右列は右側。

const WIDTH = 310;
const ROAD_HEIGHT = 26;
const BLOCK_TOP = 40;
const BLOCK_HEIGHT = 140;
const CROSS = 24; // ブロック間の交差道路の幅
const LEFT_X = 40;
const RIGHT_X = 175;
const COLUMN_WIDTH = 85;
const STREET_X = LEFT_X + COLUMN_WIDTH;
const STREET_WIDTH = RIGHT_X - STREET_X;

const BLOCK_COLORS: Record<number, { fill: string; stroke: string }> = {
  1: { fill: '#74c0fc', stroke: '#1c7ed6' },
  2: { fill: '#8ce99a', stroke: '#37b24d' },
  3: { fill: '#ffe066', stroke: '#f59f00' },
  4: { fill: '#ffc078', stroke: '#f76707' }
};

const BLOCKS = [1, 2, 3, 4];
const SIDES: Shop['side'][] = ['left', 'right'];

const blockTop = (block: number): number => BLOCK_TOP + (4 - block) * (BLOCK_HEIGHT + CROSS);
const blockBottom = (block: number): number => blockTop(block) + BLOCK_HEIGHT;

// 駅は中原街道と同じ帯で最下部に置く。
const STATION_Y = blockBottom(1) + BLOCK_TOP - ROAD_HEIGHT;
const HEIGHT = STATION_Y + ROAD_HEIGHT;

// 信号はイメージ通りブロックの境目の右側に置く。
const SIGNAL_YS = [2, 3, 4].map((block) => blockBottom(block) + CROSS / 2);
// 日本の横型信号機。灰色の本体に左から青・黄・赤、各灯火の上に庇（ひさし）が付く。
const SIGNAL_COLORS = ['#00a99d', '#f5a800', '#e60012'];
const SIGNAL_X = RIGHT_X + COLUMN_WIDTH + 5; // 本体の左端。区画の端から短い腕で吊るす
const SIGNAL_WIDTH = 30;
const SIGNAL_HEIGHT = 11;
const LAMP_RADIUS = 3.5;
const LAMP_GAP = 9;
const lampX = (i: number): number => SIGNAL_X + 6 + i * LAMP_GAP;

const columnX = (side: Shop['side']): number => (side === 'left' ? LEFT_X : RIGHT_X);

// 区画（ブロック × 左右）の並び数。order は駅側から数えるので、その最大値を区画の長さとみなす。
const sectionSize = (shops: Shop[], shop: Shop): number =>
  Math.max(
    ...shops.filter((other) => other.block === shop.block && other.side === shop.side).map((other) => other.order)
  );

// 店のマーカー位置。区画を並び数で等分し、駅側（下）から order 番目の中央に置く。
const markerPoint = (shops: Shop[], shop: Shop): { x: number; y: number } => {
  const ratio = (shop.order - 0.5) / sectionSize(shops, shop);
  return {
    x: columnX(shop.side) + COLUMN_WIDTH / 2,
    y: blockBottom(shop.block) - ratio * BLOCK_HEIGHT
  };
};

type Props = {
  shops: Shop[]; // 区画の並び数を求めるための全店
  marked: Shop[]; // マーカーを出す店
};

export const PalmMiniMap = ({ shops, marked }: Props) => (
  <svg
    className='palm-map'
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    role='img'
    aria-label={`パルム商店街のミニマップ${marked.length > 0 ? `（${marked.map((shop) => shop.name).join('、')}）` : ''}`}
  >
    <rect className='palm-map-road' x={20} y={0} width={WIDTH - 40} height={ROAD_HEIGHT} />
    <text className='palm-map-road-label' x={WIDTH / 2} y={ROAD_HEIGHT / 2}>
      中原街道
    </text>

    <rect
      className='palm-map-street'
      x={STREET_X}
      y={ROAD_HEIGHT}
      width={STREET_WIDTH}
      height={STATION_Y - ROAD_HEIGHT}
    />

    {BLOCKS.map((block) => (
      <g key={block}>
        {SIDES.map((side) => (
          <rect
            key={side}
            x={columnX(side)}
            y={blockTop(block)}
            width={COLUMN_WIDTH}
            height={BLOCK_HEIGHT}
            fill={BLOCK_COLORS[block].fill}
            stroke={BLOCK_COLORS[block].stroke}
          />
        ))}
        <text className='palm-map-block-label' x={STREET_X + STREET_WIDTH / 2} y={blockTop(block) + BLOCK_HEIGHT / 2}>
          PALM-{block}
        </text>
      </g>
    ))}

    {SIGNAL_YS.map((y) => (
      <g key={y}>
        <line className='palm-map-signal-arm' x1={RIGHT_X + COLUMN_WIDTH} y1={y} x2={SIGNAL_X} y2={y} />
        <rect
          className='palm-map-signal'
          x={SIGNAL_X}
          y={y - SIGNAL_HEIGHT / 2}
          width={SIGNAL_WIDTH}
          height={SIGNAL_HEIGHT}
          rx={2}
        />
        {SIGNAL_COLORS.map((color, i) => (
          <g key={color}>
            <circle className='palm-map-signal-lamp' cx={lampX(i)} cy={y} r={LAMP_RADIUS} fill={color} />
            <path
              className='palm-map-signal-visor'
              d={`M${lampX(i) - LAMP_RADIUS - 0.8},${y} A${LAMP_RADIUS + 0.8},${LAMP_RADIUS + 0.8} 0 0 1 ${lampX(i) + LAMP_RADIUS + 0.8},${y}`}
            />
          </g>
        ))}
      </g>
    ))}

    <rect className='palm-map-road' x={20} y={STATION_Y} width={WIDTH - 40} height={ROAD_HEIGHT} />
    <text className='palm-map-road-label' x={WIDTH / 2} y={STATION_Y + ROAD_HEIGHT / 2}>
      武蔵小山駅
    </text>

    {marked.map((shop) => {
      const { x, y } = markerPoint(shops, shop);
      // 店名は道の側へ伸ばす。左列なら右向き、右列なら左向き。
      const toRight = shop.side === 'left';
      return (
        <g key={shop.id}>
          <circle className='palm-map-marker' cx={x} cy={y} r={7} />
          <text
            className='palm-map-marker-label'
            x={toRight ? x + 11 : x - 11}
            y={y}
            textAnchor={toRight ? 'start' : 'end'}
          >
            {shop.name}
          </text>
        </g>
      );
    })}
  </svg>
);
