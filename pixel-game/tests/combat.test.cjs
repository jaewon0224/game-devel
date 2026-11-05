const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// 실제 index.html의 게임 루프를 실행합니다. DOM과 이미지 로드만 대신합니다.
const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];

function eventTarget(properties = {}) {
  const listeners = new Map();
  return {
    closest: () => null,
    ...properties,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, properties = {}) {
      const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
      for (const listener of listeners.get(type) || []) listener(event);
      return event;
    }
  };
}

function createGame({ useLevel = false } = {}) {
  const context2d = new Proxy({}, { get: (target, key) => target[key] || (() => {}) });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, eventTarget({
      clientWidth: 960, clientHeight: 576, textContent: '', dataset: {},
      getContext: () => context2d, focus() {}, setAttribute() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 576 }),
      hasPointerCapture: () => false, releasePointerCapture() {}
    }));
    return elements.get(id);
  };
  const timers = new Map();
  let timerId = 0;
  const setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
  const clearTimeout = id => timers.delete(id);
  let focused = true;
  const document = eventTarget({ querySelector: element, hidden: false, hasFocus: () => focused });
  const window = eventTarget({ devicePixelRatio: 1, setTimeout });
  const context = vm.createContext({
    console, Image: class {}, requestAnimationFrame() {}, setTimeout, clearTimeout,
    document, window, navigator: {}
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  // 공격 모션 검증은 넓은 연습장에서, 맵 검증은 실제 BG.png 발판에서 실행합니다.
  if (!useLevel) run(`level.walls = []; level.walkableAreas = [[{x: -2000, y: -2000}, {x: 4000, y: -2000}, {x: 4000, y: 4000}, {x: -2000, y: 4000}]];`);
  run('ready = true; reset(); enemy.cooldown = 1000;');
  return { run, timers, elements, document, window, setFocused(value) { focused = value; } };
}

const facings = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

function keyEvent(game, type, code, overrides = {}) {
  return game.window.dispatch(type, {
    code, key: code, repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    target: game.elements.get('#game'), ...overrides
  });
}

for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
  test(`${code}: releasing a movement key stops the player`, () => {
    const game = createGame();
    keyEvent(game, 'keydown', code);
    game.run('updatePlayer(0.1);');
    assert.equal(game.run('player.moving'), true);
    keyEvent(game, 'keyup', code);
    const before = game.run('({x:player.x,y:player.y})');
    game.run('updatePlayer(0.1);');
    assert.equal(game.run('player.moving'), false);
    assert.deepEqual(game.run('({x:player.x,y:player.y})'), before);
  });
}

test('diagonal movement keeps the remaining held key after releasing the other key', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'KeyW');
  keyEvent(game, 'keydown', 'KeyD');
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.facing'), 'NE');
  keyEvent(game, 'keyup', 'KeyD');
  // 한 키의 자동 반복이 없어도 다른 키를 누르는 동안 계속 유지되어야 합니다.
  game.run('for (let step=0; step<60; step++) updatePlayer(0.1);');
  assert.equal(game.run('player.facing'), 'N');
  assert.equal(game.run('player.moving'), true);
  keyEvent(game, 'keyup', 'KeyW');
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.moving'), false);
});

test('Ctrl and Shift can stay held during diagonal WASD movement without clearing input', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'ControlLeft', {ctrlKey:true});
  keyEvent(game, 'keydown', 'ControlLeft', {ctrlKey:true, repeat:true});
  assert.equal(game.run('player.crouching'), true, 'holding Ctrl toggles crouch only once');
  keyEvent(game, 'keydown', 'KeyW', {ctrlKey:true});
  keyEvent(game, 'keydown', 'KeyD', {ctrlKey:true});
  keyEvent(game, 'keydown', 'ShiftLeft', {ctrlKey:true, shiftKey:true});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.animation'), 'crouchWalk');
  assert.equal(game.run('player.facing'), 'NE');
  keyEvent(game, 'keyup', 'KeyD', {ctrlKey:true, shiftKey:true});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.facing'), 'N');
  keyEvent(game, 'keyup', 'KeyW', {ctrlKey:true, shiftKey:true});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.moving'), false);
});

test('a held jump key does not queue another jump from automatic repeats', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'Space', {key:' '});
  game.run('updatePlayer(jumpDuration - 0.05);');
  keyEvent(game, 'keydown', 'Space', {key:' ', repeat:true});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.jumping'), false);
});

for (const interruption of ['focus', 'visibility change', 'pagehide', 'pageshow', 'fullscreen entry', 'fullscreen exit', 'canvas blur', 'context menu', 'button focus']) {
  test(`${interruption} recovers a missed movement key release and requires a fresh press`, () => {
    const game = createGame();
    keyEvent(game, 'keydown', 'ArrowRight');
    game.run('updatePlayer(0.1);');
    if (interruption === 'visibility change') {
      game.document.hidden = true;
      game.document.dispatch('visibilitychange');
      game.document.hidden = false;
      game.document.dispatch('visibilitychange');
    } else if (interruption === 'fullscreen entry' || interruption === 'fullscreen exit') {
      game.document.fullscreenElement = interruption === 'fullscreen entry' ? {} : null;
      game.document.dispatch('fullscreenchange');
    } else if (interruption === 'canvas blur' || interruption === 'context menu') {
      game.elements.get('#game').dispatch(interruption === 'canvas blur' ? 'blur' : 'contextmenu');
    } else if (interruption === 'button focus') {
      game.document.dispatch('focusin', { target: game.elements.get('#fullscreen') });
    } else game.window.dispatch(interruption);
    keyEvent(game, 'keydown', 'ArrowRight', {repeat:true});
    const before = game.run('player.x');
    game.run('updatePlayer(0.1);');
    assert.equal(game.run('player.moving'), false);
    assert.equal(game.run('player.x'), before);
    keyEvent(game, 'keydown', 'ArrowRight');
    game.run('updatePlayer(0.1);');
    assert.ok(game.run('player.x') > before, 'a fresh press immediately restores control');
  });
}

