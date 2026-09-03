'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Vec = { x: number; y: number };
type Enemy = { x:number;y:number;r:number;speed:number;kind:'chaser'|'hunter'|'orbiter';phase:number };
type Orb = { x:number;y:number;r:number;value:number;life:number };
type Particle = { x:number;y:number;vx:number;vy:number;life:number;max:number;size:number };

const BEST_KEY='neon-escape-best';

export default function Home() {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const frameRef=useRef<number>(0);
  const stateRef=useRef<any>(null);
  const [started,setStarted]=useState(false);
  const [paused,setPaused]=useState(false);
  const [gameOver,setGameOver]=useState(false);
  const [score,setScore]=useState(0);
  const [best,setBest]=useState(0);
  const [wave,setWave]=useState(1);
  const [energy,setEnergy]=useState(0);
  const [hp,setHp]=useState(100);
  const [combo,setCombo]=useState(1);
  const [time,setTime]=useState(0);

  const startGame=useCallback(()=>{
    const c=canvasRef.current; if(!c) return;
    const dpr=Math.min(window.devicePixelRatio||1,2); const rect=c.getBoundingClientRect();
    c.width=Math.floor(rect.width*dpr); c.height=Math.floor(rect.height*dpr);
    const w=rect.width,h=rect.height;
    stateRef.current={w,h,dpr,last:performance.now(),elapsed:0,score:0,best:best,wave:1,hp:100,energy:0,combo:1,keys:{},player:{x:w/2,y:h/2,r:13,inv:0,dash:0,trail:[]},enemies:[],orbs:[],particles:[],spawn:0,orbSpawn:0,shake:0,boss:null,bossAnnounced:false};
    setStarted(true);setPaused(false);setGameOver(false);setScore(0);setWave(1);setEnergy(0);setHp(100);setCombo(1);setTime(0);
  },[best]);

  useEffect(()=>{
    const raw=localStorage.getItem(BEST_KEY); if(raw) setBest(Number(raw)||0);
  },[]);

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const s=stateRef.current; if(!s) return;
      const k=e.key.toLowerCase(); s.keys[k]=e.type==='keydown';
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
      if(e.key==='Escape' && e.type==='keydown') setPaused(p=>!p);
      if(e.code==='Space' && e.type==='keydown' && !e.repeat && started && !gameOver) {
        if(s.energy>=20 && s.player.dash<=0){s.energy-=20;s.player.dash=0.28;s.player.inv=0.38; burst(s,s.player.x,s.player.y,22,2.8);}
      }
      if((e.key==='r'||e.key==='R') && e.type==='keydown' && gameOver) startGame();
    };
    window.addEventListener('keydown',onKey);window.addEventListener('keyup',onKey);
    return()=>{window.removeEventListener('keydown',onKey);window.removeEventListener('keyup',onKey)};
  },[started,gameOver,startGame]);

  useEffect(()=>{
    const c=canvasRef.current; if(!c) return;
    const ctx=c.getContext('2d'); if(!ctx) return;
    const resize=()=>{if(!stateRef.current)return;const r=c.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);c.width=r.width*d;c.height=r.height*d;stateRef.current.w=r.width;stateRef.current.h=r.height;stateRef.current.dpr=d};
    window.addEventListener('resize',resize);
    const loop=(now:number)=>{
      const s=stateRef.current;
      if(s){
        const dt=Math.min((now-s.last)/1000,0.035);s.last=now;
        if(started&&!paused&&!gameOver) update(s,dt);
        draw(ctx,s);
        if(started&&!paused&&!gameOver){setScore(Math.floor(s.score));setWave(s.wave);setEnergy(Math.floor(s.energy));setHp(Math.max(0,Math.floor(s.hp)));setCombo(Math.max(1,Math.floor(s.combo)));setTime(Math.floor(s.elapsed));}
      } else drawMenu(ctx);
      frameRef.current=requestAnimationFrame(loop);
    };
    frameRef.current=requestAnimationFrame(loop);
    return()=>{cancelAnimationFrame(frameRef.current);window.removeEventListener('resize',resize)};
  },[started,paused,gameOver]);

  const triggerGameOver=()=>{
    const s=stateRef.current;if(!s)return;
    setGameOver(true);setStarted(true);setPaused(false);
    const final=Math.floor(s.score);const b=Math.max(best,final);setBest(b);localStorage.setItem(BEST_KEY,String(b));
  };
  useEffect(()=>{stateRef.current&&(stateRef.current.onGameOver=triggerGameOver)},[best]);

  return <main className="shell">
    <header className="topbar"><div className="brand"><span className="brandMark">✦</span><div><b>NEON ESCAPE</b><small>THE GRID IS ALIVE</small></div></div><div className="top-actions"><span className="online"><i/>ONLINE</span><button onClick={()=>setPaused(p=>!p)} disabled={!started||gameOver}>ESC PAUSE</button></div></header>
    <section className="hud">
      <div className="stat"><span>SCORE</span><strong>{score.toLocaleString()}</strong></div><div className="stat"><span>BEST</span><strong>{best.toLocaleString()}</strong></div><div className="stat"><span>WAVE</span><strong>{wave}</strong></div><div className="stat"><span>TIME</span><strong>{String(Math.floor(time/60)).padStart(2,'0')}:{String(time%60).padStart(2,'0')}</strong></div>
      <div className="bars"><div><span>HULL</span><div className="bar"><i style={{width:`${hp}%`}}/></div></div><div><span>ENERGY</span><div className="bar energy"><i style={{width:`${Math.min(100,energy)}%`}}/></div></div></div>
    </section>
    <section className="game-wrap"><canvas ref={canvasRef}/>
      {!started && <div className="overlay"><div className="hero"><div className="eyebrow">⚡ A ONE-MORE-RUN SURVIVAL ARCADE</div><h1>SURVIVE<br/><em>THE GRID.</em></h1><p>Dodge the hunters. Harvest energy. Build your combo.<br/>The longer you survive, the smarter the Grid becomes.</p><button className="start" onClick={startGame}>ENTER THE GRID <span>→</span></button><div className="controls"><b>WASD / ARROWS</b> MOVE <b>SPACE</b> PHASE <b>ESC</b> PAUSE</div></div></div>}
      {started&&!gameOver&&paused&&<div className="center-card"><div className="eyebrow">SYSTEM PAUSED</div><h2>TIME FROZEN.</h2><button className="start" onClick={()=>setPaused(false)}>RESUME <span>→</span></button></div>}
      {gameOver&&<div className="center-card"><div className="eyebrow">SIGNAL LOST</div><h2>THE GRID WON.</h2><div className="result"><div><small>SCORE</small><b>{score.toLocaleString()}</b></div><div><small>WAVE</small><b>{wave}</b></div><div><small>TIME</small><b>{String(Math.floor(time/60)).padStart(2,'0')}:{String(time%60).padStart(2,'0')}</b></div></div>{score>=best&&score>0&&<p className="newbest">✦ NEW BEST</p>}<button className="start" onClick={startGame}>RUN IT BACK <span>↻</span></button><p className="hint">Press R to restart</p></div>}
    </section>
    <footer><span>NEON ESCAPE v1.0</span><span>COMBO ×{combo}</span><span>SPACE — PHASE <small>(20 ENERGY)</small></span><span>© AERO LABS</span></footer>
  </main>;
}

