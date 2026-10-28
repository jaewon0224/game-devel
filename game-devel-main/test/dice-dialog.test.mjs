import test from 'node:test';
import assert from 'node:assert/strict';
import {gameUI,flush} from '../test-support/game-ui.mjs';

function presentation(){
  let resolve;
  return {values:[],results:[],reset(){},roll(value){this.values.push(value);return new Promise(done=>{resolve=done})},setResult(value){this.results.push(value)},cancel(){resolve?.(false)},finish(){resolve?.(true)}};
}
function snapshot(ui,phase,extra={}){return {...ui.s,phase,turnVisited:[...ui.s.turnVisited],players:ui.s.players.map(p=>({...p,used:[...p.used]})),...extra}}

test('a human turn opens the dice dialog and waits for its animation before movement',async()=>{
  const dice=presentation(),ui=gameUI({dice,random:()=>.7});ui.g.renderAll();
  assert.equal(ui.ids.get('dice-dialog').open,true);
  ui.ids.get('dice-roll-button').handlers.click();
  assert.deepEqual(dice.values,[5]);assert.equal(ui.s.phase,'rolling');
  assert.equal(ui.ids.get('dice-roll-button').disabled,true);
  ui.g.rollDice();assert.equal(dice.values.length,1);
  const before=ui.s.players[0].pos;await ui.g.move('down');assert.equal(ui.s.players[0].pos,before);
  dice.finish();await flush();
  assert.equal(ui.s.phase,'move');assert.equal(ui.s.die,5);assert.equal(ui.s.movesLeft,5);
  assert.equal(ui.ids.get('dice-dialog').open,false);
  ui.g.endTurn();assert.equal(ui.ids.get('dice-dialog').open,true);
});

test('the dialog supports space and dismissal, and leaving cancels stale completion',async()=>{
  const dice=presentation(),ui=gameUI({dice});ui.g.renderAll();
  ui.ids.get('dice-dismiss').handlers.click();ui.g.updateControls();
  assert.equal(ui.ids.get('dice-dialog').open,false);
  ui.document.handlers.keydown({key:' ',code:'Space',preventDefault(){}});
  assert.equal(ui.ids.get('dice-dialog').open,true);assert.equal(dice.values.length,1);
  let prevented=false;ui.ids.get('dice-dialog').handlers.cancel({preventDefault(){prevented=true}});
  assert.equal(prevented,true);
  ui.window.mazeGame.goHome();dice.finish();await flush();
  assert.equal(ui.s.phase,'menu');assert.equal(ui.ids.get('dice-dialog').open,false);
});

test('online dice uses the server value and locks movement until the presentation finishes',async()=>{
  const dice=presentation(),ui=gameUI({dice}),commands=[];ui.setOnline(true);ui.window.mazeOnline.player=0;
  ui.window.mazeOnline.command=(...args)=>commands.push(args);ui.g.renderAll();
  ui.window.mazeGame.onlineSnapshot(snapshot(ui,'rolling'),0);
  assert.deepEqual(dice.values,[null]);
  ui.window.mazeGame.onlineSnapshot(snapshot(ui,'rolling'),0);assert.equal(dice.values.length,1);
  ui.window.mazeGame.onlineSnapshot(snapshot(ui,'move',{die:6,movesLeft:6}),0);
  assert.deepEqual(dice.results,[6]);assert.equal(ui.ids.get('dice-dialog').open,true);
  await ui.g.move('down');assert.equal(commands.length,0);
  dice.finish();await flush();assert.equal(ui.ids.get('dice-dialog').open,false);
  await ui.g.move('down');assert.deepEqual(commands,[['move','down']]);
});

test('opponent turns do not open a dice dialog, and leaving online cancels it',async()=>{
  const dice=presentation(),ui=gameUI({dice});ui.setOnline(true);ui.window.mazeOnline.player=1;
  ui.window.mazeGame.onlineSnapshot(snapshot(ui,'roll'),1);assert.equal(ui.ids.get('dice-dialog').open,false);
  ui.window.mazeGame.onlineSnapshot(snapshot(ui,'rolling'),1);assert.equal(dice.values.length,0);
  ui.window.mazeOnline.player=0;ui.window.mazeGame.onlineSnapshot(snapshot(ui,'rolling'),0);
  assert.equal(ui.ids.get('dice-dialog').open,true);
  ui.window.mazeGame.leaveOnline();dice.finish();await flush();
  assert.equal(ui.s.phase,'menu');assert.equal(ui.ids.get('dice-dialog').open,false);
});
