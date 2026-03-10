import { Game } from './game/Game';

// Wait for DOM
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  if (!canvas) {
    console.error('Canvas element not found');
    return;
  }

  const game = new Game(canvas);

  // Game loop
  let lastTime = performance.now();

  function loop(now: number) {
    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = now;

    game.update(dt);
    game.render();

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