test('a repeated key event cannot restore movement after a window blur', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'ArrowRight');
  game.window.dispatch('blur');
  keyEvent(game, 'keydown', 'ArrowRight', {repeat:true});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.moving'), false);
});

for (const [code, modifiers] of [
  ['AltLeft', {altKey:true}], ['MetaLeft', {metaKey:true}], ['Escape', {}], ['F11', {}],
  ['KeyL', {ctrlKey:true}]
]) {
  test(`${code} clears movement before a browser shortcut can swallow keyup`, () => {
    const game = createGame();
    keyEvent(game, 'keydown', 'ArrowRight');
    keyEvent(game, 'keydown', code, modifiers);
    game.run('updatePlayer(0.1);');
    assert.equal(game.run('player.moving'), false);
  });
}

test('the game loop stops stale movement when focus is lost without a blur event', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'ArrowRight');
  game.setFocused(false);
  game.run('update(0.1);');
  assert.equal(game.run('player.moving'), false);
});

test('keyup without a physical code still releases a recognized arrow key', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'ArrowRight');
  keyEvent(game, 'keyup', '', {key:'ArrowRight'});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.moving'), false);
});

test('an unidentified key release clears stale movement rather than keeping it held', () => {
  const game = createGame();
  keyEvent(game, 'keydown', 'ArrowRight');
  keyEvent(game, 'keyup', 'Unidentified', {key:'Unidentified'});
  game.run('updatePlayer(0.1);');
  assert.equal(game.run('player.moving'), false);
});

function startPlayerAttack(game, facing, combo = 0, distance = 72) {
  const angle = facings.indexOf(facing) * Math.PI / 4;
  game.run(`
    reset(); enemy.cooldown = 1000;
    enemy.x = player.x + Math.cos(${angle}) * ${distance};
    enemy.y = player.y + Math.sin(${angle}) * ${distance};
    attack.nextIndex = ${combo};
    startAttack();
  `);
}

for (const [combo, damage] of [20, 25, 30].entries()) {
  for (const facing of facings) {
    test(`player combo ${combo + 1}, ${facing}: damage starts on impact and applies once`, () => {
      const game = createGame();
      startPlayerAttack(game, facing, combo);
      assert.equal(game.run('player.facing'), facing);
      assert.equal(game.run('attack.target === enemy'), true);
      const impact = game.run('playerStrikes[attack.animation].poses[directions.indexOf(player.facing)][0] / animations[attack.animation].fps');
      game.run(`update(${impact - 0.001})`);
      assert.equal(game.run('enemy.health'), 100);
      game.run('update(0.001)');
      assert.equal(game.run('enemy.health'), 100 - damage);
      assert.equal(game.run('hitEffects.length'), 1);
      game.run('update(0.2)');
      assert.equal(game.run('enemy.health'), 100 - damage);
    });
  }
}

for (const [index, facing] of facings.entries()) {
  test(`enemy ${facing}: damage starts on impact and applies once`, () => {
    const game = createGame();
    game.run(`
      enemy.x = player.x - Math.cos(${index} * Math.PI / 4) * 72;
      enemy.y = player.y - Math.sin(${index} * Math.PI / 4) * 72;
      enemy.facing = '${facing}'; enemy.attacking = true; enemy.animation = 'attack';
    `);
    const impact = game.run(`enemyStrike.poses[${index}][0] / enemyAnimations.attack.fps`);
    game.run(`update(${impact - 0.001})`);
    assert.equal(game.run('player.health'), 100);
    game.run('update(0.001)');
    assert.equal(game.run('player.health'), 85);
    game.run('update(0.25)');
    assert.equal(game.run('player.health'), 85);
  });
}

test('a visible sprite overlap alone does not hit; the blade must reach the torso', () => {
  const game = createGame();
  startPlayerAttack(game, 'E', 0, 130);
  game.run('updatePlayer(0.25); resolveCombat();');
  assert.equal(game.run('enemy.health'), 80, 'torso edge reaches the blade');
  startPlayerAttack(game, 'E', 0, 150);
  game.run('updatePlayer(0.25); resolveCombat();');
  assert.equal(game.run('enemy.health'), 100, 'transparent sprite canvas and equipment are excluded');
  for (const offset of ['enemy.x = player.x - 72; enemy.y = player.y;', 'enemy.x = player.x; enemy.y = player.y + 72;']) {
    startPlayerAttack(game, 'E');
    game.run(offset + ' updatePlayer(0.25); resolveCombat();');
    assert.equal(game.run('enemy.health'), 100, 'targets behind or beside the swing are missed');
  }
});

test('escaping before impact avoids damage; entering after a missed impact does not take damage', () => {
  const game = createGame();
  startPlayerAttack(game, 'E');
  game.run('updatePlayer(0.23); enemy.x = player.x + 200; updatePlayer(0.02); resolveCombat();');
  assert.equal(game.run('enemy.health'), 100);
  game.run('enemy.x = player.x + 72; updatePlayer(0.1); resolveCombat();');
  assert.equal(game.run('enemy.health'), 100);
});

