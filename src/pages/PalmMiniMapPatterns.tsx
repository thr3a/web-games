import { type Section, type Shop, sectionLabel } from '../games/palm/model';
import './PalmMiniMap.css';
import './PalmMiniMapPatterns.css';

// ミニマップを小さくする案の試作。PalmDebug で現状の地図と並べて見比べる。

const AREA_COLORS: Record<number, { fill: string; stroke: string }> = {
  1: { fill: '#74c0fc', stroke: '#1c7ed6' },
  2: { fill: '#8ce99a', stroke: '#37b24d' },
  3: { fill: '#ffe066', stroke: '#f59f00' },
  4: { fill: '#ffc078', stroke: '#f76707' }
};

const AREAS = [1, 2, 3, 4];
const SIDES: Shop['side'][] = ['left', 'right'];

// 各エリアの長さ(m)。横向きの地図ではこの比率で幅を割り振る。
const AREA_LENGTHS: Record<number, number> = { 1: 120, 2: 100, 3: 120, 4: 210 };
const TOTAL_LENGTH = 550;

const sectionSize = (shops: Shop[], area: number, side: Shop['side']): number =>
  Math.max(...shops.filter((shop) => shop.area === area && shop.side === side).map((shop) => shop.order));

// 区画の中で駅側から何割の位置か（店の中央）。
const ratioInSection = (shops: Shop[], shop: Shop): number =>
  (shop.order - 0.5) / sectionSize(shops, shop.area, shop.side);

export type SectionState = 'correct' | 'wrong';

type Props = {
  shops: Shop[];
  marked: Shop[];
  hideLabels?: boolean; // 点だけ出して店名は出さない（ここは何の店？の出題用）
  onSectionSelect?: (section: Section) => void; // 渡すと区画をタップできるようにする（区画当て用）
  sectionStates?: { section: Section; state: SectionState }[]; // 答え合わせで区画を色分けする
};

// ---------- 横向き（駅が左、中原街道が右。紙の地図と同じ向き） ----------

const H_WIDTH = 340;
const H_ROAD = 24;
const H_START = H_ROAD + 4;
const H_END = H_WIDTH - H_ROAD - 4;
const H_CROSS = 5;

type HorizontalLayout = {
  row: number; // 片側の列の高さ
  street: number; // アーケード（道）の高さ
  pad: number; // 店名を出すための上下の余白
  fontSize: number;
};

// エリアの左端と幅。横道の幅を除いた残りを長さの比で割り振る。
const areaSpan = (area: number): { x: number; w: number } => {
  const usable = H_END - H_START - H_CROSS * 3;
  let x = H_START;
  for (const b of AREAS) {
    const w = (AREA_LENGTHS[b] / TOTAL_LENGTH) * usable;
    if (b === area) return { x, w };
    x += w + H_CROSS;
  }
  return { x, w: 0 };
};

// 店名の幅のおおよそ。全角は 1 文字 = fontSize、半角は 0.6 倍として数える。
const textWidth = (text: string, fontSize: number): number =>
  [...text].reduce((sum, char) => sum + (char.charCodeAt(0) < 0x80 ? 0.6 : 1) * fontSize, 0);

type PlacedLabel = { shop: Shop; x: number; textX: number; anchor: 'start' | 'middle' | 'end'; lane: number };

// 店名の置き場所を決める。基本は点の真上（真下）に中央寄せし、地図からはみ出す場合は端に寄せる。
// 同じ側で先に置いた店名と横に重なる場合は、1 段ずつ外側へずらす。
const placeLabels = (points: { shop: Shop; x: number }[], fontSize: number): PlacedLabel[] => {
  const placed: (PlacedLabel & { from: number; to: number })[] = [];
  const sorted = [...points].sort((a, b) => a.x - b.x);
  for (const { shop, x } of sorted) {
    const width = textWidth(shop.name, fontSize);
    const from = Math.min(Math.max(x - width / 2, 2), H_WIDTH - 2 - width);
    const to = from + width;
    const anchor = from === 2 ? 'start' : to === H_WIDTH - 2 ? 'end' : 'middle';
    const textX = anchor === 'start' ? from : anchor === 'end' ? to : x;
    const sameSide = placed.filter((other) => other.shop.side === shop.side);
    let lane = 0;
    while (sameSide.some((other) => other.lane === lane && other.from < to + 4 && from < other.to + 4)) lane++;
    placed.push({ shop, x, textX, anchor, lane, from, to });
  }
  return placed;
};