function update(s:any,dt:number){
  s.elapsed+=dt;s.wave=1+Math.floor(s.elapsed/18);
  const p=s.player; const k=s.keys; let dx=(k.d||k.arrowright?1:0)-(k.a||k.arrowleft?1:0);let dy=(k.s||k.arrowdown?1:0)-(k.w||k.arrowup?1:0);const len=Math.hypot(dx,dy)||1;dx/=len;dy/=len;
  const speed=270+(s.wave-1)*7; p.x+=dx*speed*dt;p.y+=dy*speed*dt;p.x=Math.max(p.r+5,Math.min(s.w-p.r-5,p.x));p.y=Math.max(p.r+5,Math.min(s.h-p.r-5,p.y));
  if(p.dash>0){p.dash-=dt;p.x+=dx*560*dt;p.y+=dy*560*dt;}
  p.inv=Math.max(0,p.inv-dt);p.trail.push({x:p.x,y:p.y,a:1});if(p.trail.length>16)p.trail.shift();
  s.spawn-=dt;s.orbSpawn-=dt;
  const cap=Math.min(28,5+s.wave*2);
  if(s.spawn<=0&&s.enemies.length<cap){spawnEnemy(s);s.spawn=Math.max(0.28,1.05-s.wave*.045)}
  if(s.orbSpawn<=0&&s.orbs.length<7){spawnOrb(s);s.orbSpawn=1.1+Math.random()*1.8}
  for(const e of s.enemies){const ex=p.x-e.x,ey=p.y-e.y,d=Math.hypot(ex,ey)||1;let ax=ex/d,ay=ey/d;if(e.kind==='orbiter'){const tx=-ey/d,ty=ex/d;ax=ax*.65+tx*.8;ay=ay*.65+ty*.8}e.x+=ax*e.speed*dt;e.y+=ay*e.speed*dt;e.phase+=dt;if(e.x<-40||e.x>s.w+40||e.y<-40||e.y>s.h+40) {e.x=Math.max(0,Math.min(s.w,e.x));e.y=Math.max(0,Math.min(s.h,e.y))}}
  for(const o of s.orbs){o.life-=dt;const d=Math.hypot(o.x-p.x,o.y-p.y);if(d<o.r+p.r+7){s.energy=Math.min(100,s.energy+o.value);s.score+=45*s.combo;s.combo=Math.min(50,s.combo+0.35);burst(s,o.x,o.y,12,2);o.life=0}}
  s.orbs=s.orbs.filter((o:Orb)=>o.life>0);
  for(const e of s.enemies){const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<e.r+p.r&&p.inv<=0){s.hp-=e.kind==='hunter'?22:14;p.inv=.75;s.combo=Math.max(1,s.combo*.55);s.shake=10;burst(s,p.x,p.y,18,3);if(s.hp<=0){s.onGameOver?.();return}}}
  s.score+=dt*(5+s.wave*1.8)*s.combo;s.combo=Math.max(1,s.combo-dt*.035);
  for(const q of s.particles){q.x+=q.vx*dt;q.y+=q.vy*dt;q.vx*=.97;q.vy*=.97;q.life-=dt} s.particles=s.particles.filter((q:Particle)=>q.life>0);s.shake=Math.max(0,s.shake-dt*25);
}
function spawnEnemy(s:any){const side=Math.floor(Math.random()*4);let x=0,y=0;if(side===0){x=-20;y=Math.random()*s.h}else if(side===1){x=s.w+20;y=Math.random()*s.h}else if(side===2){x=Math.random()*s.w;y=-20}else{x=Math.random()*s.w;y=s.h+20};const r=10+Math.random()*6;const roll=Math.random();const kind= s.wave>=4&&roll<.18?'hunter':s.wave>=3&&roll<.4?'orbiter':'chaser';s.enemies.push({x,y,r,speed:(kind==='hunter'?145:kind==='orbiter'?105:75)+s.wave*5,kind,phase:Math.random()*6.28})}
function spawnOrb(s:any){s.orbs.push({x:30+Math.random()*(s.w-60),y:30+Math.random()*(s.h-60),r:7,value:15+Math.floor(Math.random()*16),life:7})}
function burst(s:any,x:number,y:number,n:number,pow:number){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=(.4+Math.random())*pow;s.particles.push({x,y,vx:Math.cos(a)*v*60,vy:Math.sin(a)*v*60,life:.45+Math.random()*.5,max:1,size:1+Math.random()*3})}}
function drawMenu(ctx:CanvasRenderingContext2D){const r=ctx.canvas.getBoundingClientRect();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#05070d';ctx.fillRect(0,0,r.width,r.height)}
function draw(ctx:CanvasRenderingContext2D,s:any){const d=s.dpr||1,w=s.w,h=s.h;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);ctx.fillStyle='#05070d';ctx.fillRect(0,0,w,h);ctx.save();if(s.shake){ctx.translate((Math.random()-.5)*s.shake,(Math.random()-.5)*s.shake)}
  const g=ctx.createRadialGradient(s.player?.x||w/2,s.player?.y||h/2,20,w/2,h/2,Math.max(w,h)*.7);g.addColorStop(0,'#101d31');g.addColorStop(1,'#05070d');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(78,240,255,.055)';ctx.lineWidth=1;const grid=44;for(let x=0;x<w;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  const vg=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.2,w/2,h/2,Math.max(w,h)*.75);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.72)');ctx.fillStyle=vg;ctx.fillRect(0,0,w,h);
  if(s.player){for(let i=0;i<s.player.trail.length;i++){const t=s.player.trail[i];ctx.globalAlpha=(i/s.player.trail.length)*.22;ctx.fillStyle='#5ef6ff';ctx.beginPath();ctx.arc(t.x,t.y,4+i/6,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1}
  for(const o of s.orbs||[]){const pulse=1+Math.sin(performance.now()/180+o.x)*.18;ctx.shadowBlur=22;ctx.shadowColor='#b56cff';ctx.fillStyle='#d8a5ff';ctx.beginPath();ctx.arc(o.x,o.y,o.r*pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='rgba(216,165,255,.3)';ctx.stroke()}
  for(const e of s.enemies||[]){ctx.save();ctx.translate(e.x,e.y);ctx.rotate(e.phase);ctx.shadowBlur=18;ctx.shadowColor=e.kind==='hunter'?'#ff4f81':'#ff365d';ctx.strokeStyle=e.kind==='hunter'?'#ff9aaf':'#ff496e';ctx.lineWidth=2;ctx.fillStyle='rgba(255,45,88,.15)';ctx.beginPath();ctx.moveTo(e.r,0);ctx.lineTo(0,e.r);ctx.lineTo(-e.r,0);ctx.lineTo(0,-e.r);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();ctx.shadowBlur=0}
  if(s.player){const p=s.player;ctx.save();ctx.translate(p.x,p.y);ctx.shadowBlur=28;ctx.shadowColor='#4ff6ff';ctx.globalAlpha=p.inv>0&&Math.floor(performance.now()/70)%2===0?.35:1;ctx.fillStyle='#66f7ff';ctx.beginPath();ctx.arc(0,0,p.r,0,Math.PI*2);ctx.fill();ctx.fillStyle='#071018';ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#c5fdff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,p.r+5,0,Math.PI*2);ctx.stroke();ctx.restore()}
  for(const q of s.particles||[]){ctx.globalAlpha=Math.max(0,q.life/q.max);ctx.fillStyle='#70f5ff';ctx.beginPath();ctx.arc(q.x,q.y,q.size,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;ctx.restore();
}