for (const [index, facing] of facings.entries()) {
  test(`${facing}: grazing a torso near either edge of the 8-way aim sector still connects`, () => {
    const game = createGame();
    for (const degrees of [-22, 22]) {
      const angle = index * Math.PI / 4 + degrees * Math.PI / 180;
      startPlayerAttack(game, facing);
      game.run(`
        enemy.x = player.x + Math.cos(${angle}) * 72;
        enemy.y = player.y + Math.sin(${angle}) * 72;
        updatePlayer(0.25); resolveCombat();
      `);
      assert.equal(game.run('enemy.health'), 80, `player's ${degrees}-degree grazing hit`);
      game.run(`
        reset();
        enemy.x = player.x - Math.cos(${angle}) * 72;
        enemy.y = player.y - Math.sin(${angle}) * 72;
        enemy.facing = '${facing}'; enemy.attacking = true; enemy.animation = 'attack';
        updateEnemy(0.34); resolveCombat();
      `);
      assert.equal(game.run('player.health'), 85, `enemy's ${degrees}-degree grazing hit`);
    }
  });
}

test('both sides are blocked by a gap even when their blade reaches the torso', () => {
  const game = createGame();
  game.run(`
    level.walkableAreas = [
      [{x: 350, y: 0}, {x: 450, y: 0}, {x: 450, y: 95}, {x: 350, y: 95}],
      [{x: 350, y: 125}, {x: 450, y: 125}, {x: 450, y: 220}, {x: 350, y: 220}]
    ];
    player.x = 424; player.y = 65; enemy.x = 424; enemy.y = 155;
    startAttack();
    updatePlayer(0.25); resolveCombat();
  `);
  assert.equal(game.run('isEnemyPathClear(player, enemy, 0)'), false);
  assert.equal(game.run('enemy.health'), 100);
  game.run(`
    enemy.facing = 'N'; enemy.attacking = true; enemy.animation = 'attack';
    updateEnemy(0.3); resolveCombat();
  `);
  assert.equal(game.run('player.health'), 100);
});

test('jumping moves the torso clear of a horizontal sword rather than granting blanket invulnerability', () => {
  const game = createGame();
  game.run(`
    enemy.x = player.x + 72; enemy.facing = 'W';
    enemy.attacking = true; enemy.animation = 'attack';
    startJump(); update(0.28);
  `);
  assert.ok(game.run('player.jumpHeight') > 40);
  assert.equal(game.run('player.health'), 100);
  game.run(`
    player.jumping = false; player.jumpHeight = 0;
    enemy.attacking = true; enemy.attackTime = 0; enemy.hitChecked = false;
    update(0.28);
  `);
  assert.equal(game.run('player.health'), 85);
});

test('a skipped impact frame is still checked exactly once', () => {
  const game = createGame();
  startPlayerAttack(game, 'E');
  game.run('update(0.23); update(0.033); update(0.033);');
  assert.equal(game.run('enemy.health'), 80);
});

test('held input connects the three attacks with a fresh hit for each swing', () => {
  const game = createGame();
  startPlayerAttack(game, 'E');
  game.run('attack.held = true; for (let step = 0; step < 179; step++) update(0.01); attack.held = false; update(0.02);');
  assert.equal(game.run('enemy.health'), 25);
  assert.equal(game.run('attack.active'), false);
});

test('simultaneous lethal hits both count and reset restores combat and effects', () => {
  const game = createGame();
  startPlayerAttack(game, 'E');
  game.run(`
    player.health = 15; enemy.health = 20;
    enemy.attacking = true; enemy.facing = 'W'; enemy.animation = 'attack'; enemy.attackTime = 0.04;
    update(0.24); draw();
  `);
  assert.equal(game.run('player.health'), 0);
  assert.equal(game.run('enemy.health'), 0);
  assert.equal(game.run('player.animation'), 'death');
  assert.equal(game.run('enemy.animation'), 'death');
  assert.equal(game.run('attack.active || enemy.attacking'), false);
  game.run('startAttack(); startJump(); startSlide(); update(0.5);');
  assert.equal(game.run('attack.active || player.jumping || slide.active'), false);
  assert.equal(game.run('player.animationTime'), 0.5);
  assert.equal(game.run('enemy.animationTime'), 0.5);
  game.run('reset(); draw();');
  assert.equal(game.run('player.health + enemy.health'), 200);
  assert.equal(game.run('hitEffects.length + pendingStrikes.length'), 0);
  assert.equal(game.run('attack.nextIndex'), 0);
  assert.equal(game.run('player.animation'), 'idle');
  assert.equal(game.run('enemy.animation'), 'idle');
});

test('auto aim selects the nearest living enemy and deals damage to that enemy', () => {
  const game = createGame();
  game.run(`
    const farther = { x: player.x + 120, y: player.y, health: 100 };
    const nearest = { x: player.x - 60, y: player.y, health: 100 };
    const defeated = { x: player.x + 10, y: player.y, health: 0 };
    enemies.push(farther, defeated, nearest);
    camera.x = 1200; camera.y = -800;
    startAttack();
  `);
  assert.equal(game.run('attack.target === nearest'), true);
  assert.equal(game.run('player.facing'), 'W');
  game.run('updatePlayer(0.25); resolveCombat();');
  assert.equal(game.run('nearest.health'), 80);
  assert.equal(game.run('farther.health'), 100);
  assert.equal(game.run('enemy.health'), 100);
});

