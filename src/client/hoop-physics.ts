// Pure physics and level rules for the basketball gate. No DOM, so it can be
// tested in Node.

export const W = 900;
export const H = 560;
export const FLOOR = 505;
export const BALL_R = 22;
export const GRAVITY = 1500;

export const START = { x: 150, y: FLOOR - BALL_R };
export const BOARD_X = 792;
export const BOARD_HALF = 7;
export const RIM_THICKNESS = 5;

export const MAX_DRAG = 150;
export const POWER = 10; // launch speed (px/s) per px of drag

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

// ---------- levels ----------

export interface DefenderRules {
    centerX: number;
    sway: number; // how far he slides left and right
    swaySpeed: number; // radians per second
    jumpHeight: number;
    jumpSpeed: number; // radians per second
    offset: number; // shifts his timing so two defenders do not move together
}

export interface Level {
    name: string;
    blurb: string;
    rimR: number; // half the width of the hoop opening
    hoopAmp: number; // how far the hoop slides up and down
    hoopSpeed: number; // radians per second
    windMax: number; // sideways push, px/s squared
    defenders: readonly DefenderRules[];
}

export const LEVELS: readonly Level[] = [
    {
        name: "Warm-up",
        blurb: "The hoop is on the move.",
        rimR: 44,
        hoopAmp: 45,
        hoopSpeed: 1.0,
        windMax: 70,
        defenders: [],
    },
    {
        name: "Defender",
        blurb: "Someone is guarding the lane.",
        rimR: 40,
        hoopAmp: 60,
        hoopSpeed: 1.3,
        windMax: 120,
        defenders: [{ centerX: 430, sway: 80, swaySpeed: 1.5, jumpHeight: 85, jumpSpeed: 2.6, offset: 0 }],
    },
    {
        name: "Crunch time",
        blurb: "Faster hoop, stronger wind, two defenders.",
        rimR: 37,
        hoopAmp: 75,
        hoopSpeed: 1.6,
        windMax: 170,
        defenders: [
            { centerX: 360, sway: 70, swaySpeed: 1.9, jumpHeight: 100, jumpSpeed: 3.1, offset: 0 },
            { centerX: 520, sway: 70, swaySpeed: 1.7, jumpHeight: 100, jumpSpeed: 2.7, offset: 2.1 },
        ],
    },
];

export const HOOP_BASE_Y = 255;

export interface World {
    level: Level;
    wind: number;
    hoopY: number;
    hoopX: number; // centre of the rim
    rimR: number;
    board: Rect;
    defenders: DefenderState[];
}

export interface DefenderState {
    x: number;
    lift: number; // how far off the floor he is
    body: Rect;
    hands: Rect;
}

/** Everything that moves, at time t (seconds). */
export function worldAt(level: Level, wind: number, t: number, phase: number): World {
    const hoopY = HOOP_BASE_Y + Math.sin(t * level.hoopSpeed + phase) * level.hoopAmp;
    const backX = BOARD_X - BOARD_HALF - 5;
    const hoopX = backX - level.rimR;

    const defenders: DefenderState[] = level.defenders.map((d) => {
        const x = d.centerX + Math.sin(t * d.swaySpeed + phase * 2 + d.offset) * d.sway;
        const j = Math.max(0, Math.sin(t * d.jumpSpeed + phase + d.offset));
        const lift = j * j * d.jumpHeight;
        const top = FLOOR - lift - 124;
        return {
            x,
            lift,
            body: { x0: x - 25, y0: top, x1: x + 25, y1: FLOOR - lift },
            hands: { x0: x - 44, y0: top - 62, x1: x + 44, y1: top + 4 },
        };
    });

    return {
        level,
        wind,
        hoopY,
        hoopX,
        rimR: level.rimR,
        board: { x0: BOARD_X - BOARD_HALF, y0: hoopY - 125, x1: BOARD_X + BOARD_HALF, y1: hoopY + 12 },
        defenders,
    };
}

// ---------- the ball ----------

export interface Shot {
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    spin: number;
    t: number;
    floorHits: number;
    scored: boolean;
    touched: boolean; // hit the rim or board
    blocked: boolean; // hit the defender
    done: boolean;
    events: ShotEvent[]; // what happened this step, for sound and effects
    squash: number; // 0 to 1, brief flattening on the floor
}

export type ShotEvent = "floor" | "rim" | "board" | "block" | "wall" | "score";

/** Turns a drag (how far the player pulled back) into launch velocity. */
export function velocityFromDrag(dx: number, dy: number): Point {
    const len = Math.hypot(dx, dy);
    const k = len > MAX_DRAG ? MAX_DRAG / len : 1;
    return { x: dx * k * POWER, y: dy * k * POWER };
}

/** Aim from an angle (degrees above horizontal) and power (0 to 1). */
export function velocityFromAim(angleDeg: number, power: number): Point {
    const a = (angleDeg * Math.PI) / 180;
    const speed = power * MAX_DRAG * POWER;
    return { x: Math.cos(a) * speed, y: -Math.sin(a) * speed };
}

