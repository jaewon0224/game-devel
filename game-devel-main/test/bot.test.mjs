import test from 'node:test';
import assert from 'node:assert/strict';
import {gameUI,flush} from '../test-support/game-ui.mjs';
const seeded=(initial=42)=>{let value=initial;return()=>((value=(value*1664525+1013904223)>>>0)/4294967296)};
function view(overrides={}){return {round:1,current:1,phase:'move',movesLeft:4,goal:7,events:[29,10,16],wallMode:null,turnVisited:[35],players:[{pos:0,lastPos:null,score:0,used:[]},{pos:35,lastPos:null,score:0,used:[]}],...overrides}}
function openGrid(brain){for(let a=0;a<36;a++){if(a%6<5)brain.observeEdge(a,a+1,true);if(a<30)brain.observeEdge(a,a+6,true)}}
async function start(difficulty='hard',seed=42){const ui=gameUI({random:seeded(seed)});ui.ids.get('game-screen').hidden=true;ui.window.mazeGame.startBot(difficulty);await flush();return ui}
async function until(ui,predicate,limit=100){for(let i=0;i<limit;i++){if(predicate())return i;if(!await ui.step())throw new Error('Game stalled in '+ui.s.phase+' current='+ui.s.current)}throw new Error('Action limit in '+ui.s.phase+' current='+ui.s.current)}

