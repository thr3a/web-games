import type { Shop } from './model';
import csv from './shopmap.csv?raw';

const BLOCKS = ['1', '2', '3', '4'];

export const parseShops = (text: string): Shop[] => {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const header = headerLine.split(',');
  const col = (name: string): number => header.indexOf(name);

  // 区画ごとの行順カウンタ。order 列が空なら行順（include=FALSE の行も含めて数える）を使う。
  const counters = new Map<string, number>();

  return lines.flatMap((line) => {
    const cells = line.split(',');
    const block = cells[col('block')];
    // PALM-G は使わない
    if (!BLOCKS.includes(block)) return [];
    const side = cells[col('side')];
    if (side !== 'left' && side !== 'right') return [];
    const key = `${block}${side}`;
    const rowOrder = (counters.get(key) ?? 0) + 1;
    counters.set(key, rowOrder);
    if (cells[col('include')] !== 'TRUE') return [];
    const orderText = cells[col('order')];
    return [
      {
        id: Number(cells[col('id')]),
        block: Number(block),
        side,
        order: orderText ? Number(orderText) : rowOrder,
        name: cells[col('display_name')] || cells[col('name')],
        floor: Number(cells[col('floor')] || '1')
      }
    ];
  });
};

export const SHOPS: Shop[] = parseShops(csv);
