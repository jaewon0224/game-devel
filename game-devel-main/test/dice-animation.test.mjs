import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../dice.js',import.meta.url),'utf8');

function scene(reduced=false,rounded=true){
  const frames=new Map();let id=0,now=0;
  class Element{
    constructor(){this.children=[];this.dataset={};this.attributes={};this.style={setProperty:(k,v)=>{this.style[k]=v}};this.classList={add(){},remove(){}};this.textContent=''}
    append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=[...nodes]}setAttribute(k,v){this.attributes[k]=v}
  }
  const nodes=Object.fromEntries(['stage','body','shadow','contact','impact','result'].map(key=>[key,new Element()]));
  const window={matchMedia:()=>({matches:reduced})};
  if(rounded)window.MazeDiceRenderer={create:()=>({draw:()=>true})};
  const context=vm.createContext({window,Math,document:{createElement:()=>new Element()},requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(source,context);const dice=window.MazeDice.create(nodes);
  function step(){now+=1000/60;const callbacks=[...frames.values()];frames.clear();for(const callback of callbacks)callback(now)}
  function pose(){const text=nodes.body.style.transform;const translation=text.match(/translate3d\(([^)]+)\)/)[1].split(',').map(parseFloat);const matrix=text.match(/matrix3d\(([^)]+)\)/)[1].split(',').map(Number);return {translation,matrix}}
  function top(){const {matrix:m}=pose(),normals={1:[0,0,1],6:[0,0,-1],2:[1,0,0],5:[-1,0,0],3:[0,-1,0],4:[0,1,0]};return Number(Object.entries(normals).sort((a,b)=>{const z=n=>m[2]*n[0]+m[6]*n[1]+m[10]*n[2];return z(b[1])-z(a[1])})[0][0])}
  return {dice,nodes,frames,step,pose,top};
}

for(let value=1;value<=6;value++)test('animated die lands with '+value+' on top and never passes through the floor',async()=>{
  const s=scene(),finished=s.dice.roll(value);let highest=0,restingPose=null;
  for(let i=0;i<300&&s.frames.size;i++){
    s.step();const {translation,matrix:m}=s.pose();
    assert.ok([...translation,...m].every(Number.isFinite));
    const support=30*(Math.abs(m[2])+Math.abs(m[6])+Math.abs(m[10]))+14;
    assert.ok(translation[2]>=support-1e-8,'The rounded cube stays above the floor');highest=Math.max(highest,translation[2]-support);
    if(i>=120){
      assert.equal(s.top(),value,'The selected face is already on top at the final landing');
      const pose=[...translation,...m];
      if(restingPose)assert.ok(pose.every((number,index)=>Math.abs(number-restingPose[index])<1e-8),'The resting die never slides or rotates to correct its result');
      restingPose=pose;
    }
  }
  assert.equal(s.frames.size,0);assert.equal(await finished,true);assert.ok(highest>200);
  assert.equal(s.top(),value);assert.equal(s.nodes.result.children[0].textContent,String(value));
});

test('a delayed server result is required before the die settles',async()=>{
  const s=scene(),before=s.nodes.body.style.transform;let done=false;const finished=s.dice.roll(null).then(value=>{done=true;return value});
  for(let i=0;i<300;i++)s.step();await Promise.resolve();assert.equal(done,false);
  assert.equal(s.nodes.body.style.transform,before,'The die waits for the server before choosing its launch trajectory');
  s.dice.setResult(9);for(let i=0;i<60;i++)s.step();await Promise.resolve();assert.equal(done,false);
  s.dice.setResult(4);for(let i=0;i<240&&s.frames.size;i++)s.step();
  assert.equal(await finished,true);assert.equal(s.top(),4);
});

test('an in-flight result cannot be changed by a later update',async()=>{
  const s=scene(),finished=s.dice.roll(2);
  for(let i=0;i<75;i++)s.step();s.dice.setResult(6);
  for(let i=0;i<200&&s.frames.size;i++)s.step();
  assert.equal(await finished,true);assert.equal(s.top(),2);
  assert.equal(s.nodes.result.children[0].textContent,'2');
});

test('reduced motion shows the authoritative face without falling or spinning',async()=>{
  const s=scene(true),finished=s.dice.roll(6);
  for(let i=0;i<60&&s.frames.size;i++){s.step();assert.equal(s.top(),6);assert.ok(Math.abs(s.pose().translation[2]-44)<1e-8)}
  assert.equal(await finished,true);assert.equal(s.frames.size,0);
});

test('cancelling an in-flight die stops frames and resolves without a result',async()=>{
  const s=scene(),finished=s.dice.roll(2);s.step();s.dice.cancel();
  assert.equal(await finished,false);assert.equal(s.frames.size,0);
  s.dice.reset();assert.equal(s.nodes.result.children.length,0);
});

test('the CSS fallback keeps the selected result when 3D rendering is unavailable',async()=>{
  const s=scene(false,false),finished=s.dice.roll(3);
  for(let i=0;i<240&&s.frames.size;i++)s.step();
  assert.equal(await finished,true);assert.equal(s.top(),3);
});
