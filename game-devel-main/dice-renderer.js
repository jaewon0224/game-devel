// Smooth, closed rounded-cube geometry. The animation controller supplies the
// pose; this renderer changes only the material and shape, never the outcome.
(()=>{
  'use strict';
  const HALF=44,RADIUS=14,CORE=HALF-RADIUS;
  const normalize=v=>{const length=Math.hypot(...v);return v.map(x=>x/length)};
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  let geometry=null;
  function roundedCube(){
    if(geometry)return geometry;
    const coordinates=[];
    for(let i=0;i<=8;i++)coordinates.push(-HALF+RADIUS*i/8);
    for(let i=0;i<=8;i++)coordinates.push(CORE+RADIUS*i/8);
    const bases=[[[1,0,0],[0,1,0],[0,0,1]],[[-1,0,0],[0,1,0],[0,0,-1]],[[0,0,-1],[0,1,0],[1,0,0]],[[0,0,1],[0,1,0],[-1,0,0]],[[1,0,0],[0,0,1],[0,-1,0]],[[1,0,0],[0,0,-1],[0,1,0]]];
    const vertices=[];
    for(const [u,v,n]of bases){
      function vertex(a,b){
        const p=[a,b,HALF],core=p.map(x=>Math.max(-CORE,Math.min(CORE,x))),normal=normalize(p.map((x,i)=>x-core[i]));
        const rounded=core.map((x,i)=>x+normal[i]*RADIUS);
        const world=value=>[0,1,2].map(i=>u[i]*value[0]+v[i]*value[1]+n[i]*value[2]);
        return [...world(rounded),...world(normal)];
      }
      for(let i=0;i<coordinates.length-1;i++)for(let j=0;j<coordinates.length-1;j++){
        const a=vertex(coordinates[i],coordinates[j]),b=vertex(coordinates[i+1],coordinates[j]),c=vertex(coordinates[i+1],coordinates[j+1]),d=vertex(coordinates[i],coordinates[j+1]);
        vertices.push(...a,...b,...c,...a,...c,...d);
      }
    }
    geometry=new Float32Array(vertices);return geometry;
  }
  const vertexSource=`
    attribute vec3 aPosition;
    attribute vec3 aNormal;
    uniform mat3 uRotation;
    uniform mat3 uWorld;
    uniform vec3 uPosition;
    uniform vec2 uViewport;
    uniform vec2 uOrigin;
    uniform vec2 uPerspectiveOrigin;
    uniform float uPerspective;
    varying vec3 vPosition;
    varying vec3 vNormal;
    void main(){
      vec3 p=uWorld*(uRotation*aPosition+uPosition);
      float w=1.0-p.z/uPerspective;
      vec2 screen=uOrigin-uPerspectiveOrigin+p.xy;
      vec2 anchor=vec2(2.0*uPerspectiveOrigin.x/uViewport.x-1.0,1.0-2.0*uPerspectiveOrigin.y/uViewport.y);
      gl_Position=vec4(anchor*w+vec2(2.0*screen.x/uViewport.x,-2.0*screen.y/uViewport.y),-p.z/1200.0,w);
      vPosition=aPosition;
      vNormal=aNormal;
    }
  `;
  const fragmentSource=`
    precision highp float;
    uniform vec3 uLight;
    uniform vec3 uHalf;
    varying vec3 vPosition;
    varying vec3 vNormal;
    vec2 nearestPip(vec2 uv,float value){
      vec2 q=uv;
      if(value==1.0)return q;
      if(value==2.0||value==3.0){
        vec2 a=uv-vec2(-17.5,-17.5),b=uv-vec2(17.5,17.5);
        q=dot(a,a)<dot(b,b)?a:b;
        if(value==3.0&&dot(uv,uv)<dot(q,q))q=uv;
        return q;
      }
      q=uv-vec2(uv.x<0.0?-17.5:17.5,uv.y<0.0?-17.5:17.5);
      if(value==5.0&&dot(uv,uv)<dot(q,q))q=uv;
      if(value==6.0){vec2 middle=uv-vec2(uv.x<0.0?-17.5:17.5,0.0);if(dot(middle,middle)<dot(q,q))q=middle;}
      return q;
    }
    void main(){
      vec3 n=normalize(vNormal),an=abs(n),tu,tv;
      vec2 uv;
      float value;
      if(an.z>=an.x&&an.z>=an.y){
        value=n.z>0.0?1.0:6.0;tu=vec3(sign(n.z),0.0,0.0);tv=vec3(0.0,1.0,0.0);uv=vec2(vPosition.x*sign(n.z),vPosition.y);
      }else if(an.x>=an.y){
        value=n.x>0.0?2.0:5.0;tu=vec3(0.0,0.0,-sign(n.x));tv=vec3(0.0,1.0,0.0);uv=vec2(-vPosition.z*sign(n.x),vPosition.y);
      }else{
        value=n.y<0.0?3.0:4.0;tu=vec3(1.0,0.0,0.0);tv=vec3(0.0,0.0,-sign(n.y));uv=vec2(vPosition.x,-vPosition.z*sign(n.y));
      }
      float diffuse=max(0.0,dot(n,uLight)),specular=pow(max(0.0,dot(n,uHalf)),54.0);
      vec3 porcelain=vec3(min(1.0,.84+.15*diffuse+.15*specular));
      vec2 pip=nearestPip(uv,value);
      float radius=6.1,pipDistance=length(pip);
      float flatFace=step(.999,max(an.x,max(an.y,an.z)));
      float mask=(1.0-smoothstep(radius-.22,radius+.22,pipDistance))*flatFace;
      vec2 bowl=pip/radius;
      vec3 pitNormal=normalize(n-tu*bowl.x*1.15-tv*bowl.y*1.15);
      float gloss=pow(max(0.0,dot(pitNormal,uHalf)),34.0);
      vec3 pit=vec3(.018+.025*max(0.0,dot(pitNormal,uLight))+.26*gloss);
      pit*=.8+.2*sqrt(max(0.0,1.0-dot(bowl,bowl)));
      float rim=(smoothstep(radius-.1,radius+.15,pipDistance)-smoothstep(radius+.15,radius+.45,pipDistance))*flatFace;
      gl_FragColor=vec4(mix(porcelain,pit,mask)+vec3(rim*.025),1.0);
    }
  `;
  function create({stage,body}){
    const canvas=document.createElement('canvas');canvas.className='dice-canvas';canvas.setAttribute('aria-hidden','true');
    const gl=canvas.getContext?.('webgl',{alpha:true,antialias:true,premultipliedAlpha:true});
    if(!gl)return null;
    let lost=false;
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();lost=true;body.style.visibility='';canvas.style.display='none'});
    function shader(type,source){const item=gl.createShader(type);gl.shaderSource(item,source);gl.compileShader(item);if(!gl.getShaderParameter(item,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(item));return item}
    let program;
    try{
      const vs=shader(gl.VERTEX_SHADER,vertexSource),fs=shader(gl.FRAGMENT_SHADER,fragmentSource);
      program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
      gl.deleteShader(vs);gl.deleteShader(fs);
    }catch{return null}
    gl.useProgram(program);
    const vertices=roundedCube(),buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    for(const [name,offset]of [['aPosition',0],['aNormal',12]]){const attribute=gl.getAttribLocation(program,name);gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,24,offset)}
    const uniforms=Object.fromEntries(['uRotation','uWorld','uPosition','uViewport','uOrigin','uPerspectiveOrigin','uPerspective','uLight','uHalf'].map(name=>[name,gl.getUniformLocation(program,name)]));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(0,0,0,0);
    stage.append(canvas);body.style.visibility='hidden';
    let width=0,height=0,pixelRatio=0,world=null,origin=null,perspectiveOrigin=null,perspective=1050,lastPose=null;
    function draw(pose){
      lastPose=pose;
      const {position,rotation}=pose;
      if(lost)return false;
      const w=stage.clientWidth,h=stage.clientHeight,dpr=Math.min(window.devicePixelRatio||1,2);
      if(!w||!h)return true;
      if(w!==width||h!==height||dpr!==pixelRatio){
        width=w;height=h;pixelRatio=dpr;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);gl.viewport(0,0,canvas.width,canvas.height);
        const element=stage.querySelector('.dice-world'),style=getComputedStyle(element),m=new DOMMatrix(style.transform);
        world=[m.m11,m.m12,m.m13,m.m21,m.m22,m.m23,m.m31,m.m32,m.m33];
        origin=[parseFloat(style.left),parseFloat(style.top)];
        const sceneStyle=getComputedStyle(stage);perspective=parseFloat(sceneStyle.perspective)||1050;perspectiveOrigin=sceneStyle.perspectiveOrigin.split(' ').map(parseFloat);
      }
      const light=normalize([-.4,-.5,1]),view=normalize([world[2],world[5],world[8]]),half=normalize(light.map((v,i)=>v+view[i]));
      const local=v=>[dot([rotation[0],rotation[1],rotation[2]],v),dot([rotation[3],rotation[4],rotation[5]],v),dot([rotation[6],rotation[7],rotation[8]],v)];
      gl.useProgram(program);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix3fv(uniforms.uRotation,false,rotation);gl.uniformMatrix3fv(uniforms.uWorld,false,world);
      gl.uniform3fv(uniforms.uPosition,position);gl.uniform2f(uniforms.uViewport,width,height);gl.uniform2fv(uniforms.uOrigin,origin);gl.uniform2fv(uniforms.uPerspectiveOrigin,perspectiveOrigin);gl.uniform1f(uniforms.uPerspective,perspective);
      gl.uniform3fv(uniforms.uLight,local(light));gl.uniform3fv(uniforms.uHalf,local(half));gl.drawArrays(gl.TRIANGLES,0,vertices.length/6);
      return true;
    }
    if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(lastPose)draw(lastPose)}).observe(stage);
    return {draw};
  }
  window.MazeDiceRenderer={create};
})();
