import Phaser from 'phaser';
import { drawEnemy, drawLandscape, drawObjects, drawSky, PALETTES } from './draw';
import {
  createModel,
  type Enemy,
  type GameEvent,
  type GameSnapshot,
  getPhase,
  moveCannon,
  pauseModel,
  resumeModel,
  snapshot,
  stepModel,
  WORLD
} from './model';

const PHASE_LABELS = ['', 'PHASE 2 突入！', 'ラストスパート！'];

type Effect = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
};
type FloatingText = { object: Phaser.GameObjects.Text; life: number };
export type GameController = { start: () => void; pause: () => void; resume: () => void; destroy: () => void };

export const createHoudaiGame = (parent: HTMLElement, onChange: (state: GameSnapshot) => void): GameController => {
  const scene = new Phaser.Scene('houdai');
  let model = createModel();
  let graphics: Phaser.GameObjects.Graphics;
  let landscape: Phaser.GameObjects.Graphics;
  let effectsGraphics: Phaser.GameObjects.Graphics;
  let effects: Effect[] = [];
  let floatingTexts: FloatingText[] = [];
  const labels = new Map<number, Phaser.GameObjects.Text>();
  let activePointer: number | null = null;
  let dragging = false;
  let elapsed = 0;
  let accumulator = 0;
  let lastSnapshot = '';
  let damageFlash = 0;
  let phaseFlash = 0;
  let lastPhase = 0;
  let ready = false;

  const publish = () => {
    const state = snapshot(model);
    const serialized = JSON.stringify(state);
    if (serialized === lastSnapshot) return;
    lastSnapshot = serialized;
    onChange(state);
  };

  const release = () => {
    activePointer = null;
    dragging = false;
    model.firing = false;
  };
  const pause = () => {
    release();
    pauseModel(model);
    publish();
  };
  const handleVisibility = () => {
    if (document.hidden) pause();
  };
  const orientation = window.matchMedia('(orientation: landscape)');
  const handleOrientation = () => {
    if (orientation.matches) pause();
  };

  const addEffect = (event: GameEvent) => {
    const color = event.kind === 'heal' ? 0x6fa58c : PALETTES[event.palette][0];
    const count = event.kind === 'hit' ? 3 : event.kind === 'split' ? 8 : 15;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 135;
      const life = event.kind === 'hit' ? 0.18 : 0.45 + Math.random() * 0.3;
      effects.push({
        x: event.x,
        y: event.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        color,
        size: event.kind === 'hit' ? 2 : 3 + Math.random() * 5
      });
    }
    if (event.kind === 'hit' || event.kind === 'split') return;
    if (event.kind === 'damage') damageFlash = 0.3;
    const content =
      event.kind === 'destroy'
        ? `+${event.value}`
        : event.kind === 'heal'
          ? `HP +${event.value}`
          : `−${event.value} HP`;
    const object = scene.add
      .text(event.x, event.y - 26, content, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '21px',
        fontStyle: 'bold',
        color: event.kind === 'damage' ? '#b94b43' : '#35594f',
        stroke: '#fff9e6',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(5);
    floatingTexts.push({ object, life: 0.85 });
  };

  const previews: Enemy[] = [
    {
      id: -1,
      x: 67,
      y: 229,
      anchorX: 67,
      hp: 5,
      maxHp: 5,
      radius: 34,
      speed: 0,
      phase: 0,
      rotation: 0.3,
      sides: 6,
      palette: 0,
      hitFlash: 0,
      vx: 0,
      vy: 0,
      reward: 0
    },
    {
      id: -2,
      x: 322,
      y: 398,
      anchorX: 322,
      hp: 3,
      maxHp: 3,
      radius: 32,
      speed: 0,
      phase: 2,
      rotation: 0,
      sides: 5,
      palette: 2,
      hitFlash: 0,
      vx: 0,
      vy: 0,
      reward: 0
    }
  ];

  const drawLabels = (enemies: Enemy[]) => {
    for (const [id, label] of labels) {
      if (enemies.some((enemy) => enemy.id === id)) continue;
      label.destroy();
      labels.delete(id);
    }
    for (const enemy of enemies) {
      let label = labels.get(enemy.id);
      if (!label) {
        label = scene.add
          .text(enemy.x, enemy.y, String(enemy.hp), {
            fontFamily: 'Arial, sans-serif',
            fontSize: '27px',
            fontStyle: 'bold',
            color: '#ffffff',
            shadow: { offsetX: 0, offsetY: 2, color: '#00000033', blur: 0, fill: true }
          })
          .setOrigin(0.5)
          .setDepth(3);
        labels.set(enemy.id, label);
      }
      label
        .setPosition(enemy.x, enemy.y)
        .setText(String(enemy.hp))
        .setFontSize(Math.round(enemy.radius * 0.8));
    }
  };

  Object.assign(scene, {
    create: () => {
      drawSky(scene.add.graphics());
      landscape = scene.add.graphics();
      graphics = scene.add.graphics().setDepth(2);
      effectsGraphics = scene.add.graphics().setDepth(4);
      scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (model.status !== 'playing' || activePointer !== null || pointer.y < 125) return;
        activePointer = pointer.id;
        dragging = pointer.y >= WORLD.height * 0.55;
        model.firing = true;
        if (dragging) moveCannon(model, pointer.x);
      });
      scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
        if (pointer.id !== activePointer || !pointer.isDown || !dragging) return;
        moveCannon(model, pointer.x);
      });
      const pointerUp = (pointer: Phaser.Input.Pointer) => {
        if (pointer.id === activePointer) release();
      };
      scene.input.on('pointerup', pointerUp);
      scene.input.on('pointerupoutside', pointerUp);
      scene.input.on('gameout', release);
      ready = true;
      publish();
    },
    update: (_time: number, delta: number) => {
      if (!ready || model.status === 'paused') return;
      const dt = Math.min(delta / 1000, 0.05);
      elapsed += dt;
      // 固定刻みにして、端末のリフレッシュレートによる連射速度の差をなくす。
      accumulator += dt;
      while (accumulator >= 1 / 120) {
        for (const event of stepModel(model, 1 / 120)) addEffect(event);
        accumulator -= 1 / 120;
      }
      if (model.status === 'playing') {
        const phase = getPhase(model.elapsed);
        if (phase !== lastPhase) {
          lastPhase = phase;
          phaseFlash = 0.35;
          const object = scene.add
            .text(WORLD.width / 2, WORLD.height * 0.34, PHASE_LABELS[phase] ?? '', {
              fontFamily: 'Arial, sans-serif',
              fontSize: '30px',
              fontStyle: 'bold',
              color: '#fff4d6',
              stroke: '#8a5a2a',
              strokeThickness: 6
            })
            .setOrigin(0.5)
            .setDepth(6);
          floatingTexts.push({ object, life: 1.2 });
        }
      }
      drawLandscape(landscape, elapsed);
      drawObjects(graphics, model, elapsed);
      if (model.status === 'ready') {
        for (const enemy of previews) {
          enemy.rotation += dt * 0.13;
          enemy.y += Math.cos(elapsed + enemy.phase) * dt * 5;
          drawEnemy(graphics, enemy);
        }
      }
      drawLabels(model.status === 'ready' ? previews : model.enemies);
      effectsGraphics.clear();
      for (const effect of effects) {
        effect.life -= dt;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        effect.vy += dt * 120;
        effectsGraphics.fillStyle(effect.color, Math.max(0, effect.life / effect.maxLife));
        effectsGraphics.fillTriangle(
          effect.x,
          effect.y - effect.size,
          effect.x - effect.size,
          effect.y + effect.size / 2,
          effect.x + effect.size,
          effect.y + effect.size
        );
      }
      effects = effects.filter((effect) => effect.life > 0);
      for (const text of floatingTexts) {
        text.life -= dt;
        text.object.y -= dt * 35;
        text.object.setAlpha(Math.max(0, Math.min(1, text.life * 2)));
        if (text.life <= 0) text.object.destroy();
      }
      floatingTexts = floatingTexts.filter((text) => text.life > 0);
      if (damageFlash > 0) {
        damageFlash -= dt;
        effectsGraphics.fillStyle(0xe77465, Math.max(0, damageFlash * 0.7)).fillRect(0, 0, WORLD.width, WORLD.height);
      }
      if (phaseFlash > 0) {
        phaseFlash -= dt;
        effectsGraphics.fillStyle(0xffe9a8, Math.max(0, phaseFlash * 0.6)).fillRect(0, 0, WORLD.width, WORLD.height);
      }
      publish();
    }
  });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#e4f0e9',
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, activePointers: 2 },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: WORLD.width,
      height: WORLD.height,
      expandParent: false
    },
    scene: [scene]
  });
  const observer = new ResizeObserver(() => {
    if (game.isBooted) game.scale.refresh();
  });
  observer.observe(parent);
  parent.addEventListener('touchcancel', release);
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', handleVisibility);
  orientation.addEventListener('change', handleOrientation);

  return {
    start: () => {
      if (!ready) return;
      release();
      model = createModel();
      model.status = 'playing';
      accumulator = 0;
      effects = [];
      damageFlash = 0;
      phaseFlash = 0;
      lastPhase = 0;
      for (const text of floatingTexts) text.object.destroy();
      floatingTexts = [];
      publish();
    },
    pause,
    resume: () => {
      release();
      resumeModel(model);
      publish();
    },
    destroy: () => {
      observer.disconnect();
      parent.removeEventListener('touchcancel', release);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', handleVisibility);
      orientation.removeEventListener('change', handleOrientation);
      game.destroy(true);
    }
  };
};
