import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
const botSource=await readFile(new URL('../bot-ai.js',import.meta.url),'utf8');
const original=html.match(/<script>([\s\S]*?)<\/script>/)[1];
// Exercise the actual game handlers with deterministic DOM, animation and timer adapters.
export function gameUI({reduced=true,random=Math.random}={}){
  const pending=[],timers=new Map(),ids=new Map();let timerId=0,online=false,now=0,randomSource=random;
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.className='';this.style={setProperty:(k,v)=>{this.style[k]=v}};this.handlers={};this.open=false;this.hidden=false;this.disabled=false;this.textContent='';this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' ').filter(Boolean),...names])].join(' ')},remove:(...names)=>{this.className=this.className.split(' ').filter(n=>!names.includes(n)).join(' ')},contains:name=>this.className.split(' ').includes(name),toggle:(name,on)=>{on??=!this.classList.contains(name);on?this.classList.add(name):this.classList.remove(name);return on}}}
    get childNodes(){return this.children}
    append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node)}}
    remove(){if(this.parent){this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null}}
    replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes)}
    setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v)}
    getAttribute(k){return this.attributes[k]??null}
    removeAttribute(k){delete this.attributes[k]}
    matches(selector){if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));const match=selector.match(/^\[([^=\]]+)(?:="([^"\]]*)")?\]$/);if(!match)return false;const key=match[1],value=key.startsWith('data-')?this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]:this.attributes[key];return match[2]===undefined?value!==undefined:value===match[2]}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)])}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null}
    closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null}
    addEventListener(type,fn){this.handlers[type]=fn}
    focus(){} scrollIntoView(){}
    showModal(){this.open=true}close(){this.open=false;this.handlers.close?.()}
    getBoundingClientRect(){const index=Number(this.closest('.cell')?.dataset.index||0),size=this.classList.contains('pawn')?16:40;return {left:(index%6)*40,top:Math.floor(index/6)*40,width:size,height:size}}
    animate(keyframes,options){let resolve,reject,done=false;const finished=new Promise((yes,no)=>{resolve=()=>{done=true;yes()};reject=no});const animation={finished,keyframes,options,finish:resolve,cancel(){if(!done){done=true;reject(new Error('cancelled'))}}};pending.push(animation);return animation}
  }
  const body=new Element('body');for(const [,id] of html.matchAll(/id="([^"]+)"/g)){const node=new Element();ids.set(id,node);body.append(node)}
  const buttons=['up','down','left','right'].map(direction=>{const node=new Element('button');node.dataset.direction=direction;body.append(node);return node});
  const document={body,handlers:{},getElementById:id=>{assert.ok(ids.has(id),'Missing element '+id);return ids.get(id)},createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag),querySelectorAll:selector=>body.querySelectorAll(selector),addEventListener(type,fn){this.handlers[type]=fn}};
  const window={innerWidth:1200,innerHeight:900,matchMedia:()=>({matches:reduced}),mazeOnline:{active:()=>online,canAct:()=>true,command(){}}};
  const testMath=Object.create(Math);testMath.random=()=>randomSource();
  const context=vm.createContext({window,document,console,Math:testMath,setTimeout:(fn,delay)=>{timers.set(++timerId,{fn,delay,at:now+delay});return timerId},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>queueMicrotask(fn)});
  vm.runInContext(botSource,context);window.MazeBot=context.MazeBot;
  const injected=original.replace('window.mazeGame={','window.testGame={state,renderAll,updateControls,endTurn,rollDice,spinEvent,move,startNextRound,beginForcedMove,chooseForcedMove,beginWallSelection,chooseWallCell,applyEvent,scoreGoal,newGame,botView,forcedMoveChoices,viewDirection,get brain(){return botBrain},get angle(){return boardRotation},get rotating(){return boardRotating}};window.mazeGame={');vm.runInContext(injected,context);
  const g=window.testGame,s=g.state;s.phase='roll';s.current=0;s.goal=30;s.events=[];s.players[0].pos=7;s.players[1].pos=28;s.passages=new Set();for(let i=0;i<36;i++){if(i%6<5)s.passages.add(i+'-'+(i+1));if(i<30)s.passages.add(i+'-'+(i+6))}s.turnVisited=new Set([7]);
  return{g,s,window,document,ids,buttons,pending,timers,context,setRandom:fn=>{randomSource=fn},async step(){const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)return false;now=entry[1].at;timers.delete(entry[0]);await entry[1].fn();await flush();return true},setOnline:value=>{online=value},finish:()=>{for(const animation of pending.splice(0))animation.finish()},runTimers:delay=>{for(const [id,t] of [...timers])if(t.delay===delay){timers.delete(id);t.fn()}}};
}
export const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