export function newShot(vx: number, vy: number): Shot {
    return {
        x: START.x,
        y: START.y,
        vx,
        vy,
        angle: 0,
        spin: Math.sign(vx || 1) * 6,
        t: 0,
        floorHits: 0,
        scored: false,
        touched: false,
        blocked: false,
        done: false,
        events: [],
        squash: 0,
    };
}

function collideRect(s: Shot, r: Rect, restitution: number): boolean {
    const cx = Math.min(Math.max(s.x, r.x0), r.x1);
    const cy = Math.min(Math.max(s.y, r.y0), r.y1);
    const dx = s.x - cx;
    const dy = s.y - cy;
    const dist = Math.hypot(dx, dy);
    if (dist >= BALL_R) return false;

    let nx: number;
    let ny: number;
    if (dist > 0.001) {
        nx = dx / dist;
        ny = dy / dist;
        s.x = cx + nx * BALL_R;
        s.y = cy + ny * BALL_R;
    } else {
        // the centre is inside the rectangle: push out sideways
        nx = s.x < (r.x0 + r.x1) / 2 ? -1 : 1;
        ny = 0;
        s.x = nx < 0 ? r.x0 - BALL_R : r.x1 + BALL_R;
    }
    const vn = s.vx * nx + s.vy * ny;
    if (vn < 0) {
        s.vx -= (1 + restitution) * vn * nx;
        s.vy -= (1 + restitution) * vn * ny;
    }
    return true;
}

/** Advances the ball by dt seconds. */
export function step(s: Shot, dt: number, w: World): void {
    if (s.done) return;
    s.events.length = 0;
    const prevY = s.y;
    s.t += dt;
    s.vx += w.wind * dt;
    s.vy += GRAVITY * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.angle += s.spin * dt;
    s.squash = Math.max(0, s.squash - dt * 6);

    // floor
    if (s.y + BALL_R > FLOOR) {
        s.y = FLOOR - BALL_R;
        if (Math.abs(s.vy) > 120) {
            s.vy = -s.vy * 0.5;
            s.vx *= 0.88;
            s.floorHits += 1;
            s.squash = Math.min(1, Math.abs(s.vy) / 500);
            s.events.push("floor");
        } else {
            s.vy = 0;
            s.vx *= 0.96;
        }
    }

    // side walls
    if (s.x - BALL_R < 0) {
        s.x = BALL_R;
        s.vx = Math.abs(s.vx) * 0.6;
        s.events.push("wall");
    } else if (s.x + BALL_R > W) {
        s.x = W - BALL_R;
        s.vx = -Math.abs(s.vx) * 0.6;
        s.events.push("wall");
    }

    // backboard (the ball can only hit it from the left)
    const b = w.board;
    if (s.y > b.y0 && s.y < b.y1 && s.x + BALL_R > b.x0 && s.x < b.x0 && s.vx > 0) {
        s.x = b.x0 - BALL_R;
        s.vx = -s.vx * 0.55;
        s.touched = true;
        s.events.push("board");
    }

    // the two rim points
    const rimPoints: Point[] = [
        { x: w.hoopX - w.rimR, y: w.hoopY },
        { x: w.hoopX + w.rimR, y: w.hoopY },
    ];
    for (const p of rimPoints) {
        const dx = s.x - p.x;
        const dy = s.y - p.y;
        const dist = Math.hypot(dx, dy);
        const min = BALL_R + RIM_THICKNESS;
        if (dist < min && dist > 0.001) {
            const nx = dx / dist;
            const ny = dy / dist;
            s.x = p.x + nx * min;
            s.y = p.y + ny * min;
            const vn = s.vx * nx + s.vy * ny;
            if (vn < 0) {
                s.vx -= 1.55 * vn * nx;
                s.vy -= 1.55 * vn * ny;
            }
            s.touched = true;
            s.events.push("rim");
        }
    }

    // the defender
    for (const d of w.defenders) {
        const hitHands = collideRect(s, d.hands, 0.45);
        const hitBody = collideRect(s, d.body, 0.45);
        if (hitHands || hitBody) {
            s.blocked = true;
            s.events.push("block");
        }
    }

    // a basket: the centre crosses the rim line going down, between the rim points
    if (
        !s.scored &&
        prevY < w.hoopY &&
        s.y >= w.hoopY &&
        s.vy > 0 &&
        s.x > w.hoopX - w.rimR &&
        s.x < w.hoopX + w.rimR
    ) {
        s.scored = true;
        s.events.push("score");
    }

    if (s.scored && Math.abs(s.x - w.hoopX) < w.rimR - 6 && s.y > w.hoopY) {
        s.vx *= 0.9; // the net slows the ball down
    }

    if (s.floorHits >= (s.scored ? 1 : 2) || s.t > 6) s.done = true;
}

/** Points along the ideal arc (ignoring wind), for the short aiming preview. */
export function previewArc(vx: number, vy: number, count: number, spacing = 0.05): Point[] {
    const out: Point[] = [];
    for (let i = 1; i <= count; i++) {
        const t = i * spacing;
        out.push({ x: START.x + vx * t, y: START.y + vy * t + 0.5 * GRAVITY * t * t });
    }
    return out;
}
