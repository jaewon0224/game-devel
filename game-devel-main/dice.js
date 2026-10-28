// A six-sided die in a fixed, overhead scene. Only the presentation chooses a
// trajectory; the local game or authoritative server supplies the final value.
(()=>{
  'use strict';
  const HALF=44,ROUND=14, DOTS={1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const NORMALS={1:[0,0,1],6:[0,0,-1],2:[1,0,0],5:[-1,0,0],3:[0,-1,0],4:[0,1,0]};
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  function multiply(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]]}
  const axis=(x,y,z,a)=>[x*Math.sin(a/2),y*Math.sin(a/2),z*Math.sin(a/2),Math.cos(a/2)];
  function rotation(x,y,z){return multiply(axis(0,0,1,z),multiply(axis(0,1,0,y),axis(1,0,0,x)))}
  function matrix([x,y,z,w]){return [1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y)]}
  function faceUp(value,yaw){const poses={1:[0,0],2:[0,-Math.PI/2],3:[-Math.PI/2,0],4:[Math.PI/2,0],5:[0,Math.PI/2],6:[Math.PI,0]};return rotation(...poses[value],yaw)}
  function create({stage,body,shadow,contact,impact,result}){
    const faces=[];
    for(let value=1;value<=6;value++){
      const face=document.createElement('div');face.className='dice-face';face.dataset.value=String(value);
      for(let i=0;i<9;i++){const pip=document.createElement('span');if(DOTS[value].includes(i))pip.className='dice-pip';face.append(pip)}
      body.append(face);faces.push(face);
    }
    let renderer=window.MazeDiceRenderer?.create({stage,body})||null;
    let frame=0,resolveRoll=null,chosen=null,settled=false;
    function draw(x,y,lift,q,ring=0){
      const m=matrix(q),round=renderer?ROUND:0,support=(HALF-round)*(Math.abs(m[2])+Math.abs(m[5])+Math.abs(m[8]))+round;
      body.style.transform=`translate3d(${x}px,${y}px,${support+lift}px) matrix3d(${m[0]},${m[1]},${m[2]},0,${m[3]},${m[4]},${m[5]},0,${m[6]},${m[7]},${m[8]},0,0,0,0,1)`;
      shadow.style.transform=`translate3d(${x+lift*.18}px,${y+lift*.12}px,0) scale(${1+lift/170})`;
      shadow.style.opacity=String(.8-lift/650);shadow.style.filter=`blur(${3+lift/30}px)`;
      contact.style.transform=`translate3d(${x}px,${y}px,1px) rotate(${Math.atan2(m[1],m[0])}rad)`;
      contact.style.opacity=String(.55*Math.exp(-lift/18));
      impact.style.transform=`translate3d(${x}px,${y}px,2px) scale(${1+ring*1.6})`;
      impact.style.opacity=String(ring>0?(1-ring)*.5:0);
      if(renderer&&!renderer.draw({position:[x,y,support+lift],rotation:m})){renderer=null;body.style.visibility=''}
      if(!renderer)for(const face of faces){const n=NORMALS[face.dataset.value],nz=m[2]*n[0]+m[5]*n[1]+m[8]*n[2],tone=Math.round(220+30*Math.max(0,nz));face.style.background='rgb('+tone+','+tone+','+tone+')'}

    }
    function cancel(){if(frame)cancelAnimationFrame(frame);frame=0;stage.classList.remove('is-rolling');if(resolveRoll){const done=resolveRoll;resolveRoll=null;done(false)}}
    function reset(){cancel();chosen=null;settled=false;result.textContent='';stage.setAttribute('aria-label','굴릴 준비가 된 주사위');draw(0,0,22,rotation(.12,-.15,-.15))}
    function showResult(){if(settled)return;settled=true;result.replaceChildren();const number=document.createElement('strong');number.textContent=String(chosen);const copy=document.createElement('span');copy.textContent='칸';result.append(number,copy);stage.setAttribute('aria-label','주사위 결과 '+chosen)}
    function setResult(value){if(chosen===null&&Number.isInteger(value)&&value>=1&&value<=6)chosen=value}
    function roll(value){
      cancel();chosen=null;setResult(value);settled=false;stage.classList.add('is-rolling');result.textContent='';stage.setAttribute('aria-label','주사위가 굴러가는 중');
      const reduced=Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      const direction=Math.random()<.5?-1:1,yaw=(Math.random()-.5)*.65,landingTime=1.96;
      const turnsX=(Math.random()<.5?-1:1)*(Math.PI*2+Math.random()*Math.PI);
      const turnsY=-direction*(Math.PI*4+Math.random()*Math.PI*2),turnsZ=(Math.random()-.5)*Math.PI;
      let started=null,target=null,finishedAt=null;
      return new Promise(resolve=>{
        resolveRoll=resolve;
        function tick(now){
          // Online rolls wait in their resting pose for the authoritative value.
          // Once launched, neither the target orientation nor face labels change.
          if(chosen===null){frame=requestAnimationFrame(tick);return}
          if(started===null){started=now;target=faceUp(chosen,yaw)}
          const t=(now-started)/1000;
          if(reduced){draw(0,0,0,target);showResult();finishedAt??=t;if(t-finishedAt>=.55){finish();return}}
          else {
            let lift=0,ring=0;
            // Free fall, then successively shorter ballistic rebounds. The cube's
            // changing support radius keeps every rotating corner above the floor.
            if(t<.64)lift=255*(1-(t/.64)**2);
            else if(t<1.16){const p=(t-.64)/.52;lift=4*69*p*(1-p);ring=clamp((t-.64)/.28)}
            else if(t<1.52){const p=(t-1.16)/.36;lift=4*26*p*(1-p)}
            else if(t<1.78){const p=(t-1.52)/.26;lift=4*8*p*(1-p)}
            else if(t<landingTime){const p=(t-1.78)/(landingTime-1.78);lift=4*2*p*(1-p)}
            // Plan the entire tumble backwards from the supplied upper face.
            // Both angular and lateral velocity reach zero on the final landing;
            // there is no separate corrective turn after the die has stopped.
            const u=clamp(t/landingTime),remaining=(1-u)**2*(1+.4*u),travel=1-(1-u)**3;
            const x=direction*(-150+205*travel),y=-55+88*travel+Math.sin(t*3)*8*remaining;
            const q=multiply(rotation(turnsX*remaining,turnsY*remaining,turnsZ*remaining),target);
            draw(x,y,lift,q,ring);
            if(t>=landingTime+.12){showResult();finishedAt??=t}
            if(finishedAt!==null&&t-finishedAt>=.7){finish();return}
          }
          frame=requestAnimationFrame(tick);
        }
        function finish(){frame=0;stage.classList.remove('is-rolling');const done=resolveRoll;resolveRoll=null;done?.(true)}
        frame=requestAnimationFrame(tick);
      });
    }
    reset();return {reset,roll,setResult,cancel};
  }
  window.MazeDice={create};
})();
