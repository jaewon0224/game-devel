(() => {
  'use strict';
  const DIRECTIONS={up:[-1,0],down:[1,0],left:[0,-1],right:[0,1]}, STARTS=[0,35];
  const SETTINGS={easy:{forget:.38,mistake:.38,unknown:1.15},medium:{forget:.035,mistake:.10,unknown:1.6},hard:{forget:0,mistake:0,unknown:1.9}};
  const key=(a,b)=>a<b?a+'-'+b:b+'-'+a;
  function next(at,direction){const d=DIRECTIONS[direction],r=Math.floor(at/6)+d[0],c=at%6+d[1];return r<0||r>5||c<0||c>5?null:r*6+c}
  const neighbors=at=>Object.keys(DIRECTIONS).map(direction=>({direction,index:next(at,direction)})).filter(n=>n.index!==null);
  class MazeBot {
    constructor(difficulty='medium',random=Math.random){this.difficulty=SETTINGS[difficulty]?difficulty:'medium';this.settings=SETTINGS[this.difficulty];this.random=random;this.memory=new Map();this.temporary=new Map();this.wallAttempts=new Set()}
    resetMaze(){this.memory.clear();this.temporary.clear();this.wallAttempts.clear()}
    observeEdge(a,b,open){if(a!==null&&b!==null)this.memory.set(key(a,b),Boolean(open))}
    observeTemporary(a,b,open){const e=key(a,b);if(!this.temporary.has(e))this.temporary.set(e,!open);this.memory.set(e,Boolean(open))}
    nextRound(){for(const [e,original] of this.temporary)this.memory.set(e,original);this.temporary.clear();this.wallAttempts.clear()}
    startTurn(){if(!this.settings.forget)return;for(const e of this.memory.keys())if(this.random()<this.settings.forget)this.memory.delete(e)}
    beginWallEvent(){this.wallAttempts.clear()}
    distance(from,to,{blocked=[],edit=null}={}){
      if(from===to)return 0;const denied=new Set(blocked);denied.delete(from);const costs=new Map([[from,0]]),queue=[{at:from,cost:0}];
      while(queue.length){queue.sort((a,b)=>a.cost-b.cost);const {at,cost}=queue.shift();if(cost!==costs.get(at))continue;if(at===to)return cost;
        for(const n of neighbors(at)){if(denied.has(n.index))continue;const e=key(at,n.index),known=edit?.edge===e?edit.open:this.memory.get(e);if(known===false)continue;const value=cost+(known===true?1:this.settings.unknown);if(value<(costs.get(n.index)??Infinity)){costs.set(n.index,value);queue.push({at:n.index,cost:value})}}
      }return 99;
    }
    target(view){
      const me=view.players[1],opponent=view.players[0],blocked=[STARTS[0],opponent.pos],goalCost=this.distance(me.pos,view.goal,{blocked});
      if(this.difficulty==='easy'||goalCost<=2)return view.goal;
      let target=view.goal,best=goalCost;
      for(const cell of view.events){if(me.used.includes(cell))continue;const cost=this.distance(me.pos,cell,{blocked}),tail=this.distance(cell,view.goal,{blocked});
        if(this.difficulty==='medium'){if(cost<=2&&cost+tail<=goalCost+.5&&goalCost>3)return cell;continue}
        const threat=this.distance(opponent.pos,view.goal,{blocked:[STARTS[1],me.pos]})<goalCost||opponent.score>me.score;
        const value=cost+tail*.32+1.3-(threat?1.4:0);if(cost<=5&&value<best){best=value;target=cell}
      }return target;
    }
    chooseMove(view,forcedChoices=null){
      const me=view.players[1],opponent=view.players[0],visited=new Set(view.turnVisited),forced=forcedChoices!==null;
      let options=forced?forcedChoices.map(c=>({direction:c.direction,index:c.index})):neighbors(me.pos).filter(n=>!visited.has(n.index)&&n.index!==opponent.pos&&n.index!==STARTS[0]);
      if(!options.length)return Object.keys(DIRECTIONS).find(d=>next(me.pos,d)===null)||null;
      const goal=options.find(n=>n.index===view.goal&&this.memory.get(key(me.pos,n.index))!==false);if(goal)return goal.direction;
      const safe=options.filter(n=>this.memory.get(key(me.pos,n.index))!==false);if(safe.length)options=safe;
      if(this.random()<this.settings.mistake)return options[Math.floor(this.random()*options.length)].direction;
      const target=forced?view.goal:this.target(view),blocked=[STARTS[0],opponent.pos],scores=options.map(n=>{
        const e=key(me.pos,n.index),known=this.memory.get(e),distance=this.distance(n.index,target,{blocked});
        const escape=neighbors(n.index).filter(k=>k.index!==me.pos&&!visited.has(k.index)&&k.index!==opponent.pos&&k.index!==STARTS[0]&&this.memory.get(key(n.index,k.index))!==false).length;
        return {...n,score:distance+(known===false?80:known===true?0:this.settings.unknown-1)+(escape===0&&view.movesLeft>1&&!forced?2:0)+this.random()*.08};
      });scores.sort((a,b)=>a.score-b.score);return scores[0].direction;
    }
    chooseWall(view){
      const mode=view.wallMode,me=view.players[1],opponent=view.players[0],candidates=[];
      const botBefore=this.distance(me.pos,view.goal,{blocked:[STARTS[0],opponent.pos]}),humanBefore=this.distance(opponent.pos,view.goal,{blocked:[STARTS[1],me.pos]});
      for(let a=0;a<36;a++)for(const direction of ['right','down']){const b=next(a,direction);if(b===null)continue;const e=key(a,b),known=this.memory.get(e);if(this.wallAttempts.has(e)||(mode==='install'&&known===false)||(mode==='remove'&&known===true))continue;
        const edit={edge:e,open:mode==='remove'},botAfter=this.distance(me.pos,view.goal,{blocked:[STARTS[0],opponent.pos],edit}),humanAfter=this.distance(opponent.pos,view.goal,{blocked:[STARTS[1],me.pos],edit});
        const distanceFromBot=Math.min(this.distance(me.pos,a),this.distance(me.pos,b));
        const value=mode==='remove'?(botBefore-botAfter)*4-(humanBefore-humanAfter)*1.8-distanceFromBot*.12:(humanAfter-humanBefore)*4-(botAfter-botBefore)*3;
        candidates.push({a,b,e,score:this.difficulty==='easy'?this.random()*10:value+(known!==undefined?.6:0)+this.random()*.15});
      }
      if(!candidates.length)return null;candidates.sort((a,b)=>b.score-a.score);const chosen=candidates[0];this.wallAttempts.add(chosen.e);return [chosen.a,chosen.b];
    }
  }
  globalThis.MazeBot=MazeBot;
})();