test('easy forgets frequently, medium forgets occasionally, hard retains every observed wall',()=>{
  const {window}=gameUI(),counts=[];
  for(const difficulty of ['easy','medium','hard']){const brain=new window.MazeBot(difficulty,seeded(11));for(let a=0;a<30;a++)brain.observeEdge(a,a+1,false);for(let turn=0;turn<20;turn++)brain.startTurn();counts.push(brain.memory.size)}
  assert.ok(counts[0]<counts[1]);assert.ok(counts[1]<counts[2]);assert.equal(counts[2],30);
  const hard=new window.MazeBot('hard',()=>0);hard.observeEdge(7,8,false);for(let turn=0;turn<1000;turn++)hard.startTurn();assert.equal(hard.memory.get('7-8'),false);
});
test('temporary changes restore remembered facts and a rebuilt maze clears obsolete memory',()=>{
  const {window}=gameUI(),brain=new window.MazeBot('hard');brain.observeEdge(7,8,false);brain.observeTemporary(7,8,true);assert.equal(brain.memory.get('7-8'),true);brain.observeTemporary(7,8,false);brain.nextRound();assert.equal(brain.memory.get('7-8'),false);brain.observeEdge(8,14,true);brain.resetMaze();assert.equal(brain.memory.size,0);
});
test('hard avoids observed walls and easy can try them again after forgetting',()=>{
  const {window}=gameUI(),hard=new window.MazeBot('hard',()=>0),easy=new window.MazeBot('easy',()=>0),v=view({goal:8,events:[],turnVisited:[14],players:[{pos:0,score:0,used:[]},{pos:14,score:0,used:[]}]});hard.observeEdge(14,8,false);easy.observeEdge(14,8,false);easy.startTurn();assert.notEqual(hard.chooseMove(v),'up');assert.equal(easy.chooseMove(v),'up');
});
test('hard pursues nearby roulette cells, prioritizes an immediate point and never reads hidden passages',()=>{
  const {window}=gameUI(),brain=new window.MazeBot('hard',()=>.5),v=view();Object.defineProperty(v,'passages',{get(){throw new Error('hidden passages accessed')}});assert.equal(brain.target(v),29);assert.equal(brain.chooseMove(v),'up');v.goal=34;assert.equal(brain.chooseMove(v),'left');v.wallMode='install';assert.ok(brain.chooseWall(v));
});
test('hard installs on the human route and removes a wall that shortens its own route',()=>{
  const {window}=gameUI(),brain=new window.MazeBot('hard',()=>.5);openGrid(brain);const v=view({goal:8,events:[],wallMode:'install',players:[{pos:7,score:0,used:[]},{pos:35,score:0,used:[]}]});assert.deepEqual(Array.from(brain.chooseWall(v)),[7,8]);brain.beginWallEvent();brain.observeEdge(7,8,false);v.wallMode='remove';v.players=[{pos:35,score:0,used:[]},{pos:7,score:0,used:[]}];assert.deepEqual(Array.from(brain.chooseWall(v)),[7,8]);
});
for(const difficulty of ['easy','medium','hard'])test(difficulty+' automatically rolls and finishes its turn, while human controls stay locked',async()=>{
  const ui=await start(difficulty),{g,s,ids,document}=ui;s.current=1;s.phase='roll';g.renderAll();assert.equal(ids.get('roll-button').disabled,true);s.events=[];const before=s.players[1].pos;document.handlers.keydown({key:'ArrowUp',preventDefault(){}});ids.get('roll-button').handlers.click();assert.equal(s.phase,'roll');assert.equal(s.players[1].pos,before);await until(ui,()=>s.current===0&&s.phase==='roll');assert.equal(ids.get('roll-button').disabled,false);assert.equal(g.angle%360,180);assert.equal(g.botView().passages,undefined);assert.match(ids.get('player-name-1').textContent,/봇/);
});
for(const [type,roll] of [['install',.1],['remove',.4],['rebuild',.6]])test('bot completes '+type+' roulette without human clicks',async()=>{
  const ui=await start('hard'),{g,s,ids}=ui;s.current=1;s.phase='event';s.players[0].pos=0;s.players[1].pos=35;s.goal=7;s.events=[];ui.setRandom(()=>roll);ids.get('event-dialog').showModal();g.updateControls();await until(ui,()=>s.current===0&&s.phase==='roll',150);assert.equal(ids.get('event-dialog').open,false);
});
test('a bot roulette forced move waits for the human to choose, then resumes play',async()=>{
  const ui=await start('hard'),{g,s,ids}=ui;s.current=1;s.phase='event';s.players[0].pos=7;s.players[0].lastPos=null;s.players[1].pos=35;s.goal=30;s.events=[];openGrid(g.brain);s.passages=new Set(g.brain.memory.keys());ui.setRandom(()=>.9);ids.get('event-dialog').showModal();g.updateControls();await until(ui,()=>s.phase==='force-select');assert.equal(s.forcedPlayer,0);assert.ok(ui.buttons.some(button=>!button.disabled));const choice=g.forcedMoveChoices()[0];assert.ok(choice);await g.move(choice.direction);await until(ui,()=>s.current===0&&s.phase==='roll');
});
test('a human roulette forced move is automatically chosen by the bot',async()=>{
  const ui=await start('medium'),{g,s}=ui;s.current=0;s.players[1].pos=14;s.players[1].lastPos=null;s.players[0].pos=0;s.goal=30;s.events=[];openGrid(g.brain);s.passages=new Set(g.brain.memory.keys());g.beginForcedMove();assert.equal(s.forcedPlayer,1);const from=s.players[1].pos;await until(ui,()=>s.forcedPlayer===null&&s.phase==='pause');assert.notEqual(s.players[1].pos,from);
});
test('walls and moves are learned from both players and hard memory survives round transitions',async()=>{
  const ui=await start('hard'),{g,s}=ui;s.current=0;s.phase='move';s.movesLeft=2;s.players[0].pos=7;s.players[1].pos=35;s.turnVisited=new Set([7]);s.goal=30;s.events=[];s.passages.delete('7-8');g.updateControls();await g.move('right');assert.equal(g.brain.memory.get('7-8'),false);g.startNextRound(0);await flush();assert.equal(g.brain.memory.get('7-8'),false);
});
test('returning home cancels bot actions and local two-player mode does not keep a bot',async()=>{
  const ui=await start('hard'),{g,s,window,ids}=ui;s.current=1;s.phase='roll';g.renderAll();window.mazeGame.goHome();for(let i=0;i<10&&await ui.step();i++);assert.equal(s.phase,'menu');assert.equal(g.brain,null);assert.equal(ids.get('game-screen').hidden,true);window.mazeGame.startLocal();await flush();assert.equal(g.brain,null);assert.equal(ids.get('bot-match-status').hidden,true);
});