test('a held combo locks the current swing and selects the newly closest enemy on its next swing', () => {
  const game = createGame();
  startPlayerAttack(game, 'E');
  game.run(`
    const other = { x: player.x - 120, y: player.y, health: 100 };
    enemies.push(other);
    attack.held = true; update(0.3);
    other.x = player.x - 60;
    update(0.1);
  `);
  assert.equal(game.run('player.facing'), 'E');
  assert.equal(game.run('attack.target === enemy'), true);
  assert.equal(game.run('other.health'), 100);
  game.run('update(0.21)');
  assert.equal(game.run('player.facing'), 'W');
  assert.equal(game.run('attack.target === other'), true);
  assert.equal(game.run('attack.animation'), 'attack2');
  game.run('update(0.28)');
  assert.equal(game.run('other.health'), 75);
  assert.equal(game.run('enemy.health'), 80);
});

test('an enemy sharing the player position keeps a valid facing', () => {
  const game = createGame();
  game.run("enemy.x = player.x; enemy.y = player.y; player.facing = 'NW'; startAttack();");
  assert.equal(game.run('player.facing'), 'NW');
  assert.equal(game.run('attack.active'), true);
});

test('no living target means no attack or combo consumption', () => {
  const game = createGame();
  game.run('enemy.health = 0; startAttack();');
  assert.equal(game.run('attack.active'), false);
  assert.equal(game.run('attack.nextIndex'), 0);
  assert.equal(game.run('attack.target'), null);
  game.run('reset(); enemies.length = 0; startAttack();');
  assert.equal(game.run('attack.active'), false);
  assert.equal(game.run('attack.nextIndex'), 0);
});

test('a held combo stops safely if no target remains before its next swing', () => {
  const game = createGame();
  startPlayerAttack(game, 'E');
  game.run('attack.held = true; update(0.3); enemies.length = 0; update(0.31);');
  assert.equal(game.run('attack.active'), false);
  assert.equal(game.run('attack.target'), null);
});

for (const [row, facing] of facings.entries()) {
  for (const victim of ['player', 'enemy']) {
    test(`${victim} death, ${facing}: plays once, holds the fallen pose, and resets`, () => {
      const game = createGame();
      if (victim === 'enemy') {
        startPlayerAttack(game, 'E');
        game.run(`
          enemy.health = 20; enemy.facing = '${facing}';
          enemy.attacking = true; enemy.animation = 'attack';
          attack.held = true; attack.queued = true;
          update(0.24);
        `);
      } else {
        game.run(`
          player.health = 15; player.facing = '${facing}';
          enemy.x = player.x + 72; enemy.y = player.y; enemy.facing = 'W';
          enemy.attacking = true; enemy.animation = 'attack'; update(0.28);
        `);
      }
      assert.equal(game.run(`${victim}.health`), 0);
      assert.equal(game.run(`${victim}.animation`), 'death');
      assert.equal(game.run(`${victim}.animationTime`), 0);
      assert.equal(game.run(`${victim}.facing`), facing);
      assert.equal(game.run('attack.active || attack.held || attack.queued || enemy.attacking'), false);
      const beforeX = game.run(`${victim}.x`), beforeY = game.run(`${victim}.y`);
      game.run("keys.add('KeyD'); update(0.3);");
      assert.equal(game.run(`${victim}.animationTime`), 0.3, 'death keeps playing after combat ends');
      game.run('update(2)');
      const finishedAt = game.run(`${victim}.animationTime`);
      const sprites = victim === 'player' ? 'sprites' : 'enemySprites';
      const animations = victim === 'player' ? 'animations' : 'enemyAnimations';
      game.run(`
        ctx.drawImage = (...args) => { globalThis.lastSpriteDraw = args; };
        drawActor(${victim}, ${sprites}, ${animations});
      `);
      assert.equal(game.run('lastSpriteDraw[1]'), 14 * 128, 'final fallen frame is drawn');
      assert.equal(game.run('lastSpriteDraw[2]'), row * 128, 'death uses the facing at the fatal hit');
      game.run('update(3); startAttack(); startJump(); startSlide();');
      assert.equal(game.run(`${victim}.animation`), 'death');
      assert.equal(game.run(`${victim}.animationTime`), finishedAt, 'death never loops or restarts');
      assert.equal(game.run(`${victim}.x`), beforeX);
      assert.equal(game.run(`${victim}.y`), beforeY);
      game.run('reset()');
      assert.equal(game.run(`${victim}.health`), 100);
      assert.equal(game.run(`${victim}.animation`), 'idle');
      assert.equal(game.run(`${victim}.animationTime`), 0);
    });
  }
}

test('a fatal hit at takeoff lands the player before playing death', () => {
  const game = createGame();
  game.run(`
    player.health = 15;
    enemy.x = player.x + 72; enemy.y = player.y; enemy.facing = 'W';
    enemy.attacking = true; enemy.animation = 'attack'; enemy.attackTime = 0.279;
    startJump(); update(0.001);
  `);
  assert.equal(game.run('player.health'), 0);
  assert.equal(game.run('player.animation'), 'death');
  assert.equal(game.run('player.jumping'), false);
  assert.equal(game.run('player.jumpHeight'), 0);
});

