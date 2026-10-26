// Authoritative rules for room games. Hidden passages never leave the server.
export const SIZE = 6, CELLS = 36, STARTS = [0, 35];
const DIRS = {up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1]};
const EVENTS = [{type:'install', weight:28}, {type:'remove', weight:28}, {type:'rebuild', weight:14}, {type:'force', weight:30}];
const edge = (a,b) => a < b ? a+'-'+b : b+'-'+a;
export function adjacent(at, direction) {
  const d = DIRS[direction]; if (!d) return null;
  const r = Math.floor(at/SIZE)+d[0], c = at%SIZE+d[1];
  return r < 0 || r >= SIZE || c < 0 || c >= SIZE ? null : r*SIZE+c;
}
const neighbors = at => Object.keys(DIRS).map(direction => ({direction,index:adjacent(at,direction)})).filter(n => n.index !== null);
function shuffle(list, random) { for(let i=list.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[list[i],list[j]]=[list[j],list[i]]} return list; }
export class Game {
  constructor(publish = () => {}, options = {}) {
    this.publish = publish; this.random = options.random || Math.random;
    this.schedule = options.schedule || setTimeout; this.cancel = options.cancel || clearTimeout;
    this.timers = new Set(); this.disposed = false;
    this.state = {round:1,current:Math.floor(this.random()*2),phase:'intro',movesLeft:0,die:1,goal:1,events:[],passages:new Set(),turnVisited:new Set(),tempInstalled:new Set(),tempRemoved:new Set(),wallMode:null,wallFirst:null,forcedPlayer:null,eventType:null,players:[{score:0,pos:0,lastPos:null,used:new Set()},{score:0,pos:35,lastPos:null,used:new Set()}],message:'새로운 미로가 생성되었습니다.'};
    this.generateMaze(); this.placeItems(); this.intro();
  }
  later(fn, ms) { const id=this.schedule(() => {this.timers.delete(id);if(!this.disposed)fn()},ms);this.timers.add(id); }
  dispose() { this.disposed=true;for(const id of this.timers)this.cancel(id);this.timers.clear(); }
  emit(message) { if(message)this.state.message=message;this.publish(); }
  intro() { this.state.phase='intro';this.later(() => {this.state.phase='roll';this.emit('플레이어 '+(this.state.current+1)+'이 주사위를 굴려 시작하세요.')},1250); }
  generateMaze() {
    const passages=new Set(), seen=new Set([0]), stack=[0];
    while(stack.length){const at=stack[stack.length-1],choices=shuffle(neighbors(at).filter(n=>!seen.has(n.index)),this.random);if(!choices.length){stack.pop();continue}const next=choices[0].index;passages.add(edge(at,next));seen.add(next);stack.push(next)}
    for(let at=0;at<CELLS;at++)for(const n of neighbors(at))if(at<n.index&&!passages.has(edge(at,n.index))&&this.random()<.18)passages.add(edge(at,n.index));
    let changed=true;while(changed){changed=false;for(let at=0;at<CELLS;at++)if(neighbors(at).filter(n=>passages.has(edge(at,n.index))).length<2){const choices=shuffle(neighbors(at).filter(n=>!passages.has(edge(at,n.index))),this.random);if(choices.length){passages.add(edge(at,choices[0].index));changed=true}}}
    this.state.passages=passages;
  }
  connected() { const seen=new Set([0]),queue=[0];while(queue.length){const at=queue.shift();for(const n of neighbors(at))if(this.state.passages.has(edge(at,n.index))&&!seen.has(n.index)){seen.add(n.index);queue.push(n.index)}}return seen.size===CELLS; }
  placeItems() { const open=shuffle(Array.from({length:CELLS},(_,i)=>i).filter(i=>!STARTS.includes(i)),this.random);this.state.goal=open[0];this.state.events=open.slice(1,4); }
  activePlayer() { return this.state.forcedPlayer ?? this.state.current; }
  forcedChoices() {
    const s=this.state;if(s.forcedPlayer===null)return [];
    const p=s.players[s.forcedPlayer],other=1-s.forcedPlayer;
    return neighbors(p.pos).filter(n=>s.passages.has(edge(p.pos,n.index))&&n.index!==p.lastPos&&n.index!==s.players[other].pos&&n.index!==STARTS[other]);
  }
  snapshot() {
    const {passages,tempInstalled,tempRemoved,turnVisited,players,...visible}=this.state;
    return {...visible,turnVisited:[...turnVisited],wallChanges:tempInstalled.size+tempRemoved.size,forcedChoices:this.state.phase==='force-select'?this.forcedChoices():[],players:players.map(p=>({...p,used:[...p.used]}))};
  }
  command(player, action, value) {
    if(this.disposed)throw new Error('종료된 게임입니다.');
    const s=this.state;if(player!==this.activePlayer())throw new Error('상대의 차례입니다.');
    if(action==='roll'&&s.phase==='roll'){s.phase='rolling';this.emit('주사위를 굴리는 중입니다.');this.later(()=>{s.die=1+Math.floor(this.random()*6);s.movesLeft=s.die;s.turnVisited=new Set([s.players[s.current].pos]);s.phase='move';this.emit('주사위 '+s.die+'! 이동할 방향을 선택하세요.')},480);return}
    if(action==='move'&&['move','force-select'].includes(s.phase)){if(!Object.hasOwn(DIRS,value))throw new Error('올바른 방향을 선택하세요.');this.move(value);return}
    if(action==='spin'&&s.phase==='event'){this.spin();return}
    if(action==='wall'&&s.phase==='wall-select'){if(!Number.isInteger(value)||value<0||value>=CELLS)throw new Error('올바른 칸을 선택하세요.');this.wall(value);return}
    throw new Error('지금은 이 동작을 할 수 없습니다.');
  }
  endTurn() { const s=this.state;s.current=1-s.current;s.phase='roll';s.movesLeft=0;s.turnVisited.clear();s.forcedPlayer=null;s.eventType=null;this.emit('플레이어 '+(s.current+1)+'의 차례입니다. 주사위를 굴리세요.'); }
  move(direction) {
    const s=this.state,forced=s.phase==='force-select',index=this.activePlayer(),p=s.players[index],next=adjacent(p.pos,direction);
    if(forced){if(!this.forcedChoices().some(n=>n.direction===direction))throw new Error('선택할 수 없는 방향입니다.');}
    else if(next!==null&&(s.turnVisited.has(next)||next===s.players[1-index].pos||next===STARTS[1-index]))throw new Error('이번 턴에 방문한 칸이나 상대의 칸으로 이동할 수 없습니다.');
    if(next===null||!s.passages.has(edge(p.pos,next))){p.pos=STARTS[index];p.lastPos=null;s.movesLeft=0;s.phase='collision';this.emit('벽에 부딪혀 출발칸으로 돌아갑니다.');this.later(()=>this.endTurn(),900);return}
    p.lastPos=p.pos;p.pos=next;
    if(forced){s.forcedPlayer=null;if(next===s.goal){this.score(index);return}this.finishEvent('상대가 선택한 방향으로 한 칸 이동했습니다.');return}
    s.turnVisited.add(next);s.movesLeft--;
    if(next===s.goal){this.score(index);return}
    if(s.events.includes(next)&&!p.used.has(next)){p.used.add(next);s.movesLeft=0;s.phase='event';s.eventType=null;this.emit('이벤트 칸을 사용했습니다. 룰렛을 돌려 효과를 확인하세요.');return}
    if(s.movesLeft<=0){s.phase='pause';this.emit('이동을 모두 마쳤습니다. 상대의 차례로 넘어갑니다.');this.later(()=>this.endTurn(),350);return}
    this.emit('한 칸 이동했습니다. 남은 이동 '+s.movesLeft+'칸.');
  }
  score(index) {
    const s=this.state;s.players[index].score++;s.movesLeft=0;s.forcedPlayer=null;
    s.phase=s.players[index].score>=6?'over':'pause';this.emit('플레이어 '+(index+1)+'이 목적지에 도착해 1점을 얻었습니다!');
    if(s.phase==='over')return;
    this.later(()=>{for(const e of s.tempInstalled)s.passages.add(e);for(const e of s.tempRemoved)s.passages.delete(e);s.tempInstalled.clear();s.tempRemoved.clear();s.wallMode=null;s.wallFirst=null;s.eventType=null;s.turnVisited.clear();s.round++;s.current=1-index;s.players.forEach((p,i)=>{p.pos=STARTS[i];p.lastPos=null;p.used.clear()});this.placeItems();this.intro();this.emit('새 라운드의 목적지가 도착했습니다.')},950);
  }
  spin() {
    const s=this.state;let roll=this.random()*100;const chosen=EVENTS.find(e=>(roll-=e.weight)<0)||EVENTS[0];
    s.eventType=chosen.type;s.phase='roulette';this.emit('룰렛이 돌아가고 있어요…');
    this.later(()=>{s.phase='event-result';this.emit('룰렛 결과를 확인하세요.');this.later(()=>this.applyEvent(),1800)},3600);
  }
  finishEvent(message) { this.state.phase='pause';this.state.movesLeft=0;this.emit(message||'이벤트 처리가 끝났습니다. 상대의 차례로 넘어갑니다.');this.later(()=>this.endTurn(),450); }
  applyEvent() {
    const s=this.state;
    if(s.eventType==='install'||s.eventType==='remove'){s.wallMode=s.eventType;s.wallFirst=null;s.phase='wall-select';this.emit(s.wallMode==='install'?'벽을 설치할 인접한 두 칸을 선택하세요.':'지울 벽 양쪽의 두 칸을 선택하세요.');return}
    if(s.eventType==='rebuild'){s.tempInstalled.clear();s.tempRemoved.clear();this.generateMaze();this.finishEvent('미로의 벽을 새로 구성했습니다.');return}
    s.forcedPlayer=1-s.current;
    if(!this.forcedChoices().length){s.forcedPlayer=null;this.finishEvent('이동 가능한 방향이 없어 강제 이동을 마칩니다.');return}
    s.phase='force-select';this.emit('플레이어 '+(s.forcedPlayer+1)+'이 직접 강제 이동 방향을 선택하세요.');
  }
  wall(cell) {
    const s=this.state;
    if(s.wallFirst===null){s.wallFirst=cell;this.emit('선택한 칸과 맞닿은 두 번째 칸을 선택하세요.');return}
    const first=s.wallFirst;
    if(!neighbors(first).some(n=>n.index===cell)){s.wallFirst=cell;this.emit('서로 맞닿은 두 칸이어야 합니다. 새 첫 번째 칸을 선택했어요.');return}
    const e=edge(first,cell);s.wallFirst=null;
    if(s.wallMode==='install'){
      if(!s.passages.has(e)){this.emit('이미 벽이 있는 위치입니다. 다른 위치를 선택하세요.');return}
      s.passages.delete(e);if(!this.connected()){s.passages.add(e);this.emit('모든 칸이 연결되도록 다른 위치를 선택하세요.');return}
      if(!s.tempRemoved.delete(e))s.tempInstalled.add(e);
    }else{
      if(s.passages.has(e)){this.emit('벽이 없습니다. 다른 위치를 선택하세요.');return}
      s.passages.add(e);if(!s.tempInstalled.delete(e))s.tempRemoved.add(e);
    }
    s.wallMode=null;this.finishEvent('선택한 벽을 변경했습니다. 다음 라운드에 원래대로 돌아옵니다.');
  }
}
