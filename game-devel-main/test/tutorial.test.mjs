import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {gameUI} from '../test-support/game-ui.mjs';
const source=await readFile(new URL('../tutorial.js',import.meta.url),'utf8');

function tutorial(){const ui=gameUI();vm.runInContext(source,ui.context);return {...ui,dialog:ui.ids.get('tutorial-dialog'),scene:ui.ids.get('tutorial-scene'),click:id=>ui.ids.get(id).handlers.click()}}

test('tutorial opens and replays its animation without changing the current game',()=>{
  const ui=tutorial(),before=JSON.stringify(ui.s);
  ui.click('tutorial-button');assert.equal(ui.dialog.open,true);assert.equal(ui.scene.classList.contains('is-playing'),true);
  ui.click('tutorial-replay');assert.equal(ui.scene.classList.contains('is-playing'),true);
  assert.equal(JSON.stringify(ui.s),before);
});

test('closing the tutorial stops animation and reopening starts it again',()=>{
  const ui=tutorial();ui.click('tutorial-button');ui.click('tutorial-close');
  assert.equal(ui.dialog.open,false);assert.equal(ui.scene.classList.contains('is-playing'),false);
  ui.click('tutorial-replay');assert.equal(ui.scene.classList.contains('is-playing'),false);
  ui.click('tutorial-button');assert.equal(ui.scene.classList.contains('is-playing'),true);
  ui.dialog.handlers.cancel();assert.equal(ui.scene.classList.contains('is-playing'),false);
  ui.dialog.close();ui.click('tutorial-button');ui.dialog.handlers.click({target:ui.dialog});
  assert.equal(ui.dialog.open,false);assert.equal(ui.scene.classList.contains('is-playing'),false);
});

test('tutorial does not open over an active online room',()=>{
  const ui=tutorial();ui.setOnline(true);ui.click('tutorial-button');
  assert.equal(ui.dialog.open,false);assert.equal(ui.scene.classList.contains('is-playing'),false);
});
