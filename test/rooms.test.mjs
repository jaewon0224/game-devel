import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomServer} from '../server.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function feed(url){
  const controller=new AbortController(),response=await fetch(url,{signal:controller.signal});assert.equal(response.status,200);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',last=null;const waiters=[];
  function notify(value){last=value;for(const waiter of [...waiters])if(waiter.predicate(value)){clearTimeout(waiter.timer);waiters.splice(waiters.indexOf(waiter),1);waiter.resolve(value)}}
  const pump=(async()=>{try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').find(line=>line.startsWith('data: '));if(data)notify(JSON.parse(data.slice(6)))}}}catch(e){if(e.name!=='AbortError')throw e}})();
  return {get last(){return last},wait(predicate){if(last&&predicate(last))return Promise.resolve(last);return new Promise((resolve,reject)=>{const waiter={predicate,resolve,timer:setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('SSE timeout: '+JSON.stringify(last)))},5000)};waiters.push(waiter)})},async close(){controller.abort();await pump}};
}
test('two independent clients share a room, enforce turns and reconnect',async t=>{
  const {server,rooms}=createRoomServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;let hostFeed,guestFeed,reconnected;
  t.after(async()=>{await Promise.all([hostFeed?.close(),guestFeed?.close(),reconnected?.close()]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
  async function post(endpoint,body={},token){const response=await fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()}}
  const created=await post('/api/rooms');assert.equal(created.status,201);const host=created.data;assert.match(host.code,/^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal((await post('/api/rooms/ABCDEF/join')).status,404);
  hostFeed=await feed(base+'/api/rooms/'+host.code+'/events?token='+host.token);
  await hostFeed.wait(r=>r.players?.[0].connected);assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'start'},host.token)).status,409);
  const joined=await post('/api/rooms/'+host.code+'/join');assert.equal(joined.status,200);const guest=joined.data;
  assert.equal((await post('/api/rooms/'+host.code+'/join')).status,409);
  guestFeed=await feed(base+'/api/rooms/'+host.code+'/events?token='+guest.token);
  await hostFeed.wait(r=>r.players?.every(p=>p.connected));await guestFeed.wait(r=>r.players?.every(p=>p.connected));
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'start'},'wrong-token')).status,401);
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'start'},guest.token)).status,403);
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'start'},host.token)).status,200);
  const initial=await hostFeed.wait(r=>r.game?.phase==='roll');const same=await guestFeed.wait(r=>r.version===initial.version);assert.deepEqual(initial,same);assert.equal('passages' in initial.game,false);
  const active=initial.game.current===0?host:guest,inactive=initial.game.current===0?guest:host;
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'roll'},inactive.token)).status,400);
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'roll'},active.token)).status,200);
  const moved=await hostFeed.wait(r=>r.game?.phase==='move');await guestFeed.wait(r=>r.version===moved.version);assert.equal(guestFeed.last.game.die,moved.game.die);
  // Both sessions receive a move without the client knowing the hidden wall layout.
  const directions=['up','down','left','right'];let accepted=false;
  for(const value of directions){const result=await post('/api/rooms/'+host.code+'/command',{action:'move',value},active.token);if(result.status===200){accepted=true;break}}
  assert.ok(accepted);const afterMove=await hostFeed.wait(r=>r.version>moved.version);await guestFeed.wait(r=>r.version>=afterMove.version);assert.deepEqual(hostFeed.last.game,guestFeed.last.game);
  await guestFeed.close();await hostFeed.wait(r=>r.players?.[1].connected===false);
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'restart'},host.token)).status,409);
  reconnected=await feed(base+'/api/rooms/'+host.code+'/events?token='+guest.token);const restored=await reconnected.wait(r=>r.players?.every(p=>p.connected));assert.ok(restored.game);assert.equal(restored.code,host.code);
  assert.equal((await post('/api/rooms/'+host.code+'/command',{action:'restart'},host.token)).status,200);await hostFeed.wait(r=>r.game?.phase==='intro');
  assert.equal((await post('/api/rooms/'+host.code+'/leave',{},guest.token)).status,200);await hostFeed.wait(r=>!r.game&&!r.players[1].joined);assert.equal(rooms.get(host.code).game,null);
  assert.equal((await post('/api/rooms/'+host.code+'/join')).status,200);
  assert.equal((await post('/api/rooms/'+host.code+'/leave',{},host.token)).status,200);assert.equal(rooms.has(host.code),false);
});
test('server serves game assets and rejects cross-origin writes and private files',async t=>{
  const {server}=createRoomServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  for(const asset of ['/','/online.js','/online.css','/bot-ai.js']){const response=await fetch(base+asset);assert.equal(response.status,200);assert.ok((await response.text()).length>100)}
  assert.equal((await fetch(base+'/server.mjs')).status,404);assert.equal((await fetch(base+'/game-engine.mjs')).status,404);
  const rejected=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://elsewhere.example'},body:'{}'});assert.equal(rejected.status,403);
});