const HorizontalMap = ({
  shops,
  marked,
  hideLabels,
  onSectionSelect,
  sectionStates,
  layout
}: Props & { layout: HorizontalLayout }) => {
  const laneHeight = layout.fontSize + 3;
  const labels = placeLabels(
    marked.map((shop) => {
      const { x: areaX, w } = areaSpan(shop.area);
      return { shop, x: areaX + ratioInSection(shops, shop) * w };
    }),
    layout.fontSize
  );
  // 店名が何段に重なったかに合わせて、上下の余白を広げる。
  const lanesOf = (side: Shop['side']): number =>
    hideLabels ? 0 : Math.max(0, ...labels.filter((label) => label.shop.side === side).map((label) => label.lane));
  const topPad = layout.pad + lanesOf('left') * laneHeight;
  const bottomPad = layout.pad + lanesOf('right') * laneHeight;

  const leftY = topPad;
  const streetY = leftY + layout.row;
  const rightY = streetY + layout.street;
  const height = rightY + layout.row + bottomPad;
  const rowY = (side: Shop['side']): number => (side === 'left' ? leftY : rightY);
  // 左側（上の列）は上へ、右側（下の列）は下へ店名を出す。段が増えるほど地図から離れる。
  const labelYOf = (shop: Shop, lane: number): number =>
    shop.side === 'left'
      ? topPad - layout.pad / 2 - lane * laneHeight
      : height - bottomPad + layout.pad / 2 + lane * laneHeight;

  return (
    <svg className='palm-map' viewBox={`0 0 ${H_WIDTH} ${height}`} role='img' aria-label='パルム商店街のミニマップ'>
      <rect className='palm-map-road' x={0} y={leftY} width={H_ROAD} height={layout.row * 2 + layout.street} />
      <text className='palm-pattern-road-v' x={H_ROAD / 2} y={streetY + layout.street / 2}>
        武蔵小山駅
      </text>
      <rect
        className='palm-map-road'
        x={H_WIDTH - H_ROAD}
        y={leftY}
        width={H_ROAD}
        height={layout.row * 2 + layout.street}
      />
      <text className='palm-pattern-road-v' x={H_WIDTH - H_ROAD / 2} y={streetY + layout.street / 2}>
        中原街道
      </text>
      <rect className='palm-map-street' x={H_ROAD} y={streetY} width={H_WIDTH - H_ROAD * 2} height={layout.street} />

      {AREAS.map((area) => {
        const { x, w } = areaSpan(area);
        return (
          <g key={area}>
            {SIDES.map((side) => {
              const state = sectionStates?.find(
                (item) => item.section.area === area && item.section.side === side
              )?.state;
              const rect = (
                <rect
                  key={side}
                  className={`palm-map-section${state ? ` is-${state}` : ''}`}
                  x={x}
                  y={rowY(side)}
                  width={w}
                  height={layout.row}
                  fill={AREA_COLORS[area].fill}
                  stroke={AREA_COLORS[area].stroke}
                />
              );
              if (!onSectionSelect) return rect;
              const select = () => onSectionSelect({ area, side });
              return (
                // SVG の中では <button> を置けないので、g に role='button' を付けてキーボードでも押せるようにする。
                // biome-ignore lint/a11y/useSemanticElements: SVG 内では <button> を使えないため
                <g
                  key={side}
                  className='palm-map-section-button'
                  role='button'
                  tabIndex={0}
                  aria-label={sectionLabel({ area, side })}
                  onClick={select}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    select();
                  }}
                >
                  {rect}
                </g>
              );
            })}
            {layout.street >= 12 && (
              <text className='palm-pattern-area-h' x={x + w / 2} y={streetY + layout.street / 2}>
                PALM-{area}
              </text>
            )}
          </g>
        );
      })}

      {/* 引き出し線と点を先に、店名を後に描く。店名の白い縁取りが他の店の線の上に来るようにするため */}
      {labels.map(({ shop, x, lane }) => {
        const y = rowY(shop.side) + layout.row / 2;
        return (
          <g key={shop.id}>
            {!hideLabels && <line className='palm-pattern-leader' x1={x} y1={y} x2={x} y2={labelYOf(shop, lane)} />}
            <circle className='palm-map-marker' cx={x} cy={y} r={Math.min(6, layout.row / 2)} />
          </g>
        );
      })}
      {!hideLabels &&
        labels.map(({ shop, textX, anchor, lane }) => (
          <text
            key={shop.id}
            className='palm-map-marker-label'
            x={textX}
            y={labelYOf(shop, lane)}
            textAnchor={anchor}
            style={{ fontSize: layout.fontSize }}
          >
            {shop.name}
          </text>
        ))}
    </svg>
  );
};

// C: 紙の地図と同じ横向き。上の列が左側、下の列が右側。エリアの幅は実際の長さの比。
export const HorizontalBandMap = (props: Props) => (
  <HorizontalMap {...props} layout={{ row: 30, street: 18, pad: 20, fontSize: 12 }} />
);
