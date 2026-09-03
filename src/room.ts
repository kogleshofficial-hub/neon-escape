type DurableObjectState = {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
};

type Character = 'runner' | 'phantom' | 'guardian';
type Player = { id:string; name:string; character:Character; x:number; y:number; hp:number; maxHp:number; facingX:number; facingY:number; energy:number; score:number; alive:boolean; phaseUntil:number; attackUntil:number; lastInput:number; ws:WebSocket };
type ClientMessage = {type:'join';name?:string;character?:Character}|{type:'input';dx:number;dy:number}|{type:'attack'}|{type:'phase'}|{type:'rematch'};

const WIDTH=1200, HEIGHT=700, MAX_PLAYERS=2, ATTACK_RANGE=92, BASE_DAMAGE=24;
const SPEED:{[key in Character]:number}={runner:7.2,phantom:6.2,guardian:5.6};
const MAX_HP:{[key in Character]:number}={runner:100,phantom:90,guardian:120};

export class NeonRoom {
  private ctx:DurableObjectState;
  private env:Env;
  private players=new Map<string,Player>();
  private started=false;
  private winner:string|null=null;
  private roomCode='';
  private lastBroadcast=0;

  constructor(ctx:DurableObjectState,env:Env){
    this.ctx=ctx;
    this.env=env;
    this.ctx.blockConcurrencyWhile(async()=>{this.roomCode=(await this.ctx.storage.get<string>('roomCode'))??'';});
  }

  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    if(request.headers.get('Upgrade')!=='websocket') return new Response(JSON.stringify({ok:true,room:this.roomCode,players:this.players.size}),{headers:{'content-type':'application/json'}});
    if(this.players.size>=MAX_PLAYERS) return new Response('Room full',{status:409});
    if(!this.roomCode){this.roomCode=(url.searchParams.get('room')||'').toUpperCase().slice(0,6);await this.ctx.storage.put('roomCode',this.roomCode);}
    const pair=new WebSocketPair(); const [client,server]=Object.values(pair);
    server.accept();
    const id=crypto.randomUUID();
    const name=sanitizeName(url.searchParams.get('name')||'Player');
    const character=normalizeCharacter(url.searchParams.get('character'));
    const slot=this.players.size;
    const player:Player={id,name,character,x:slot===0?260:WIDTH-260,y:HEIGHT/2,hp:MAX_HP[character],maxHp:MAX_HP[character],facingX:slot===0?1:-1,facingY:0,energy:100,score:0,alive:true,phaseUntil:0,attackUntil:0,lastInput:Date.now(),ws:server};
    this.players.set(id,player);
    server.addEventListener('message',e=>this.handleMessage(server,e.data));
    server.addEventListener('close',()=>this.handleClose(server));
    this.started=this.players.size===MAX_PLAYERS;
    this.broadcastState(true);
    return new Response(null,{status:101,webSocket:client});
  }

  private handleMessage(ws:WebSocket,raw:string|ArrayBuffer){
    const data=typeof raw==='string'?raw:new TextDecoder().decode(raw);
    let msg:ClientMessage;try{msg=JSON.parse(data) as ClientMessage;}catch{return;}
    const player=[...this.players.values()].find(p=>p.ws===ws);if(!player)return;
    if(msg.type==='join'){const nextName=sanitizeName(msg.name||player.name);const nextChar=normalizeCharacter(msg.character);player.name=nextName;player.character=nextChar;player.maxHp=MAX_HP[nextChar];player.hp=Math.min(player.hp,player.maxHp);this.broadcastState(true);return;}
    if(msg.type==='input'){this.move(player,msg.dx,msg.dy);return;}
    if(msg.type==='attack'){this.attack(player);return;}
    if(msg.type==='phase'){this.phase(player);return;}
    if(msg.type==='rematch'){this.resetMatch();}
  }

  private move(p:Player,rawDx:number,rawDy:number){
    if(!this.started||this.winner||!p.alive)return;
    const dx=clamp(Number(rawDx)||0,-1,1),dy=clamp(Number(rawDy)||0,-1,1),len=Math.hypot(dx,dy)||1,nx=dx/len,ny=dy/len,now=Date.now();
    if(dx||dy){p.facingX=nx;p.facingY=ny;}
    const dt=Math.min(.1,Math.max(.016,(now-p.lastInput)/1000));p.lastInput=now;
    if(now>=p.phaseUntil){p.x=clamp(p.x+nx*SPEED[p.character]*dt*60,42,WIDTH-42);p.y=clamp(p.y+ny*SPEED[p.character]*dt*60,42,HEIGHT-42);}
    p.energy=Math.min(100,p.energy+dt*8);
    this.broadcastState(false);
  }

  private attack(attacker:Player){
    const now=Date.now();if(!this.started||this.winner||!attacker.alive||now<attacker.attackUntil||attacker.energy<15)return;
    attacker.attackUntil=now+360;attacker.energy-=15;
    const target=[...this.players.values()].find(p=>p.id!==attacker.id&&p.alive);if(!target){this.emit({type:'swing',player:attacker.id});this.broadcastState(true);return;}
    const vx=target.x-attacker.x,vy=target.y-attacker.y,d=Math.hypot(vx,vy)||1,dot=(vx/d)*attacker.facingX+(vy/d)*attacker.facingY;
    if(d<=ATTACK_RANGE&&dot>.15){const damage=attacker.character==='phantom'?31:attacker.character==='guardian'?21:BASE_DAMAGE;target.hp=Math.max(0,target.hp-damage);target.x=clamp(target.x+attacker.facingX*42,42,WIDTH-42);target.y=clamp(target.y+attacker.facingY*42,42,HEIGHT-42);attacker.score+=100;this.emit({type:'hit',attacker:attacker.id,target:target.id,damage,x:target.x,y:target.y});if(target.hp<=0){target.alive=false;this.winner=attacker.id;attacker.score+=500;this.emit({type:'match_end',winner:attacker.id});}}
    else this.emit({type:'swing',player:attacker.id});
    this.broadcastState(true);
  }

  private phase(p:Player){
    const now=Date.now();if(!this.started||this.winner||!p.alive||p.energy<35||now<p.phaseUntil)return;
    p.energy-=35;p.phaseUntil=now+300;p.x=clamp(p.x+p.facingX*125,42,WIDTH-42);p.y=clamp(p.y+p.facingY*125,42,HEIGHT-42);this.emit({type:'phase',player:p.id,x:p.x,y:p.y});this.broadcastState(true);
  }

  private resetMatch(){if(this.players.size!==2)return;let slot=0;this.winner=null;this.started=true;for(const p of this.players.values()){p.x=slot===0?260:WIDTH-260;p.y=HEIGHT/2;p.hp=p.maxHp;p.energy=100;p.score=0;p.alive=true;p.phaseUntil=0;p.attackUntil=0;p.facingX=slot===0?1:-1;p.facingY=0;slot++;}this.emit({type:'rematch'});this.broadcastState(true);}

  private handleClose(ws:WebSocket){const p=[...this.players.values()].find(v=>v.ws===ws);if(!p)return;this.players.delete(p.id);this.started=false;this.winner=null;this.broadcastState(true);}

  private broadcastState(force:boolean){const now=Date.now();if(!force&&now-this.lastBroadcast<45)return;this.lastBroadcast=now;const players=[...this.players.values()].map(p=>({id:p.id,name:p.name,character:p.character,x:p.x,y:p.y,hp:p.hp,maxHp:p.maxHp,energy:Math.round(p.energy),score:p.score,alive:p.alive,phase:now<p.phaseUntil}));this.emit({type:'state',room:this.roomCode,started:this.started,winner:this.winner,players});}
  private emit(message:unknown){const payload=JSON.stringify(message);for(const p of this.players.values()){try{if(p.ws.readyState===WebSocket.OPEN)p.ws.send(payload);}catch{}}}
}

function clamp(v:number,min:number,max:number){return Math.max(min,Math.min(max,v));}
function sanitizeName(v:string){return v.replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,14)||'Player';}
function normalizeCharacter(v:string|null|undefined):Character{return v==='phantom'||v==='guardian'?'guardian'===v?'guardian':'phantom':'runner';}
interface Env{ROOMS:DurableObjectNamespace<NeonRoom>}
