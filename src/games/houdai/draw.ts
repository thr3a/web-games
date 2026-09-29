import type Phaser from 'phaser';
import { type Enemy, type GameModel, RULES, WORLD } from './model';

// DESIGN.md のカラートークンを Canvas 用に数値化したもの。
export const COLORS = {
  ink: 0x1f1a2e,
  paper: 0xffffff,
  cream: 0xfff6e8,
  yellow: 0xfbcd3f,
  pink: 0xff5a8a,
  sky: 0x8fd8f5,
  hillBack: 0x7fdc8f,
  hillFront: 0x3cc47c,
  ground: 0xffe49a,
  sun: 0xffefb0
};

const SUN = { x: 302, y: 200, radius: 30 };

// Phaser の Text 用（CSS カラー文字列）。
export const TEXT_COLORS = {
  ink: '#1f1a2e',
  paper: '#ffffff',
  yellow: '#fbcd3f',
  pink: '#ff5a8a'
};

export const FONT_FAMILY =
  '"Hiragino Maru Gothic ProN", "M PLUS Rounded 1c", "Arial Rounded MT Bold", "Hiragino Sans", Meiryo, sans-serif';

// 各パレットは [地色, ハイライト, 影色]。被弾ごとに次のパレットへ切り替わる。
export const PALETTES = [
  [0xff5a8a, 0xff9ab8, 0xe0457b],
  [0x2ec4b6, 0x7fe6dc, 0x1fa396],
  [0x9b6bff, 0xc3a6ff, 0x7c4ce0],
  [0xfbcd3f, 0xffe58a, 0xe8a91c],
  [0x3fa9ff, 0x8fcfff, 0x2585e0]
];

const LINE = 4;

type Graphics = Phaser.GameObjects.Graphics;
type Point = { x: number; y: number };

const tracePolygon = (graphics: Graphics, points: Point[]) => {
  const first = points[0];
  if (!first) return;
  graphics.beginPath();
  graphics.moveTo(first.x, first.y);
  for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
  graphics.closePath();
};

const polygon = (graphics: Graphics, points: Point[], color: number, alpha = 1) => {
  graphics.fillStyle(color, alpha);
  tracePolygon(graphics, points);
  graphics.fillPath();
};

// ベタ塗り + 濃紺の太フチでシール風に描く。
const sticker = (graphics: Graphics, points: Point[], color: number, line = LINE) => {
  polygon(graphics, points, color);
  graphics.lineStyle(line, COLORS.ink);
  tracePolygon(graphics, points);
  graphics.strokePath();
};

const stickerRect = (
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: number
) => {
  graphics.fillStyle(color).fillRoundedRect(x, y, width, height, radius);
  graphics.lineStyle(LINE, COLORS.ink).strokeRoundedRect(x, y, width, height, radius);
};

export const drawSky = (graphics: Graphics) => {
  graphics.fillStyle(COLORS.sky).fillRect(0, 0, WORLD.width, WORLD.height);
  // 半透明の白い円を外側から重ね、太陽に近いほど明るくなる光のにじみを作る。
  for (let i = 0; i < 12; i++) {
    graphics.fillStyle(COLORS.paper, 0.05).fillCircle(SUN.x, SUN.y, SUN.radius + 36 - i * 3);
  }
  graphics.fillStyle(COLORS.sun).fillCircle(SUN.x, SUN.y, SUN.radius);
};

const hill = (graphics: Graphics, points: Point[], color: number) => {
  polygon(
    graphics,
    points.map((point) => ({ x: point.x + 4, y: point.y + 5 })),
    COLORS.ink
  );
  sticker(graphics, points, color);
};

export const drawLandscape = (graphics: Graphics, time: number) => {
  graphics.clear();
  for (let i = 0; i < 4; i++) {
    const x = ((i * 143 + time * 5) % 570) - 90;
    const y = 167 + (i % 3) * 108;
    // 雲は 2 つの角丸を重ね、内側に入った線を白で塗りつぶして 1 つの輪郭に見せる。
    graphics.fillStyle(COLORS.ink);
    graphics.fillRoundedRect(x + 4, y + 4, 70, 14, 7);
    graphics.fillRoundedRect(x + 22, y - 4, 34, 16, 8);
    graphics.lineStyle(3, COLORS.ink);
    graphics.fillStyle(COLORS.paper).fillRoundedRect(x, y, 70, 14, 7);
    graphics.strokeRoundedRect(x, y, 70, 14, 7);
    graphics.fillStyle(COLORS.paper).fillRoundedRect(x + 18, y - 8, 34, 16, 8);
    graphics.strokeRoundedRect(x + 18, y - 8, 34, 16, 8);
    graphics.fillStyle(COLORS.paper).fillRect(x + 16, y + 1.5, 38, 8);
  }
  // 山は固定表示にする（動くのは雲だけ）。
  for (let tile = -1; tile < 2; tile++) {
    const x = tile * 500;
    hill(
      graphics,
      [
        { x, y: 620 },
        { x: x + 105, y: 465 },
        { x: x + 216, y: 583 },
        { x: x + 335, y: 496 },
        { x: x + 500, y: 605 },
        { x: x + 500, y: 710 },
        { x, y: 710 }
      ],
      COLORS.hillBack
    );
  }
  for (let tile = -1; tile < 2; tile++) {
    const x = tile * 500;
    hill(
      graphics,
      [
        { x, y: 644 },
        { x: x + 140, y: 571 },
        { x: x + 285, y: 647 },
        { x: x + 404, y: 579 },
        { x: x + 500, y: 639 },
        { x: x + 500, y: 723 },
        { x, y: 723 }
      ],
      COLORS.hillFront
    );
  }
  graphics.fillStyle(COLORS.ground).fillRect(0, WORLD.dangerY, WORLD.width, WORLD.height - WORLD.dangerY);
  graphics.lineStyle(LINE, COLORS.ink).lineBetween(0, WORLD.dangerY, WORLD.width, WORLD.dangerY);
};