test('BG map spawns and every navigation waypoint fit safely on visible ground', () => {
  const game = createGame({ useLevel: true });
  assert.equal(game.run('isWalkable(player, 12) && isWalkable(enemy, 12)'), true);
  assert.equal(game.run('level.waypoints.every(point => isWalkable(point, 12))'), true);
  assert.equal(game.run('level.waypoints.every(point => enemyNavigationNodes.includes(point))'), true);
  assert.equal(game.run('enemyNavigationNodes.every(point => isWalkable(point, enemyConfig.navigationRadius))'), true);
  for (const point of ['mapPoint(150, 1000)', 'mapPoint(970, 725)', 'mapPoint(800, 980)', 'mapPoint(825, 1450)']) {
    assert.equal(game.run(`isWalkable(${point})`), false, 'cliffs, the fire pit and vertical masonry stay blocked');
  }
});

for (const [name, x, y] of [
  ['behind the upper parapet', 820, 480],
  ['outside the upper left stair rail', 750, 670],
  ['outside the upper right stair rail at its entrance', 1050, 600],
  ['outside the upper right stair rail near its landing', 1100, 660],
  ['on the upper terrace front masonry', 650, 720],
  ['on the central terrace front masonry', 1020, 900],
  ['below the central terrace corner', 990, 920],
  ['outside the central stair entrance', 840, 920],
  ['past the last southern stair', 693, 1460],
  ['past the southeast bridge and image edge', 1400, 1605]
]) {
  test(`BG detailed boundary excludes ground ${name}`, () => {
    const game = createGame({ useLevel: true });
    assert.equal(game.run(`isWalkable(mapPoint(${x}, ${y}))`), false);
    assert.equal(game.run(`findEnemyPath(level.spawn, mapPoint(${x}, ${y})).length`), 0);
  });
}

test('world bounds block eight fast escape directions even if floor data extends beyond the image', () => {
  const game = createGame();
  const results = game.run(`(() => {
    level.walkableAreas = [[{x:-1000,y:-1000},{x:level.width+1000,y:-1000},
      {x:level.width+1000,y:level.height+1000},{x:-1000,y:level.height+1000}]];
    level.walls = [];
    return directions.map((direction, index) => {
      const angle=index*Math.PI/4, actor={x:level.width/2,y:level.height/2};
      moveActor(actor, Math.cos(angle)*10000, Math.sin(angle)*10000);
      for(let frame=0;frame<30;frame++) moveActor(actor,Math.cos(angle)*9,Math.sin(angle)*9);
      return {direction,safe:isWalkable(actor,actorRadius),
        within:actor.x>=actorRadius-0.001 && actor.y>=actorRadius/1.5-0.001
          && actor.x<=level.width-actorRadius+0.001 && actor.y<=level.height-actorRadius/1.5+0.001};
    });
  })()`);
  assert.ok(results.every(result => result.safe && result.within), JSON.stringify(results));
  assert.equal(game.run('groundContains({x:level.width+1,y:level.height/2})'), false);
  assert.equal(game.run('isEnemyPathClear({x:-20,y:level.height/2}, level.spawn, 0)'), false);
});

test('BG perimeter samples stay safely on ground under fast direct and diagonal wall pressure', () => {
  const game = createGame({ useLevel: true });
  const result = game.run(`(() => {
    let samples=0;
    const failures=[];
    for(const edge of getCollisionGeometry().filter(segment=>segment.kind==='edge')) {
      const dx=edge.b.x-edge.a.x,dy=(edge.b.y-edge.a.y)*1.5,length=Math.hypot(dx,dy);
      const tx=dx/length,ty=dy/length/1.5,nx=-dy/length,ny=dx/length/1.5;
      for(const fraction of [0.15,0.5,0.85]) for(const side of [-1,1]) {
        const start={x:edge.a.x+dx*fraction+nx*side*(actorRadius+4),
          y:edge.a.y+(edge.b.y-edge.a.y)*fraction+ny*side*(actorRadius+4)};
        if(!isWalkable(start,actorRadius)) continue;
        for(const along of [-1,0,1]) {
          const actor={...start}; samples++;
          moveActor(actor,-nx*side*4000+tx*along*2000,-ny*side*4000+ty*along*2000);
          for(let frame=0;frame<12;frame++) moveActor(actor,-nx*side*7+tx*along*3,-ny*side*7+ty*along*3);
          if(!isWalkable(actor,actorRadius)) failures.push({start,actor,along});
        }
      }
    }
    return {samples,failures};
  })()`);
  assert.ok(result.samples > 100, 'the audit covers the terrace, stairs, bridge corners and dead ends');
  assert.equal(result.failures.length, 0, JSON.stringify(result.failures));
});

test('BG stairs and every bridge branch can be traversed from the spawn', () => {
  const game = createGame({ useLevel: true });
  const result = game.run(`level.waypoints.map(destination => {
    const actor = { ...level.spawn };
    const path = findEnemyPath(actor, destination);
    for (const point of path) moveActor(actor, point.x - actor.x, point.y - actor.y);
    return path.length > 0 && isWalkable(actor, 10) && Math.hypot(actor.x - destination.x, actor.y - destination.y) < 0.01;
  })`);
  assert.ok(result.every(Boolean), JSON.stringify(result));
});

test('BG enemy follows the stair route instead of crossing the building and cliffs', () => {
  const game = createGame({ useLevel: true });
  game.run(`Object.assign(player, level.waypoints[0]); enemy.cooldown = 1000;`);
  assert.equal(game.run('isEnemyPathClear(enemy, player)'), false);
  game.run('for (let step = 0; step < 800; step++) updateEnemy(0.05);');
  assert.equal(game.run('isWalkable(enemy, 10)'), true);
  assert.ok(game.run('Math.hypot(enemy.x - player.x, enemy.y - player.y)') < 73);
});

