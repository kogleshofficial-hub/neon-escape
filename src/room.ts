import { DurableObject } from 'cloudflare:workers';

type Character = 'runner' | 'phantom' | 'guardian';
type Player = {
  id: string;
  name: string;
  character: Character;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  facingX: number;
  facingY: number;
  energy: number;
  score: number;
  alive: boolean;
  phaseUntil: number;
  attackUntil: number;
  lastInput: number;
  ws: WebSocket;
};

type ClientMessage =
  | { type: 'join'; name?: string; character?: Character }
  | { type: 'input'; dx: number; dy: number }
  | { type: 'attack' }
  | { type: 'phase' }
  | { type: 'rematch' };

const WIDTH = 1200;
const HEIGHT = 700;
const PLAYER_SPEED = 6.2;
const ATTACK_RANGE = 78;
const ATTACK_DAMAGE = 24;
const MAX_PLAYERS = 2;

export class NeonRoom extends DurableObject {
  private players = new Map<string, Player>();
  private started = false;
  private winner: string | null = null;
  private roomCode = '';
  private tick = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.roomCode = (await this.ctx.storage.get<string>('roomCode')) ?? '';
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response(JSON.stringify({ ok: true, room: this.roomCode, players: this.players.size }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (this.players.size >= MAX_PLAYERS) {
      return new Response('Room full', { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const id = crypto.randomUUID();
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id });

    const url = new URL(request.url);
    const name = sanitizeName(url.searchParams.get('name') || 'Player');
    const character = normalizeCharacter(url.searchParams.get('character'));
    const slot = this.players.size;
    const player: Player = {
      id,
      name,
      character,
      x: slot === 0 ? 260 : WIDTH - 260,
      y: HEIGHT / 2,
      hp: 100,
      maxHp: 100,
      facingX: slot === 0 ? 1 : -1,
      facingY: 0,
      energy: 100,
      score: 0,
      alive: true,
      phaseUntil: 0,
      attackUntil: 0,
      lastInput: Date.now(),
      ws: server,
    };
    this.players.set(id, player);
    if (this.players.size === 2) this.started = true;
    this.broadcastState();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    let msg: ClientMessage;
    try { msg = JSON.parse(data) as ClientMessage; } catch { return; }
    const attachment = ws.deserializeAttachment() as { id?: string } | null;
    const player = attachment?.id ? this.players.get(attachment.id) : undefined;
    if (!player) return;

    if (msg.type === 'join') return;
    if (msg.type === 'input') {
      if (!player.alive || !this.started || this.winner) return;
      const dx = clamp(Number(msg.dx) || 0, -1, 1);
      const dy = clamp(Number(msg.dy) || 0, -1, 1);
      const len = Math.hypot(dx, dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      if (Math.abs(dx) + Math.abs(dy) > 0) {
        player.facingX = nx;
        player.facingY = ny;
      }
      const now = Date.now();
      const dt = Math.min(0.08, Math.max(0.01, (now - player.lastInput) / 1000));
      player.lastInput = now;
      const speed = player.character === 'runner' ? PLAYER_SPEED * 1.15 : player.character === 'guardian' ? PLAYER_SPEED * 0.9 : PLAYER_SPEED;
      if (now >= player.phaseUntil) {
        player.x = clamp(player.x + nx * speed * dt * 60, 38, WIDTH - 38);
        player.y = clamp(player.y + ny * speed * dt * 60, 38, HEIGHT - 38);
      }
      player.energy = Math.min(100, player.energy + dt * 4);
      this.broadcastState();
    } else if (msg.type === 'attack') {
      this.attack(player);
    } else if (msg.type === 'phase') {
      this.phase(player);
    } else if (msg.type === 'rematch') {
      this.resetMatch();
    }
  }

  private attack(attacker: Player) {
    const now = Date.now();
    if (!this.started || this.winner || !attacker.alive || now < attacker.attackUntil || attacker.energy < 12) return;
    attacker.attackUntil = now + 430;
    attacker.energy -= 12;
    const target = [...this.players.values()].find((p) => p.id !== attacker.id && p.alive);
    if (!target) return;
    const vx = target.x - attacker.x;
    const vy = target.y - attacker.y;
    const distance = Math.hypot(vx, vy);
    const dot = distance ? (vx / distance) * attacker.facingX + (vy / distance) * attacker.facingY : 1;
    if (distance <= ATTACK_RANGE && dot > 0.2) {
      const damage = attacker.character === 'phantom' ? 30 : attacker.character === 'guardian' ? 20 : ATTACK_DAMAGE;
      target.hp = Math.max(0, target.hp - damage);
      target.x = clamp(target.x + attacker.facingX * 34, 38, WIDTH - 38);
      target.y = clamp(target.y + attacker.facingY * 34, 38, HEIGHT - 38);
      attacker.score += 100;
      this.emit({ type: 'hit', attacker: attacker.id, target: target.id, damage, x: target.x, y: target.y });
      if (target.hp <= 0) {
        target.alive = false;
        this.winner = attacker.id;
        attacker.score += 500;
        this.emit({ type: 'match_end', winner: attacker.id });
      }
    } else {
      this.emit({ type: 'swing', player: attacker.id });
    }
    this.broadcastState();
  }

  private phase(player: Player) {
    const now = Date.now();
    if (!player.alive || player.energy < 35 || now < player.phaseUntil || this.winner) return;
    player.energy -= 35;
    player.phaseUntil = now + 280;
    player.x = clamp(player.x + player.facingX * 120, 38, WIDTH - 38);
    player.y = clamp(player.y + player.facingY * 120, 38, HEIGHT - 38);
    this.emit({ type: 'phase', player: player.id, x: player.x, y: player.y });
    this.broadcastState();
  }

  private resetMatch() {
    if (this.players.size !== 2) return;
    let slot = 0;
    this.winner = null;
    this.started = true;
    for (const p of this.players.values()) {
      p.x = slot === 0 ? 260 : WIDTH - 260;
      p.y = HEIGHT / 2;
      p.hp = p.maxHp;
      p.energy = 100;
      p.score = 0;
      p.alive = true;
      p.phaseUntil = 0;
      p.attackUntil = 0;
      p.facingX = slot === 0 ? 1 : -1;
      p.facingY = 0;
      slot++;
    }
    this.emit({ type: 'rematch' });
    this.broadcastState();
  }

  webSocketClose(ws: WebSocket) {
    const attachment = ws.deserializeAttachment() as { id?: string } | null;
    if (attachment?.id) {
      this.players.delete(attachment.id);
      this.started = false;
      this.winner = null;
      this.broadcastState();
    }
  }

  private broadcastState() {
    const players = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, character: p.character, x: p.x, y: p.y,
      hp: p.hp, maxHp: p.maxHp, energy: Math.round(p.energy), score: p.score,
      alive: p.alive, phase: Date.now() < p.phaseUntil,
    }));
    this.emit({ type: 'state', room: this.roomCode, started: this.started, winner: this.winner, players });
  }

  private emit(message: unknown) {
    const payload = JSON.stringify(message);
    for (const p of this.players.values()) {
      try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload); } catch {}
    }
  }
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function sanitizeName(value: string) { return value.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 14) || 'Player'; }
function normalizeCharacter(value: string | null): Character { return value === 'phantom' || value === 'guardian' ? value : 'runner'; }

interface Env { ROOMS: DurableObjectNamespace<NeonRoom>; }
