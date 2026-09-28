import type Phaser from 'phaser';
import { type Enemy, type GameModel, RULES, WORLD } from './model';

export const PALETTES = [
  [0xee826b, 0xffa38a, 0xd96759],
  [0x5dafaa, 0x8accc0, 0x418e8e],
  [0xa08ac3, 0xc0a8da, 0x826ca8],
  [0xe9b64f, 0xffd678, 0xce973a],
  [0x74a5ca, 0xa0cce5, 0x5789b1]
];

type Graphics = Phaser.GameObjects.Graphics;

const tracePolygon = (graphics: Graphics, points: { x: number; y: number }[]) => {
  const first = points[0];
  if (!first) return;
  graphics.beginPath();
  graphics.moveTo(first.x, first.y);
  for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
  graphics.closePath();
};

const polygon = (graphics: Graphics, points: { x: number; y: number }[], color: number, alpha = 1) => {
  graphics.fillStyle(color, alpha);
  tracePolygon(graphics, points);
  graphics.fillPath();
};

export const drawSky = (graphics: Graphics) => {
  graphics.fillStyle(0xe4f0e9).fillRect(0, 0, WORLD.width, WORLD.height);
  for (let i = 0; i < 45; i++) {
    graphics.fillStyle(0xfff6df, i / 60).fillRect(0, 190 + i * 11, WORLD.width, 11);
  }
  graphics.fillStyle(0xfff8db, 0.55).fillCircle(302, 220, 66);
  graphics.fillStyle(0xfff9e6).fillCircle(302, 220, 45);
  graphics.lineStyle(1, 0xffffff, 0.5).strokeCircle(302, 220, 55);
};

export const drawLandscape = (graphics: Graphics, time: number) => {
  graphics.clear();
  for (let i = 0; i < 4; i++) {
    const x = ((i * 143 + time * 5) % 570) - 90;
    const y = 167 + (i % 3) * 108;
    graphics.fillStyle(0xffffff, 0.43);
    graphics.fillRoundedRect(x, y, 70, 10, 5);
    graphics.fillRoundedRect(x + 18, y - 6, 34, 12, 6);
  }
  const offset = (time * 5) % 500;
  for (let tile = -1; tile < 2; tile++) {
    const x = tile * 500 - offset;
    polygon(
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
      0xbcd5bf
    );
    polygon(
      graphics,
      [
        { x, y: 620 },
        { x: x + 105, y: 465 },
        { x: x + 126, y: 624 }
      ],
      0xd0dfc6
    );
    polygon(
      graphics,
      [
        { x: x + 216, y: 583 },
        { x: x + 335, y: 496 },
        { x: x + 302, y: 647 }
      ],
      0xcbdcc3
    );
    polygon(
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
      0x8ab8a3
    );
    polygon(
      graphics,
      [
        { x, y: 644 },
        { x: x + 140, y: 571 },
        { x: x + 112, y: 699 }
      ],
      0xa9c8ae
    );
    polygon(
      graphics,
      [
        { x: x + 285, y: 647 },
        { x: x + 404, y: 579 },
        { x: x + 447, y: 694 }
      ],
      0x9dc1a7
    );
  }
  graphics.fillStyle(0xf1dfaf).fillRect(0, WORLD.dangerY, WORLD.width, WORLD.height - WORLD.dangerY);
  graphics.fillStyle(0xf8e9c7).fillRect(0, WORLD.dangerY, WORLD.width, 8);
  polygon(
    graphics,
    [
      { x: 0, y: 732 },
      { x: 133, y: 695 },
      { x: 258, y: 780 },
      { x: 0, y: 780 }
    ],
    0xeadaaa
  );
  polygon(
    graphics,
    [
      { x: 270, y: 780 },
      { x: 356, y: 701 },
      { x: 390, y: 722 },
      { x: 390, y: 780 }
    ],
    0xf6e5bd
  );
  graphics.lineStyle(1.5, 0x4e7965, 0.3);
  for (let x = 14; x < WORLD.width; x += 14) graphics.lineBetween(x, WORLD.dangerY, x + 5, WORLD.dangerY);
  for (const x of [35, 94, 318, 361]) {
    graphics.lineStyle(2, 0xafba8a, 0.7);
    graphics.lineBetween(x, 690, x - 3, 684);
    graphics.lineBetween(x, 690, x + 4, 682);
  }
};

