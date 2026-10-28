import test from 'node:test';
import assert from 'node:assert/strict';
import {gameUI} from '../test-support/game-ui.mjs';

function space(ui, overrides={}) {
  let prevented=false;
  ui.document.handlers.keydown({key:' ',code:'Space',repeat:false,preventDefault(){prevented=true},...overrides});
  return prevented;
}

test('space rolls once and completes the normal dice animation',()=>{
  const ui=gameUI({random:()=>.4});ui.g.renderAll();
  assert.equal(space(ui),true);
  assert.equal(ui.s.phase,'rolling');
  const timerCount=ui.timers.size;
  space(ui);space(ui,{repeat:true});
  assert.equal(ui.timers.size,timerCount);
  ui.runTimers(480);
  assert.equal(ui.s.phase,'move');
  assert.equal(ui.s.die,3);
  assert.equal(ui.s.movesLeft,3);
  space(ui);
  assert.equal(ui.s.phase,'move');
});

test('space respects dialogs, text entry, modifiers, held keys and hidden games',()=>{
  const cases=[
    ui=>{ui.ids.get('game-screen').hidden=true},
    ...['rules-dialog','event-dialog','win-dialog'].map(id=>ui=>{ui.ids.get(id).open=true}),
    ui=>{ui.ids.get('roll-button').disabled=true},
    ()=>({target:{tagName:'INPUT'}}),
    ()=>({target:{tagName:'TEXTAREA'}}),
    ()=>({target:{isContentEditable:true}}),
    ()=>({ctrlKey:true}),
    ()=>({repeat:true})
  ];
  for(const setup of cases){
    const ui=gameUI();ui.g.renderAll();const overrides=setup(ui)||{};
    space(ui,overrides);
    assert.equal(ui.s.phase,'roll');
  }
});

test('online space sends a roll only in the authorized roll phase',()=>{
  const ui=gameUI(),commands=[];ui.setOnline(true);
  ui.window.mazeOnline.command=action=>commands.push(action);
  ui.window.mazeOnline.canAct=()=>false;ui.g.updateControls();
  space(ui);assert.equal(commands.length,0);
  ui.window.mazeOnline.canAct=()=>true;ui.g.updateControls();
  assert.equal(space(ui),true);assert.deepEqual(commands,['roll']);
  space(ui,{repeat:true});assert.equal(commands.length,1);
  ui.s.phase='move';ui.g.updateControls();space(ui);
  assert.equal(commands.length,1);
});

test('space cannot roll during board rotation or the bot turn',()=>{
  const rotating=gameUI({reduced:false});rotating.g.renderAll();
  assert.equal(rotating.g.rotating,true);space(rotating);
  assert.equal(rotating.s.phase,'roll');
  const bot=gameUI();bot.ids.get('game-screen').hidden=true;
  bot.window.mazeGame.startBot('hard');bot.s.current=1;bot.s.phase='roll';bot.g.renderAll();
  space(bot);assert.equal(bot.s.phase,'roll');
});