for (const [rightX, rightY] of [[1040, 630], [1080, 690]]) {
  for (const reverse of [false, true]) {
    test(`BG separate upper stairs: ${reverse ? 'left to right' : 'right to left'} around the rail at ${rightX},${rightY}`, () => {
      const game = createGame({ useLevel: true });
      game.run(`
        const rightStair = mapPoint(${rightX}, ${rightY}), leftStair = mapPoint(846, 700);
        Object.assign(enemy, ${reverse ? 'leftStair' : 'rightStair'}, {cooldown:0});
        Object.assign(player, ${reverse ? 'rightStair' : 'leftStair'});
      `);
      assert.equal(game.run('isWalkable(player, 10) && isWalkable(enemy, 10)'), true);
      assert.equal(game.run('isEnemyPathClear(enemy, player)'), false, 'the two stairs require a detour');
      assert.ok(game.run('findEnemyPath(enemy, player).length') > 0, 'the rail endpoint connects both stair routes');
      const result = game.run(`(() => {
        let safe = true, stalled = 0, longestStall = 0;
        for (let step = 0; step < 1200 && player.health === 100; step++) {
          const before = {...enemy};
          update(0.05);
          safe = safe && isWalkable(enemy, 10);
          stalled = !enemy.attacking && Math.hypot(enemy.x-before.x, enemy.y-before.y) < 0.001 ? stalled+1 : 0;
          longestStall = Math.max(longestStall, stalled);
        }
        return {safe, longestStall, health:player.health};
      })()`);
      assert.equal(result.health, 85, 'the enemy completes the detour and lands an attack');
      assert.equal(result.safe, true, 'every step stays on the floor and outside the rails');
      assert.ok(result.longestStall < 20, 'the enemy does not stop on the stairs');
    });
  }
}

for (const [name, x, y, heldKeys] of [
  ['west wall', 10, 300, ['KeyA']],
  ['east wall', 590, 300, ['KeyD']],
  ['north wall', 300, 10 / 1.5, ['KeyW']],
  ['south wall', 300, 600 - 10 / 1.5, ['KeyS']],
  ['northwest corner', 10, 10 / 1.5, ['KeyW', 'KeyA']],
  ['northeast corner', 590, 10 / 1.5, ['KeyW', 'KeyD']],
  ['southwest corner', 10, 600 - 10 / 1.5, ['KeyS', 'KeyA']],
  ['southeast corner', 590, 600 - 10 / 1.5, ['KeyS', 'KeyD']]
]) {
  test(`enemy closes in and damages a player holding movement into the ${name}`, () => {
    const game = createGame();
    game.run(`
      level.walkableAreas = [[{x:0,y:0},{x:600,y:0},{x:600,y:600},{x:0,y:600}]];
      Object.assign(player, {x:${x}, y:${y}});
      Object.assign(enemy, {x:300, y:300, cooldown:0});
      for (const key of ${JSON.stringify(heldKeys)}) keys.add(key);
    `);
    assert.equal(game.run('isEnemyPathClear(enemy, player)'), true, 'contact with the boundary still allows pursuit');
    game.run('for (let frame = 0; frame < 600 && player.health === 100; frame++) update(1 / 60);');
    assert.equal(game.run('player.health'), 85, 'the enemy reaches the player and lands its attack');
    assert.ok(game.run('Math.hypot(enemy.x - player.x, enemy.y - player.y) <= enemyConfig.attackRange'));
    assert.equal(game.run('isWalkable(player, 10) && isWalkable(enemy, 10)'), true);
    assert.ok(Math.abs(game.run('player.x') - x) < 0.01);
    assert.ok(Math.abs(game.run('player.y') - y) < 0.01);
  });
}

for (const slope of [0, 0.53, -0.72, 2]) {
  for (const side of [-1, 1]) {
    test(`enemy pursues along a rail at slope ${slope}, side ${side}, while both actors touch it`, () => {
      const game = createGame();
      game.run(`
        const a = {x:300,y:800}, b = {x:800,y:800 + 500 * ${slope}};
        level.walls = [{a,b,halfWidth:2}];
        const length = Math.hypot(b.x-a.x,b.y-a.y), tx = (b.x-a.x)/length, ty = (b.y-a.y)/length;
        const nx = -ty * ${side}, ny = tx * ${side};
        Object.assign(player, {x:a.x + (b.x-a.x)*0.65 + nx*45, y:a.y + (b.y-a.y)*0.65 + ny*45});
        Object.assign(enemy, {x:a.x + (b.x-a.x)*0.2 + nx*45, y:a.y + (b.y-a.y)*0.2 + ny*45, cooldown:0});
        moveActor(player, -nx*60, -ny*60);
        moveActor(enemy, -nx*60, -ny*60);
      `);
      assert.equal(game.run('isWalkable(player, 10) && isWalkable(enemy, 10)'), true);
      assert.equal(game.run('isWalkable(player, 12) || isWalkable(enemy, 12)'), false, 'both feet touch the rail');
      assert.equal(game.run('isEnemyPathClear(enemy, player)'), true);
      game.run('for (let frame = 0; frame < 600 && player.health === 100; frame++) update(1 / 60);');
      assert.equal(game.run('player.health'), 85);
      assert.equal(game.run('isWalkable(enemy, 10)'), true);
      assert.equal(game.run(`orientation(a, b, player) * ${side} > 0 && orientation(a, b, enemy) * ${side} > 0`), true);
    });
  }
}