export const drawEnemy = (graphics: Graphics, enemy: Enemy) => {
  const colors = PALETTES[enemy.palette];
  const points = Array.from({ length: enemy.sides }, (_, i) => {
    const angle = (i / enemy.sides) * Math.PI * 2 + enemy.rotation;
    return { x: enemy.x + Math.cos(angle) * enemy.radius, y: enemy.y + Math.sin(angle) * enemy.radius };
  });
  polygon(
    graphics,
    points.map((point) => ({ x: point.x + 2, y: point.y + 5 })),
    0x45645b,
    0.12
  );
  polygon(graphics, points, colors[0]);
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    graphics.fillStyle(colors[i % 3], 0.95);
    graphics.fillTriangle(enemy.x - enemy.radius * 0.22, enemy.y - enemy.radius * 0.27, a.x, a.y, b.x, b.y);
  }
  tracePolygon(graphics, points);
  graphics.lineStyle(1.5, 0xffffff, 0.27).strokePath();
  if (enemy.hitFlash > 0) polygon(graphics, points, 0xffffff, 0.5);
};

export const drawCannon = (graphics: Graphics, model: GameModel) => {
  const x = model.cannonX;
  const recoil = model.firing ? Math.max(0, model.shotCooldown / RULES.shotInterval - 0.5) * 9 : 0;
  const y = WORLD.cannonY + recoil;
  graphics.fillStyle(0x4a5947, 0.16).fillEllipse(x + 2, WORLD.cannonY + 20, 93, 17);
  graphics.fillStyle(0x252d30).fillRoundedRect(x - 16, y - 49, 32, 53, 5);
  graphics.fillStyle(0x454f50).fillRect(x - 11, y - 43, 8, 31);
  graphics.fillStyle(0x171f23).fillRoundedRect(x - 20, y - 53, 40, 12, 4);
  graphics.fillStyle(0x5d6866).fillRect(x - 14, y - 50, 28, 3);
  graphics.fillStyle(0x313b3d).fillRoundedRect(x - 29, y - 16, 58, 29, 11);
  graphics.fillStyle(0x4c5856).fillRoundedRect(x - 22, y - 13, 44, 8, 4);
  for (const wheelX of [x - 24, x + 24]) {
    graphics.fillStyle(0x20292c).fillCircle(wheelX, WORLD.cannonY + 9, 15);
    graphics.lineStyle(2, 0x53605b).strokeCircle(wheelX, WORLD.cannonY + 9, 10);
    graphics.fillStyle(0x7c8880).fillCircle(wheelX, WORLD.cannonY + 9, 3);
  }
  graphics.fillStyle(0xedbc61).fillCircle(x, y - 3, 5);
  if (!model.firing || model.shotCooldown < RULES.shotInterval - 0.045) return;
  polygon(
    graphics,
    [
      { x: x - 10, y: y - 57 },
      { x: x - 5, y: y - 66 },
      { x, y: y - 81 },
      { x: x + 5, y: y - 66 },
      { x: x + 10, y: y - 57 }
    ],
    0xffd779
  );
  graphics.fillStyle(0xfffbe8).fillEllipse(x, y - 64, 8, 18);
};

export const drawObjects = (graphics: Graphics, model: GameModel, time: number) => {
  graphics.clear();
  for (const bullet of model.bullets) {
    graphics.fillStyle(0xffd377, 0.3).fillRoundedRect(bullet.x - 4, bullet.y, 8, 25, 4);
    graphics.fillStyle(0xd59a45).fillRoundedRect(bullet.x - 3, bullet.y - 7, 6, 14, 3);
    graphics.fillStyle(0xfffdf1).fillRoundedRect(bullet.x - 1.5, bullet.y - 6, 3, 9, 1.5);
  }
  for (const enemy of model.enemies) drawEnemy(graphics, enemy);
  for (const coin of model.drops) {
    const width = 7 + Math.abs(Math.cos(time * 7)) * 13;
    graphics.fillStyle(0xc18b32).fillEllipse(coin.x, coin.y + 2, width, 24);
    graphics.fillStyle(0xffd56e).fillEllipse(coin.x, coin.y, width, 24);
    graphics.lineStyle(2, 0xfff1b1).strokeEllipse(coin.x, coin.y, width - 5, 18);
    graphics.lineStyle(2, 0xc18b32).lineBetween(coin.x, coin.y - 5, coin.x, coin.y + 5);
  }
  drawCannon(graphics, model);
};
