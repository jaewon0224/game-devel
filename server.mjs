import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, randomInt} from 'node:crypto';
import {networkInterfaces} from 'node:os';
import {pathToFileURL} from 'node:url';
import {Game} from './game-engine.mjs';

const ROOT = new URL('./', import.meta.url);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const token = () => randomBytes(24).toString('base64url');
const newCode = () => Array.from({length:6},()=>ALPHABET[randomInt(ALPHABET.length)]).join('');
const error = (message,status=400) => Object.assign(new Error(message),{status});
export function createRoomServer() {
  const rooms=new Map(),limits=new Map();
  const publicRoom=room=>({code:room.code,version:room.version,players:room.seats.map((seat,index)=>({player:index,joined:Boolean(seat),connected:Boolean(seat?.streams.size)})),game:room.game?.snapshot()||null});
  function broadcast(room) { room.version++;const data='data: '+JSON.stringify(publicRoom(room))+'\n\n';for(const seat of room.seats)for(const stream of seat?.streams||[])stream.write(data); }
  function removeRoom(room) { room.game?.dispose();for(const seat of room.seats)for(const stream of seat?.streams||[]){stream.write('event: ended\ndata: {}\n\n');stream.end()}rooms.delete(room.code); }
  function limit(req) {
    const now=Date.now(),key=req.socket.remoteAddress;let value=limits.get(key);
    if(!value||now-value.start>60000){value={start:now,count:0};limits.set(key,value)}
    if(++value.count>180)throw error('요청이 너무 많습니다. 잠시 후 다시 시도하세요.',429);
  }
  async function body(req) {
    if(!req.headers['content-type']?.startsWith('application/json'))throw error('JSON 요청이 필요합니다.',415);
    if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin)}catch{throw error('허용되지 않은 요청입니다.',403)}if(origin.host!==req.headers.host)throw error('허용되지 않은 요청입니다.',403)}
    let size=0,parts=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw error('요청이 너무 큽니다.',413);parts.push(chunk)}
    try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw error('올바르지 않은 요청입니다.')}
  }
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='POST'&&url.pathname==='/api/rooms'){
        limit(req);await body(req);if(rooms.size>=1000)throw error('현재 방이 가득 찼습니다. 잠시 후 다시 시도하세요.',503);
        let code;do{code=newCode()}while(rooms.has(code));const secret=token();
        const room={code,seats:[{token:secret,streams:new Set()},null],game:null,version:0,updated:Date.now()};rooms.set(code,room);
        send(res,201,{code,token:secret,player:0});return;
      }
      const match=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})\/(join|events|command|leave)$/);
      if(match){
        const room=rooms.get(match[1]);if(!room)throw error('방을 찾을 수 없습니다. 코드를 확인하거나 새 방을 만들어 주세요.',404);
        if(req.method==='POST'&&match[2]==='join'){
          limit(req);await body(req);if(room.seats[1])throw error('이미 두 명이 참가한 방입니다.',409);
          const secret=token();room.seats[1]={token:secret,streams:new Set()};room.updated=Date.now();broadcast(room);send(res,200,{code:room.code,token:secret,player:1});return;
        }
        const secret=match[2]==='events'?url.searchParams.get('token'):req.headers.authorization?.replace(/^Bearer /,'');
        const player=room.seats.findIndex(seat=>seat&&seat.token===secret);if(player<0)throw error('참가 정보가 올바르지 않습니다. 방에 다시 참가해 주세요.',401);
        const seat=room.seats[player];room.updated=Date.now();
        if(req.method==='GET'&&match[2]==='events'){
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 1500\n\n');seat.streams.add(res);broadcast(room);
          const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),20000);heartbeat.unref();
          res.on('close',()=>{clearInterval(heartbeat);seat.streams.delete(res);if(rooms.get(room.code)===room){room.updated=Date.now();broadcast(room)}});return;
        }
        if(req.method==='POST'&&match[2]==='leave'){
          limit(req);await body(req);
          if(player===0){removeRoom(room)}else{room.game?.dispose();room.game=null;room.seats[1]=null;for(const stream of seat.streams){stream.write('event: ended\ndata: {}\n\n');stream.end()}broadcast(room)}
          send(res,200,{ok:true});return;
        }
        if(req.method==='POST'&&match[2]==='command'){
          limit(req);const input=await body(req);
          if(!room.seats.every(s=>s?.streams.size))throw error('두 플레이어가 모두 접속할 때까지 기다려 주세요.',409);
          if(input.action==='start'||input.action==='restart'){
            if(player!==0)throw error('방장만 게임을 시작할 수 있습니다.',403);
            if(input.action==='start'&&room.game)throw error('이미 게임이 시작되었습니다.',409);
            room.game?.dispose();room.game=new Game(()=>{room.updated=Date.now();broadcast(room)});broadcast(room);
          }else{
            if(!room.game)throw error('방장이 게임을 시작할 때까지 기다려 주세요.',409);
            room.game.command(player,input.action,input.value);
          }
          send(res,200,{ok:true});return;
        }
        throw error('지원하지 않는 요청입니다.',405);
      }
      if(url.pathname.startsWith('/api/'))throw error('올바른 방 코드를 입력해 주세요.',404);
      const files={'/':'index.html','/index.html':'index.html','/online.js':'online.js','/bot-ai.js':'bot-ai.js','/online.css':'online.css'};
      const file=files[url.pathname];if(!file||!['GET','HEAD'].includes(req.method))throw error('페이지를 찾을 수 없습니다.',404);
      const bytes=await readFile(new URL(file,ROOT));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
    }catch(e){if(!res.headersSent)send(res,e.status||400,{error:e.message||'요청을 처리하지 못했습니다.'});else res.end()}
  });
  const sweep=setInterval(()=>{const now=Date.now();for(const room of rooms.values())if(!room.seats.some(s=>s?.streams.size)&&now-room.updated>30*60000)removeRoom(room);for(const [key,value] of limits)if(now-value.start>60000)limits.delete(key)},60000);sweep.unref();
  server.on('close',()=>{clearInterval(sweep);for(const room of rooms.values())room.game?.dispose()});
  return {server,rooms};
}
if(globalThis.process?.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const port=Number(process.env.PORT||3000);const {server}=createRoomServer();
  server.listen(port,'0.0.0.0',()=>{console.log('보이지 않는 미로: http://localhost:'+port);for(const list of Object.values(networkInterfaces()))for(const address of list||[])if(address.family==='IPv4'&&!address.internal)console.log('같은 Wi-Fi 접속: http://'+address.address+':'+port)});
  server.on('error',e=>{console.error('서버 시작 실패:',e.message);process.exitCode=1});
}