test('BG enemy reaches and attacks a player pressed against the terrace rail from another floor', () => {
  const game = createGame({ useLevel: true });
  game.run(`
    Object.assign(player, mapPoint(740, 1155));
    for (let frame = 0; frame < 35; frame++) movePlayer(0, 270 * 0.03);
    Object.assign(enemy, level.waypoints[0], {cooldown:0});
  `);
  assert.equal(game.run('isWalkable(player, 10)'), true);
  assert.equal(game.run('isWalkable(player, 12)'), false);
  assert.ok(game.run('findEnemyPath(enemy, player).length') > 0);
  game.run('for (let frame = 0; frame < 2400 && player.health === 100; frame++) update(1 / 60);');
  assert.equal(game.run('player.health'), 85);
  assert.equal(game.run('isWalkable(enemy, 10)'), true);
});

test('an enemy still cannot approach or damage a player through a sealed rail', () => {
  const game = createGame();
  game.run(`
    level.walkableAreas = [[{x:0,y:0},{x:600,y:0},{x:600,y:600},{x:0,y:600}]];
    level.walls = [{a:{x:300,y:0},b:{x:300,y:600},halfWidth:2}];
    Object.assign(player, {x:312,y:300});
    Object.assign(enemy, {x:270,y:300,cooldown:0});
    for (let frame = 0; frame < 120; frame++) update(1 / 60);
  `);
  assert.equal(game.run('player.health'), 100);
  assert.equal(game.run('enemy.attacking'), false);
  assert.ok(game.run('enemy.x') < 300);
  assert.equal(game.run('isEnemyPathClear(enemy, player, 0)'), false);
});

for (const action of ['run', 'jump', 'slide']) {
  test(`BG ${action} slides along the visible terrace rail without crossing it`, () => {
    const game = createGame({ useLevel: true });
    game.run(`
      Object.assign(player, mapPoint(740, 1155));
      if (!isWalkable(player, 10)) throw new Error('The cliff fixture must start on safe ground');
      keys.add('KeyS'); keys.add('ShiftLeft'); player.moving = true; player.running = true;
      ${action === 'jump' ? 'startJump();' : action === 'slide' ? 'startSlide();' : ''}
      for (let step = 0; step < 35; step++) updatePlayer(0.03);
    `);
    assert.equal(game.run('isWalkable(player, 10)'), true);
    assert.ok(game.run('player.x > mapPoint(740, 1155).x + 30'), 'southward pressure keeps moving along the sloping rail');
    assert.ok(game.run('orientation(mapPoint(631, 1113), mapPoint(890, 1250), player)') < 0, 'the feet remain on the inner side of the visible parapet');
  });
}

test('BG camera stays within the image and centers it in a larger viewport', () => {
  const game = createGame({ useLevel: true });
  for (const position of ['{x: -100, y: -100}', '{x: 5000, y: 5000}']) {
    game.run(`Object.assign(player, ${position}); updateCamera(1, true);`);
    assert.equal(game.run('camera.x >= 0 && camera.y >= 0 && camera.x + view.width <= level.width && camera.y + view.height <= level.height'), true);
  }
  game.run('view.width = 3000; view.height = 2600; updateCamera(1, true);');
  assert.equal(game.run('camera.x'), game.run('(level.width - view.width) / 2'));
  assert.equal(game.run('camera.y'), game.run('(level.height - view.height) / 2'));
});

for (const [mode, animation] of [['walk', 'walk'], ['run', 'run'], ['crouch', 'crouchWalk']]) {
  test(`pushing a wall keeps ${mode} input, facing and animation active until release`, () => {
    const game = createGame();
    game.run(`
      level.walkableAreas = [[{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 400}, {x: 0, y: 400}]];
      Object.assign(player, {x: 390, y: 200, crouching: ${mode === 'crouch'}});
      keys.add('KeyD'); ${mode === 'run' ? "keys.add('ShiftLeft');" : ''}
      for (let step = 0; step < 90; step++) updatePlayer(1 / 60);
    `);
    assert.equal(game.run('player.animation'), animation);
    assert.equal(game.run('player.moving'), true);
    assert.equal(game.run('player.running'), mode === 'run');
    assert.equal(game.run('player.facing'), 'E');
    assert.ok(game.run('player.animationTime') > 1.4);
    assert.ok(Math.abs(game.run('player.x') - 390) < 0.01, 'the wall still blocks displacement');
    assert.equal(game.run('isWalkable(player, 10)'), true);
    game.run('keys.clear(); updatePlayer(1 / 60);');
    assert.equal(game.run('player.moving || player.running'), false);
    assert.equal(game.run('player.animation'), mode === 'crouch' ? 'crouchIdle' : 'idle');
  });
}

test('cardinal input slides along a diagonal wall without changing the input-facing direction', () => {
  const game = createGame();
  game.run(`
    level.walkableAreas = [[{x: 0, y: 0}, {x: 600, y: 0}, {x: 0, y: 600}]];
    Object.assign(player, {x: 300, y: 287.9}); keys.add('KeyD');
    for (let step = 0; step < 60; step++) updatePlayer(1 / 60);
  `);
  assert.ok(game.run('player.x') > 360, 'eastward pressure advances along the wall');
  assert.ok(game.run('player.y') < 228, 'the free tangent component is preserved');
  assert.equal(game.run('player.facing'), 'E');
  assert.equal(game.run('player.animation'), 'walk');
  assert.equal(game.run('isWalkable(player, 10)'), true);
  assert.ok(game.run('Math.hypot(player.x - 300, player.y - 287.9)') <= 155.01, 'contact does not increase movement speed');
});

