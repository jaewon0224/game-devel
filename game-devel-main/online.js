(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORAGE = 'invisible-maze-room-v1';
  let session=null,source=null,room=null,connected=false,pending=false,revision=-1;
  function save(){try{session?sessionStorage.setItem(STORAGE,JSON.stringify(session)):sessionStorage.removeItem(STORAGE)}catch{}}
  function message(text){$('room-message').textContent=text;$('mode-message').textContent=text}
  function active(){return Boolean(session)}
  function canAct(player){return Boolean(session&&connected&&room?.players.every(p=>p.connected)&&session.player===player&&!pending)}
  function refreshGame(){window.mazeGame?.onlineControls()}
  function renderRoom(){
    const inRoom=Boolean(session),started=Boolean(room?.game);
    $('room-lobby').hidden=!inRoom||started;
    $('start-content').hidden=inRoom;
    $('room-tools').hidden=!inRoom;
    for(const id of ['event-online-status','event-leave-room-button','win-leave-room-button'])$(id).hidden=!inRoom;
    if(!inRoom)return;
    if($('mode-dialog').open)$('mode-dialog').close();
    $('room-code').textContent=session.code;$('room-code-small').textContent=session.code;
    $('my-player').textContent='나: 플레이어 '+(session.player+1)+(session.player===0?' · 방장':'');
    for(let p=0;p<2;p++){
      const info=room?.players[p],node=$('room-player-'+p);
      node.textContent='플레이어 '+(p+1)+(p===0?' · 방장':'')+(p===session.player?' · 나':'')+' — '+(info?.connected?'접속 완료':info?.joined?'재접속 대기':'참가 대기');
      node.classList.toggle('is-connected',Boolean(info?.connected));
    }
    $('room-start-button').hidden=session.player!==0;
    $('room-start-button').disabled=pending||!connected||!room?.players.every(p=>p.connected);
    $('room-wait-note').textContent=session.player===0?'친구가 참가하면 게임 시작 버튼을 눌러 주세요.':'방장이 게임을 시작하면 함께 입장합니다.';
    const ready=connected&&room?.players.every(p=>p.connected);
    $('connection-state').textContent=!connected?'서버 재연결 중…':ready?'두 명 모두 접속 중':'상대 재접속 대기 · 조작이 잠겼습니다';
    $('connection-state').classList.toggle('is-offline',!ready);
    $('event-online-status').textContent=!ready?$('connection-state').textContent:session.player===room?.game?.current?'내가 룰렛을 조작합니다.':'상대가 룰렛을 조작합니다.';
    $('new-game-button').disabled=session.player!==0||!ready||pending;
    $('new-game-button').textContent='새 게임';
    $('play-again-button').disabled=session.player!==0||!ready||pending;
    $('play-again-button').textContent=session.player===0?'같은 방에서 다시 시작':'방장의 재시작을 기다리는 중';
    refreshGame();
  }
  async function request(endpoint, payload, auth=false){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+session.token}:{})},body:JSON.stringify(payload),signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'요청을 처리하지 못했습니다.');return data;
    }catch(e){if(e.name==='AbortError')throw new Error('서버 응답이 늦습니다. 연결 상태를 확인해 주세요.');if(e instanceof TypeError)throw new Error('방 서버에 연결할 수 없습니다. 서버 주소로 접속했는지 확인해 주세요.');throw e}finally{clearTimeout(timer)}
  }
  function closeSource(){if(source)source.close();source=null;connected=false}
  function reset(reason){
    closeSource();session=null;room=null;revision=-1;save();window.mazeGame?.leaveOnline();
    $('game-screen').hidden=true;$('start-screen').hidden=false;$('start-content').hidden=false;$('room-lobby').hidden=true;$('room-tools').hidden=true;
    for(const id of ['event-online-status','event-leave-room-button','win-leave-room-button'])$(id).hidden=true;
    $('new-game-button').disabled=false;$('play-again-button').disabled=false;$('play-again-button').textContent='새 게임 시작';
    message(reason||'방에서 나왔습니다.');
  }
  function connect(){
    closeSource();revision=-1;renderRoom();
    const activeSession=session;
    source=new EventSource('/api/rooms/'+session.code+'/events?token='+encodeURIComponent(session.token));
    source.onmessage=event=>{
      if(session!==activeSession)return;
      let next;try{next=JSON.parse(event.data)}catch{return}
      if(next.version<revision)return;revision=next.version;room=next;connected=true;
      if(room.game){window.mazeGame.onlineSnapshot(room.game,session.player);$('start-screen').hidden=true;$('game-screen').hidden=false}
      else {window.mazeGame.leaveOnline();$('game-screen').hidden=true;$('start-screen').hidden=false;message('초대 코드를 친구에게 공유하세요.')}
      renderRoom();
    };
    source.onerror=()=>{
      if(session!==activeSession)return;
      connected=false;renderRoom();message('서버 연결을 다시 시도하고 있습니다.');
      // A JSON error closes invalid sessions; temporary network failures keep EventSource retrying.
      fetch('/api/rooms/'+session.code+'/events?token='+encodeURIComponent(session.token),{method:'HEAD'}).then(response=>{if(session===activeSession&&[401,404].includes(response.status))reset('방이 종료되었거나 참가 정보가 만료되었습니다.')}).catch(()=>{});
    };
    source.addEventListener('ended',()=>{if(session===activeSession)reset('방이 종료되었습니다. 새 방을 만들거나 다른 방에 참가하세요.')});
  }
  async function enter(join){
    if(pending||session)return;
    if(!['http:','https:'].includes(location.protocol)){message('온라인 플레이는 서버로 접속해야 합니다. 터미널에서 npm start 실행 후 표시된 주소를 열어 주세요.');return}
    const code=$('join-code').value.trim().toUpperCase();
    if(join&&!/^[A-HJ-NP-Z2-9]{6}$/.test(code)){message('영문과 숫자로 된 6자리 방 코드를 입력하세요.');$('join-code').focus();return}
    pending=true;$('create-room-button').disabled=true;$('join-room-button').disabled=true;message(join?'방에 참가하는 중…':'방을 만드는 중…');
    try{session=await request(join?'/api/rooms/'+code+'/join':'/api/rooms',{});save();connect()}catch(e){message(e.message)}finally{pending=false;$('create-room-button').disabled=false;$('join-room-button').disabled=false;renderRoom()}
  }
  async function command(action,value){
    if(!session||pending)return;
    pending=true;renderRoom();
    try{await request('/api/rooms/'+session.code+'/command',{action,value},true)}catch(e){message(e.message);if(room?.game)$('message').textContent=e.message}finally{pending=false;renderRoom()}
  }
  async function leave(){
    if(!session||pending)return;
    pending=true;renderRoom();
    try{await request('/api/rooms/'+session.code+'/leave',{},true);reset()}catch(e){message(e.message);if(room?.game)$('message').textContent=e.message}finally{pending=false;renderRoom()}
  }
  async function copy(){
    try{await navigator.clipboard.writeText(session.code);message('방 코드를 복사했습니다. 친구에게 보내 주세요.');$('connection-state').textContent='방 코드 복사 완료: '+session.code}catch{message('방 코드 '+session.code+'를 친구에게 알려 주세요.');$('connection-state').textContent='방 코드: '+session.code}
  }
  $('create-room-button').addEventListener('click',()=>enter(false));
  $('join-form').addEventListener('submit',event=>{event.preventDefault();enter(true)});
  $('join-code').addEventListener('input',()=>{$('join-code').value=$('join-code').value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6)});
  $('room-start-button').addEventListener('click',()=>command('start'));
  for(const id of ['copy-room-button','copy-room-small'])$(id).addEventListener('click',copy);
  for(const id of ['leave-room-button','leave-room-small','event-leave-room-button','win-leave-room-button'])$(id).addEventListener('click',leave);
  window.mazeOnline={active,canAct,command,get player(){return session?.player}};
  try{const previous=JSON.parse(sessionStorage.getItem(STORAGE));if(previous&&/^[A-HJ-NP-Z2-9]{6}$/.test(previous.code)&&typeof previous.token==='string'&&[0,1].includes(previous.player))session=previous}catch{}
  if(session&&['http:','https:'].includes(location.protocol))connect();
})();
