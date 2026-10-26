import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const source=await readFile(new URL('../online.js',import.meta.url),'utf8');
function client(previous){
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{hidden:false,disabled:false,textContent:'',value:'',handlers:{},classList:{toggle(){}},focus(){},addEventListener(type,callback){this.handlers[type]=callback}}]));
  const storage=new Map(previous?[['invisible-maze-room-v1',JSON.stringify(previous)]]:[]),events=[],requests=[],snapshots=[];
  class EventSource{constructor(url){this.url=url;this.handlers={};events.push(this)}addEventListener(type,fn){this.handlers[type]=fn}close(){this.closed=true}emit(data){this.onmessage({data:JSON.stringify(data)})}}
  const document={getElementById(id){assert.ok(nodes.has(id),'Missing HTML element: '+id);return nodes.get(id)}};
  const context=vm.createContext({document,location:{protocol:'http:'},navigator:{clipboard:{async writeText(){}}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},EventSource,AbortController,setTimeout,clearTimeout,console,fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:options.method==='HEAD'?405:200,json:async()=>url==='/api/rooms'?{code:'ABC234',token:'host-secret',player:0}:{ok:true}}},window:{mazeGame:{onlineControls(){},onlineSnapshot(data,player){snapshots.push({data,player})},leaveOnline(){}}}});
  vm.runInContext(source,context);return{nodes,events,requests,snapshots,context,click:async id=>nodes.get(id).handlers.click()};
}
const room=(version,game=null,connected=true)=>({code:'ABC234',version,players:[{joined:true,connected:true},{joined:true,connected}],game});
test('client opens lobby, waits for the second player, starts and locks inputs during disconnect',async()=>{
  const c=client();await c.click('create-room-button');assert.equal(c.events.length,1);assert.equal(c.nodes.get('room-lobby').hidden,false);
  c.events[0].emit(room(1,null,false));assert.equal(c.nodes.get('room-start-button').disabled,true);
  c.events[0].emit(room(2));assert.equal(c.nodes.get('room-start-button').disabled,false);
  await c.click('room-start-button');assert.equal(JSON.parse(c.requests.at(-1).options.body).action,'start');
  c.events[0].emit(room(3,{phase:'roll',current:0}));assert.equal(c.snapshots.length,1);assert.equal(c.nodes.get('game-screen').hidden,false);assert.equal(c.context.window.mazeOnline.canAct(0),true);assert.equal(c.context.window.mazeOnline.canAct(1),false);
  c.events[0].onerror();assert.equal(c.context.window.mazeOnline.canAct(0),false);assert.match(c.nodes.get('event-online-status').textContent,/再|재연결/);
  c.events[0].emit(room(4,{phase:'roll',current:0}));assert.equal(c.context.window.mazeOnline.canAct(0),true);
  await c.click('event-leave-room-button');assert.equal(c.context.window.mazeOnline.active(),false);assert.equal(c.nodes.get('start-screen').hidden,false);assert.equal(c.nodes.get('event-leave-room-button').hidden,true);
});
test('reload restores the guest seat and cannot expose host start controls',()=>{
  const c=client({code:'ABC234',token:'guest-secret',player:1});assert.equal(c.events.length,1);c.events[0].emit(room(5,{phase:'force-select',current:0,forcedPlayer:1}));assert.equal(c.nodes.get('room-start-button').hidden,true);assert.equal(c.nodes.get('new-game-button').disabled,true);assert.equal(c.context.window.mazeOnline.canAct(1),true);assert.equal(c.snapshots[0].player,1);
  c.events[0].handlers.ended();assert.equal(c.context.window.mazeOnline.active(),false);assert.equal(c.nodes.get('game-screen').hidden,true);
});
test('invalid room code fails before sending a request and both scripts parse',async()=>{
  const c=client();c.nodes.get('join-code').value='BAD';await c.nodes.get('join-form').handlers.submit({preventDefault(){}});assert.equal(c.requests.length,0);assert.match(c.nodes.get('room-message').textContent,/6자리/);new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
});
