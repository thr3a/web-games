import type { Shop } from './model';
import csv from './shopmap.csv?raw';

const AREAS = ['1', '2', '3', '4'];

export const parseShops = (text: string): Shop[] => {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const header = headerLine.split(',');
  const col = (name: string): number => header.indexOf(name);

  // 区画ごとの行順カウンタ。order 列が空なら行順（include=FALSE の行も含めて数える）を使う。
  const counters = new Map<string, number>();

  return lines.flatMap((line) => {
    const cells = line.split(',');
    const area = cells[col('area')];
    // PALM-G は使わない
    if (!AREAS.includes(area)) return [];
    const side = cells[col('side')];
    if (side !== 'left' && side !== 'right') return [];
    const key = `${area}${side}`;
    const rowOrder = (counters.get(key) ?? 0) + 1;
    counters.set(key, rowOrder);
    if (cells[col('include')] !== 'TRUE') return [];
    const orderText = cells[col('order')];
    return [
      {
        id: Number(cells[col('id')]),
        area: Number(area),
        side,
        order: orderText ? Number(orderText) : rowOrder,
        name: cells[col('display_name')] || cells[col('name')],
        floor: Number(cells[col('floor')] || '1')
      }
    ];
  });
};

export const SHOPS: Shop[] = parseShops(csv);