test('a corner blocks both directions while running continues and moving away responds immediately', () => {
  const game = createGame();
  game.run(`
    level.walkableAreas = [[{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 400}, {x: 0, y: 400}]];
    Object.assign(player, {x: 390, y: 400 - 10 / 1.5});
    keys.add('KeyD'); keys.add('KeyS'); keys.add('ShiftLeft');
    for (let step = 0; step < 90; step++) updatePlayer(1 / 60);
  `);
  assert.equal(game.run('player.animation'), 'run');
  assert.equal(game.run('player.running'), true);
  assert.ok(Math.abs(game.run('player.x') - 390) < 0.01);
  assert.ok(Math.abs(game.run('player.y') - (400 - 10 / 1.5)) < 0.01);
  assert.equal(game.run('isWalkable(player, 10)'), true);
  game.run("keys.clear(); keys.add('KeyW'); keys.add('KeyA'); updatePlayer(1 / 60);");
  assert.ok(game.run('player.x') < 389);
  assert.ok(game.run('player.y') < 392);
  assert.equal(game.run('player.facing'), 'NW');
});

test('running against a wall still allows a slide and its timer completes while blocked', () => {
  const game = createGame();
  game.run(`
    level.walkableAreas = [[{x: 0, y: 0}, {x: 400, y: 0}, {x: 400, y: 400}, {x: 0, y: 400}]];
    Object.assign(player, {x: 390, y: 200}); keys.add('KeyD'); keys.add('ShiftLeft');
    updatePlayer(1 / 60); startSlide();
  `);
  assert.equal(game.run('slide.active && slide.fromRun'), true);
  game.run('updatePlayer(0.25);');
  assert.equal(game.run('player.animation'), 'slide');
  assert.equal(game.run('slide.time'), 0.25);
  game.run('updatePlayer(0.6);');
  assert.equal(game.run('slide.active'), false);
  assert.equal(game.run('player.animation'), 'run');
  assert.equal(game.run('player.running'), true);
  assert.ok(Math.abs(game.run('player.x') - 390) < 0.01);
});

test('wide terrace floor remains open across the old invisible polygon boundaries', () => {
  const game = createGame({ useLevel: true });
  for (const point of ['mapPoint(920, 925)', 'mapPoint(1185, 774)', 'mapPoint(790, 1070)', 'mapPoint(824, 1199)']) {
    assert.equal(game.run(`isWalkable(${point}, 10)`), true, point + ' is visible stone floor');
  }
});

test('overlapping floor regions do not catch diagonal movement at their internal seam', () => {
  const game = createGame();
  game.run(`
    level.walkableAreas = [
      [{x:0,y:0},{x:300,y:0},{x:300,y:400},{x:0,y:400}],
      [{x:200,y:0},{x:600,y:0},{x:600,y:400},{x:200,y:400}]
    ];
    const seamActor = {x:100,y:10 / 1.5 + 0.01};
    for(let frame=0;frame<150;frame++) moveActor(seamActor,2,-1);
  `);
  assert.ok(game.run('seamActor.x') > 399.9);
  assert.equal(game.run('isWalkable(seamActor,10)'), true);
});

for (const [slope, sign] of [[0, 1], [0, -1], [0.53, 1], [0.53, -1], [-0.72, 1], [-0.72, -1], [2, 1], [2, -1]]) {
  test(`thin rail slope ${slope}, direction ${sign}: oblique contact retains sideways speed`, () => {
    const game = createGame();
    const result = game.run(`(() => {
      const a = {x:200,y:200}, b = {x:500,y:200 + 300 * ${slope}};
      level.walls = [{a,b,halfWidth:2}];
      const length = Math.hypot(b.x-a.x,b.y-a.y), tx=(b.x-a.x)/length, ty=(b.y-a.y)/length;
      const nx=-ty,ny=tx, start={x:(a.x+b.x)/2+nx*45,y:(a.y+b.y)/2+ny*45}, actor={...start};
      moveActor(actor,tx*60*${sign}-nx*60,ty*60*${sign}-ny*60);
      const before={...actor};
      for(let frame=0;frame<15;frame++) moveActor(actor,tx*${sign}-nx,ty*${sign}-ny);
      return {
        firstSlide:(before.x-start.x)*tx*${sign}+(before.y-start.y)*ty*${sign},
        continued:(actor.x-before.x)*tx*${sign}+(actor.y-before.y)*ty*${sign},
        safe:isWalkable(actor,10)
      };
    })()`);
    assert.ok(result.firstSlide > 59.95, JSON.stringify(result));
    assert.ok(result.continued > 14.95, 'sideways velocity stays active on following frames');
    assert.equal(result.safe, true);
  });
}

test('a four-pixel rail blocks a fast move and attacks while its open endpoint remains passable', () => {
  const game = createGame();
  game.run(`level.walls=[{a:{x:300,y:100},b:{x:300,y:400},halfWidth:2}];
    const railActor={x:200,y:250}; moveActor(railActor,1000,50);`);
  assert.ok(game.run('railActor.x') <= 288);
  assert.ok(game.run('railActor.x') > 287.99, 'collision is only the thin rail plus the character footprint');
  assert.equal(game.run('isWalkable(railActor,10)'), true);
  assert.equal(game.run('isEnemyPathClear({x:250,y:250},{x:350,y:250},0)'), false);
  assert.equal(game.run('isEnemyPathClear({x:250,y:450},{x:350,y:450},10)'), true);
});