function cellNext(at,d){const moves={up:-6,down:6,left:-1,right:1};if(d==='up'&&at<6||d==='down'&&at>=30||d==='left'&&at%6===0||d==='right'&&at%6===5)return null;return at+moves[d]}
function edge(a,b){return a<b?a+'-'+b:b+'-'+a}
function routeCost(start,goal,s,blocked=[]){const denied=new Set(blocked),seen=new Set([start]),queue=[[start,0]];while(queue.length){const [at,n]=queue.shift();if(at===goal)return n;for(const d of ['up','down','left','right']){const next=cellNext(at,d);if(next!==null&&!denied.has(next)&&!seen.has(next)&&s.passages.has(edge(at,next))){seen.add(next);queue.push([next,n+1])}}}return 99}
for(const difficulty of ['easy','medium','hard'])test(difficulty+' completes a full six-point match with real movement, roulette and round transitions',async()=>{
  const ui=await start(difficulty,107),{g,s}=ui;let botTurns=0,actions=0;
  while(s.phase!=='over'&&actions++<5000){
    const active=s.forcedPlayer??s.current;
    if(active===0&&['roll','move','event','wall-select','force-select'].includes(s.phase)){
      if(s.phase==='roll')g.rollDice();
      else if(s.phase==='event')await g.spinEvent();
      else if(s.phase==='force-select'){const choices=g.forcedMoveChoices();assert.ok(choices.length);await g.move(choices.sort((a,b)=>routeCost(a.index,s.goal,s)-routeCost(b.index,s.goal,s))[0].direction)}
      else if(s.phase==='wall-select'){
        let changed=false;for(let a=0;a<36&&!changed;a++)for(const d of ['right','down']){const b=cellNext(a,d);if(b===null)continue;const open=s.passages.has(edge(a,b));if((s.wallMode==='remove'&&!open)||(s.wallMode==='install'&&open)){g.chooseWallCell(a);g.chooseWallCell(b);if(s.phase!=='wall-select'){changed=true;break}}}assert.ok(changed,'human wall event should have a legal option');
      }else{
        const options=['up','down','left','right'].map(direction=>({direction,index:cellNext(s.players[0].pos,direction)})).filter(n=>n.index===null||!s.turnVisited.has(n.index)&&n.index!==s.players[1].pos&&n.index!==35);
        assert.ok(options.length,'human must not be left with a stuck turn');options.sort((a,b)=>{const cost=n=>n.index===null||!s.passages.has(edge(s.players[0].pos,n.index))?200:routeCost(n.index,s.goal,s,[s.players[1].pos,35,...s.turnVisited]);return cost(a)-cost(b)});await g.move(options[0].direction);
      }
    }else{if(s.current===1&&s.phase==='roll')botTurns++;assert.equal(await ui.step(),true,'no timer in '+s.phase)}
    await flush();
  }
  assert.equal(s.phase,'over','match should finish within action limit');assert.ok(s.players.some(p=>p.score===6));assert.ok(botTurns>0);assert.ok(actions>30);ui.window.mazeGame.goHome();
});

test('start menu opens all three difficulty choices and launches the selected bot',async()=>{
  const vm=await import('node:vm'),{readFile}=await import('node:fs/promises'),html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="tutorial-button"[^>]*disabled/);assert.doesNotMatch(html,/id="bot-battle-button"[^>]*disabled/);
  for(const difficulty of ['easy','medium','hard']){const ui=gameUI({random:seeded(19)});ui.ids.get('game-screen').hidden=true;vm.runInContext(html.match(/<script id="menu-script">([\s\S]*?)<\/script>/)[1],ui.context);ui.ids.get('bot-battle-button').handlers.click();assert.equal(ui.ids.get('bot-difficulty-dialog').open,true);ui.ids.get('bot-'+difficulty+'-button').handlers.click();await flush();assert.equal(ui.ids.get('bot-difficulty-dialog').open,false);assert.equal(ui.ids.get('game-screen').hidden,false);assert.equal(ui.g.brain.difficulty,difficulty);ui.window.mazeGame.goHome()}
});
