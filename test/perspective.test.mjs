import test from 'node:test';
import assert from 'node:assert/strict';
import {gameUI,flush} from '../test-support/game-ui.mjs';
test('local turns place the current home side at the bottom without changing board state',()=>{
  const ui=gameUI(),{g,s,ids}=ui;const passages=[...s.passages];g.renderAll();assert.equal(g.angle%360,180);assert.equal(ids.get('board').querySelectorAll('.cell-content').length,36);g.endTurn();assert.equal(s.current,1);assert.equal(g.angle%360,0);assert.deepEqual([...s.passages],passages);assert.equal(s.players[0].pos,7);assert.equal(s.players[1].pos,28);g.endTurn();assert.equal(g.angle%360,180);
});
test('rotated direction buttons and keyboard follow screen directions while board clicks use their actual cell',async()=>{
  const ui=gameUI(),{g,s,buttons,ids,document}=ui;g.renderAll();s.phase='move';s.movesLeft=6;g.updateControls();await buttons.find(b=>b.dataset.direction==='up').handlers.click();assert.equal(s.players[0].pos,13);assert.match(ids.get('message').textContent,/위쪽/);await buttons.find(b=>b.dataset.direction==='left').handlers.click();assert.equal(s.players[0].pos,14);ids.get('board').handlers.click({target:ids.get('board').querySelector('[data-index="8"]')});await flush();assert.equal(s.players[0].pos,8);document.handlers.keydown({key:'ArrowDown',preventDefault(){}});await flush();assert.equal(s.players[0].pos,2);
});
test('rotation animates board and labels together and blocks input until completion',async()=>{
  const ui=gameUI({reduced:false}),{g,s,ids,pending}=ui;g.renderAll();assert.equal(g.rotating,true);assert.equal(ids.get('roll-button').disabled,true);assert.equal(ids.get('board').getAttribute('aria-busy'),'true');assert.equal(pending.length,37);assert.equal(pending[0].options.duration,800);g.rollDice();assert.equal(s.phase,'roll');ui.finish();await flush();assert.equal(g.rotating,false);assert.equal(ids.get('roll-button').disabled,false);assert.equal(ids.get('board').getAttribute('aria-busy'),'false');
});
test('forced move faces the choosing opponent and stays there for their following turn',async()=>{
  const ui=gameUI(),{g,s}=ui;g.renderAll();s.players[1].pos=14;s.players[1].lastPos=13;g.beginForcedMove();assert.equal(s.forcedPlayer,1);assert.equal(g.angle%360,0);await g.chooseForcedMove('up');assert.equal(s.players[1].pos,8);assert.equal(s.phase,'pause');assert.equal(g.angle%360,0);ui.runTimers(450);assert.equal(s.current,1);assert.equal(g.angle%360,0);
});
test('next-round goal reveal waits until the board finishes turning',async()=>{
  const ui=gameUI({reduced:false}),{g,s,ids}=ui;g.renderAll();ui.finish();await flush();g.startNextRound(0);assert.equal(g.rotating,true);assert.equal(s.phase,'intro');await flush();assert.equal(ui.pending.length,37);ui.finish();await flush();assert.equal(g.rotating,false);assert.equal(s.phase,'intro');assert.equal(ui.pending.length,1);ui.finish();await flush();assert.equal(s.phase,'roll');assert.equal(ids.get('roll-button').disabled,false);
});
test('online mode retains its fixed view and reduced motion skips the turn animation',()=>{
  const ui=gameUI(),{g}=ui;g.renderAll();assert.equal(g.rotating,false);assert.equal(ui.pending.length,0);ui.setOnline(true);g.updateControls();assert.equal(g.angle,0);assert.equal(g.viewDirection('up'),'up');assert.equal(ui.pending.length,0);
});
test('leaving during rotation cancels animation without a stale callback changing the menu',async()=>{
  const ui=gameUI({reduced:false}),{g,s,window,ids}=ui;g.renderAll();window.mazeGame.leaveOnline();await flush();assert.equal(s.phase,'menu');assert.equal(g.rotating,false);assert.equal(ids.get('board').getAttribute('aria-busy'),'false');
});