export const drawEnemy = (graphics: Graphics, enemy: Enemy) => {
  const colors = PALETTES[enemy.palette];
  const points = Array.from({ length: enemy.sides }, (_, i) => {
    const angle = (i / enemy.sides) * Math.PI * 2 + enemy.rotation;
    return { x: enemy.x + Math.cos(angle) * enemy.radius, y: enemy.y + Math.sin(angle) * enemy.radius };
  });
  polygon(
    graphics,
    points.map((point) => ({ x: point.x + 4, y: point.y + 6 })),
    COLORS.ink
  );
  polygon(graphics, points, colors[0]);
  // 下半分の辺に影色の面を重ねて、ベタ塗りのまま立体感を出す。
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if ((a.y + b.y) / 2 <= enemy.y) continue;
    graphics.fillStyle(colors[2]);
    graphics.fillTriangle(enemy.x, enemy.y, a.x, a.y, b.x, b.y);
  }
  graphics
    .fillStyle(colors[1])
    .fillCircle(enemy.x - enemy.radius * 0.42, enemy.y - enemy.radius * 0.42, enemy.radius * 0.13);
  graphics.lineStyle(LINE, COLORS.ink);
  tracePolygon(graphics, points);
  graphics.strokePath();
  if (enemy.hitFlash > 0) polygon(graphics, points, COLORS.paper, 0.6);
};

export const drawCannon = (graphics: Graphics, model: GameModel) => {
  const x = model.cannonX;
  const recoil = model.firing ? Math.max(0, model.shotCooldown / RULES.shotInterval - 0.5) * 9 : 0;
  const y = WORLD.cannonY + recoil;
  graphics.fillStyle(COLORS.ink, 0.25).fillEllipse(x + 4, WORLD.cannonY + 22, 93, 15);
  graphics.fillStyle(COLORS.ink).fillRoundedRect(x - 13, y - 45, 32, 53, 6);
  stickerRect(graphics, x - 16, y - 49, 32, 53, 6, COLORS.pink);
  graphics.fillStyle(COLORS.paper).fillRoundedRect(x - 10, y - 42, 6, 26, 3);
  stickerRect(graphics, x - 20, y - 55, 40, 13, 5, COLORS.yellow);
  graphics.fillStyle(COLORS.ink).fillRoundedRect(x - 25, y - 12, 58, 29, 12);
  stickerRect(graphics, x - 29, y - 16, 58, 29, 12, COLORS.yellow);
  for (const wheelX of [x - 24, x + 24]) {
    graphics.fillStyle(COLORS.ink).fillCircle(wheelX, WORLD.cannonY + 9, 15);
    graphics.fillStyle(COLORS.paper).fillCircle(wheelX, WORLD.cannonY + 9, 6);
    graphics.lineStyle(3, COLORS.ink).strokeCircle(wheelX, WORLD.cannonY + 9, 6);
  }
  if (!model.firing || model.shotCooldown < RULES.shotInterval - 0.045) return;
  sticker(
    graphics,
    [
      { x: x - 12, y: y - 57 },
      { x: x - 6, y: y - 68 },
      { x, y: y - 86 },
      { x: x + 6, y: y - 68 },
      { x: x + 12, y: y - 57 }
    ],
    COLORS.yellow,
    3
  );
  graphics.fillStyle(COLORS.paper).fillEllipse(x, y - 66, 6, 14);
};

export const drawObjects = (graphics: Graphics, model: GameModel, time: number) => {
  graphics.clear();
  for (const bullet of model.bullets) {
    graphics.fillStyle(COLORS.yellow).fillRoundedRect(bullet.x - 4, bullet.y - 8, 8, 17, 4);
    graphics.lineStyle(3, COLORS.ink).strokeRoundedRect(bullet.x - 4, bullet.y - 8, 8, 17, 4);
  }
  for (const enemy of model.enemies) drawEnemy(graphics, enemy);
  for (const coin of model.drops) {
    const width = 9 + Math.abs(Math.cos(time * 7)) * 15;
    graphics.fillStyle(COLORS.ink).fillEllipse(coin.x + 3, coin.y + 4, width, 26);
    graphics.fillStyle(COLORS.yellow).fillEllipse(coin.x, coin.y, width, 26);
    graphics.lineStyle(3, COLORS.ink).strokeEllipse(coin.x, coin.y, width, 26);
    graphics.lineStyle(3, COLORS.ink).lineBetween(coin.x, coin.y - 5, coin.x, coin.y + 5);
  }
  drawCannon(graphics, model);
};
