import { byId } from "./dom.js";
import {
    BALL_R,
    BOARD_X,
    FLOOR,
    H,
    LEVELS,
    MAX_DRAG,
    START,
    W,
    newShot,
    previewArc,
    step,
    velocityFromAim,
    velocityFromDrag,
    worldAt,
    type Point,
    type Shot,
    type DefenderState,
    type World,
} from "./hoop-physics.js";

const canvas = byId<HTMLCanvasElement>("court");
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("Canvas is not supported.");
const g: CanvasRenderingContext2D = ctx;

const intro = byId("intro");
const result = byId("result");
const resultTitle = byId("resultTitle");
const resultText = byId("resultText");
const enterBtn = byId<HTMLButtonElement>("enterBtn");
const retryBtn = byId<HTMLButtonElement>("retryBtn");
const status = byId("status");
const soundBtn = byId<HTMLButtonElement>("soundBtn");
const pips = [...document.querySelectorAll<HTMLElement>("#pips .pip")];

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOTAL_SHOTS = 3;
const SHOT_CLOCK = 10; // seconds to take each shot

// ---------- colours (read from the site's CSS tokens) ----------
const css = getComputedStyle(document.documentElement);
const token = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
const INK = token("--navy", "#0f1f5c");
const CYAN = token("--cyan", "#00a6e0");
const PINK = token("--pink", "#ff5a8a");
const YELLOW = token("--yellow", "#ffd60a");
const PAPER = token("--paper", "#f2f2ec");
const WHITE = token("--white", "#fcfcf9");
const CREAM = token("--ink", "#fce5df");
const ORANGE = "#ff8a1f";

// ---------- passing the gate ----------
/** The gate was served in place of the page the visitor asked for, so go back to that page. */
function enterSite(): void {
    document.cookie = `dj_gate=1; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    const here = location.pathname === "/enter" || location.pathname === "/enter.html" ? "/" : location.pathname + location.search;
    location.assign(here);
}

// ---------- sound (off until the visitor turns it on) ----------
let audio: AudioContext | null = null;
let soundOn = false;

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number): void {
    if (!soundOn || !audio) return;
    const o = audio.createOscillator();
    const v = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, audio.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audio.currentTime + dur);
    v.gain.setValueAtTime(gain, audio.currentTime);
    v.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(v).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + dur);
}

function noise(dur: number, gain: number, highpass: number): void {
    if (!soundOn || !audio) return;
    const len = Math.floor(audio.sampleRate * dur);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audio.createBufferSource();
    src.buffer = buf;
    const f = audio.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = highpass;
    const v = audio.createGain();
    v.gain.value = gain;
    src.connect(f).connect(v).connect(audio.destination);
    src.start();
}

const sounds = {
    floor: () => tone(150, 0.12, "sine", 0.35, 55),
    rim: () => {
        tone(820, 0.25, "square", 0.08);
        tone(1240, 0.2, "square", 0.05);
    },
    board: () => tone(260, 0.1, "triangle", 0.25, 120),
    block: () => tone(110, 0.18, "sawtooth", 0.2, 50),
    wall: () => tone(200, 0.06, "sine", 0.15, 120),
    score: () => noise(0.35, 0.35, 3500),
    shoot: () => noise(0.1, 0.12, 1200),
    buzzer: () => tone(180, 0.7, "sawtooth", 0.25),
    win: () => {
        tone(523, 0.14, "triangle", 0.25);
        window.setTimeout(() => tone(659, 0.14, "triangle", 0.25), 120);
        window.setTimeout(() => tone(784, 0.3, "triangle", 0.25), 240);
    },
};

soundBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    if (soundOn && !audio) audio = new AudioContext();
    if (soundOn) void audio?.resume();
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundBtn.textContent = soundOn ? "Sound on" : "Sound off";
    if (soundOn) sounds.floor();
});

// ---------- game state ----------
type Phase = "aim" | "flying" | "between" | "over";
let phase: Phase = "aim";
let shotsTaken = 0;
let roundsLost = 0;
const ROUNDS_BEFORE_MERCY = 2; // after this many failed rounds, let the visitor in
let shot: Shot | null = null;
let clock = 0; // world time: the hoop and defender never stop moving
let timeLeft = SHOT_CLOCK;
let wind = 0;
const worldPhase = Math.random() * Math.PI * 2;
let world: World = worldAt(LEVELS[0]!, 0, 0, worldPhase);
let scoredAt = -99;
let lastHitAt = -99; // for the rim shake
let shakeUntil = 0;
let betweenTimer = 0;
let outcome = "";
let ballRest: Point = { ...START };
let ballAngle = 0;
let ballSquash = 0;
let trail: Point[] = [];
let crowdCheer = 0;
let flash = ""; // short message on the court ("BLOCKED!", "SHOT CLOCK!")
let flashUntil = 0;

// aiming
let dragOrigin: Point | null = null;
let dragNow: Point | null = null;
const keyAim = { angle: 60, power: 0.84, used: false };

interface Bit {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    rot: number;
    vr: number;
    life: number;
}
let bits: Bit[] = [];

function levelIndex(): number {
    return Math.min(shotsTaken, LEVELS.length - 1);
}

function startShot(): void {
    const level = LEVELS[levelIndex()]!;
    const sign = Math.random() < 0.5 ? -1 : 1;
    wind = sign * level.windMax * (0.4 + Math.random() * 0.6);
    timeLeft = SHOT_CLOCK;
    phase = "aim";
    shot = null;
    ballRest = { ...START };
    ballAngle = 0;
    trail = [];
    scoredAt = -99;
    status.textContent = `Shot ${shotsTaken + 1} of ${TOTAL_SHOTS}: ${level.name}. ${level.blurb}`;
    flashMessage(level.name.toUpperCase(), 1.6);
}

function flashMessage(text: string, seconds: number): void {
    flash = text;
    flashUntil = clock + seconds;
}

// ---------- sizing ----------
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = Math.round(W * dpr);
canvas.height = Math.round(H * dpr);

function toLogical(e: PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

// ---------- input ----------
function currentVelocity(): Point | null {
    if (dragOrigin && dragNow) {
        const dx = dragOrigin.x - dragNow.x;
        const dy = dragOrigin.y - dragNow.y;
        if (Math.hypot(dx, dy) < 14) return null;
        const v = velocityFromDrag(dx, dy);
        return v.y < 0 ? v : null; // the ball can only be shot upwards
    }
    if (keyAim.used) return velocityFromAim(keyAim.angle, keyAim.power);
    return null;
}

function fire(v: Point): void {
    if (phase !== "aim") return;
    phase = "flying";
    shotsTaken += 1;
    shot = newShot(v.x, v.y);
    dragOrigin = null;
    dragNow = null;
    keyAim.used = false;
    intro.classList.add("gone");
    pips[shotsTaken - 1]?.classList.add("used");
    status.textContent = `Shot ${shotsTaken} of ${TOTAL_SHOTS} is in the air.`;
    sounds.shoot();
}

canvas.addEventListener("pointerdown", (e) => {
    if (phase !== "aim") return;
    canvas.setPointerCapture(e.pointerId);
    dragOrigin = toLogical(e);
    dragNow = dragOrigin;
    keyAim.used = false;
});

canvas.addEventListener("pointermove", (e) => {
    if (dragOrigin) dragNow = toLogical(e);
});

canvas.addEventListener("pointerup", () => {
    const v = currentVelocity();
    if (v) fire(v);
    dragOrigin = null;
    dragNow = null;
});

canvas.addEventListener("pointercancel", () => {
    dragOrigin = null;
    dragNow = null;
});

canvas.addEventListener("keydown", (e) => {
    if (phase !== "aim") return;
    const key = e.key;
    if (key === "ArrowLeft") keyAim.angle = Math.min(80, keyAim.angle + 1);
    else if (key === "ArrowRight") keyAim.angle = Math.max(30, keyAim.angle - 1);
    else if (key === "ArrowUp") keyAim.power = Math.min(1, keyAim.power + 0.01);
    else if (key === "ArrowDown") keyAim.power = Math.max(0.4, keyAim.power - 0.01);
    else if (key === " " || key === "Enter") {
        e.preventDefault();
        fire(velocityFromAim(keyAim.angle, keyAim.power));
        return;
    } else return;
    e.preventDefault();
    keyAim.used = true;
    status.textContent = `Angle ${keyAim.angle} degrees, power ${Math.round(keyAim.power * 100)} percent. Press space to shoot.`;
});

// ---------- skip code ----------
const skipDialog = byId<HTMLDialogElement>("skipDialog");
const skipForm = byId<HTMLFormElement>("skipForm");
const skipCode = byId<HTMLInputElement>("skipCode");
const skipMessage = byId("skipMessage");

byId("skipBtn").addEventListener("click", () => {
    skipMessage.textContent = "";
    skipMessage.classList.remove("visible");
    skipCode.value = "";
    skipDialog.showModal();
    skipCode.focus();
});
byId("skipCancel").addEventListener("click", () => skipDialog.close());

function skipError(text: string): void {
    skipMessage.textContent = text;
    skipMessage.classList.add("visible");
    skipDialog.classList.remove("shake");
    void skipDialog.offsetWidth;
    skipDialog.classList.add("shake");
    skipCode.select();
}

skipForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
        const res = await fetch("/api/gate/skip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: skipCode.value }),
        });
        if (res.ok) {
            enterSite();
            return;
        }
        skipError(res.status === 429 ? "Too many tries. Please wait a while." : "That code is not right.");
    } catch {
        skipError("Could not check the code. Please try again.");
    }
});

// ---------- results ----------
function burst(x: number, y: number, count: number, colors: string[], power: number): void {
    if (reduceMotion) return;
    for (let i = 0; i < count; i++) {
        bits.push({
            x: x + (Math.random() - 0.5) * 40,
            y,
            vx: (Math.random() - 0.5) * power,
            vy: -power * 0.3 - Math.random() * power * 0.8,
            size: 5 + Math.random() * 8,
            color: colors[i % colors.length] ?? INK,
            rot: Math.random() * 6,
            vr: (Math.random() - 0.5) * 14,
            life: 1.6 + Math.random(),
        });
    }
}

function showResult(won: boolean, swish: boolean): void {
    phase = "over";
    if (!won) roundsLost += 1;
    const mercy = !won && roundsLost >= ROUNDS_BEFORE_MERCY;
    retryBtn.hidden = won;
    enterBtn.hidden = !(won || mercy);
    retryBtn.textContent = mercy ? "Try once more" : "Try again";
    if (won) {
        resultTitle.textContent = swish ? "SWISH!" : "BUCKET!";
        resultText.textContent = `You're in. Level ${shotsTaken} cleared. Welcome to my portfolio.`;
        status.textContent = "You scored. Entering the portfolio.";
        sounds.win();
        window.setTimeout(enterSite, 3200);
    } else if (mercy) {
        resultTitle.textContent = "Good effort";
        resultText.textContent = "Six shots against that defence is rough. Come on in.";
        status.textContent = "You earned it. You can enter the portfolio, or try once more.";
    } else {
        resultTitle.textContent = "Out of shots";
        resultText.textContent = "Nothing but air. Take another run at it.";
        status.textContent = "Out of shots. Press Try again for three new shots.";
    }
    result.hidden = false;
    (won || mercy ? enterBtn : retryBtn).focus();
}

enterBtn.addEventListener("click", enterSite);
retryBtn.addEventListener("click", () => {
    result.hidden = true;
    shotsTaken = 0;
    pips.forEach((p) => p.classList.remove("used"));
    startShot();
    canvas.focus();
});

// ---------- update ----------
function handleEvents(s: Shot): void {
    for (const ev of s.events) {
        if (ev === "floor") {
            sounds.floor();
            burst(s.x, FLOOR - 4, 6, [INK, "#8fa3da"], 260);
        } else if (ev === "rim") {
            sounds.rim();
            lastHitAt = clock;
        } else if (ev === "board") {
            sounds.board();
            lastHitAt = clock;
        } else if (ev === "block") {
            sounds.block();
            shakeUntil = clock + 0.3;
            flashMessage("BLOCKED!", 1);
        } else if (ev === "wall") {
            sounds.wall();
        } else if (ev === "score") {
            scoredAt = clock;
            crowdCheer = 1;
            sounds.score();
            burst(world.hoopX, world.hoopY + 20, 90, [CYAN, PINK, YELLOW, INK, ORANGE], 900);
            flashMessage("BASKET!", 1.2);
        }
    }
}

function update(dt: number): void {
    clock += dt;
    world = worldAt(LEVELS[levelIndex()]!, wind, clock, worldPhase);
    crowdCheer = Math.max(0, crowdCheer - dt * 0.5);

    if (phase === "aim") {
        timeLeft -= dt;
        if (timeLeft <= 0) {
            // shot clock violation: the shot is lost
            sounds.buzzer();
            shotsTaken += 1;
            pips[shotsTaken - 1]?.classList.add("used");
            flashMessage("SHOT CLOCK!", 1.4);
            dragOrigin = null;
            dragNow = null;
            keyAim.used = false;
            shot = null;
            outcome = "clock";
            phase = "between";
            betweenTimer = 1.2;
        }
    } else if (phase === "flying" && shot) {
        const sub = 4;
        for (let i = 0; i < sub; i++) {
            step(shot, dt / sub, world);
            handleEvents(shot);
        }
        ballRest = { x: shot.x, y: shot.y };
        ballAngle = shot.angle;
        ballSquash = Math.max(ballSquash - dt * 6, shot.squash);
        trail.push({ x: shot.x, y: shot.y });
        if (trail.length > 14) trail.shift();
        if (shot.done) {
            phase = "between";
            outcome = shot.scored ? "score" : "miss";
            betweenTimer = shot.scored ? 0.5 : 0.9;
        }
    } else if (phase === "between") {
        betweenTimer -= dt;
        ballSquash = Math.max(0, ballSquash - dt * 6);
        if (betweenTimer <= 0) {
            if (outcome === "score" && shot) {
                showResult(true, !shot.touched && !shot.blocked);
            } else if (shotsTaken >= TOTAL_SHOTS) {
                showResult(false, false);
            } else {
                startShot();
            }
        }
    }

    for (const b of bits) {
        b.vy += 1400 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.rot += b.vr * dt;
        b.life -= dt;
    }
    bits = bits.filter((b) => b.y < H + 40 && b.life > 0);
}

// ---------- drawing ----------
let dotPattern: CanvasPattern | null = null;
function halftone(): CanvasPattern | null {
    if (dotPattern) return dotPattern;
    const c = document.createElement("canvas");
    c.width = 12;
    c.height = 12;
    const p = c.getContext("2d");
    if (!p) return null;
    p.fillStyle = PINK;
    p.beginPath();
    p.arc(6, 6, 3.6, 0, Math.PI * 2);
    p.fill();
    dotPattern = g.createPattern(c, "repeat");
    return dotPattern;
}

const DISPLAY = '"Anybody", "Arial Black", sans-serif';

function drawBackground(): void {
    g.fillStyle = WHITE;
    g.fillRect(0, 0, W, H);

    const drift = reduceMotion ? 0 : clock;

    // spotlight beams from the top
    g.save();
    g.globalAlpha = 0.07;
    g.fillStyle = INK;
    for (const bx of [210, 450, 690]) {
        g.beginPath();
        g.moveTo(bx - 14, 0);
        g.lineTo(bx + 14, 0);
        g.lineTo(bx + 110, FLOOR);
        g.lineTo(bx - 110, FLOOR);
        g.closePath();
        g.fill();
    }
    g.restore();

    g.save();
    g.globalCompositeOperation = "multiply";
    g.fillStyle = CYAN;
    g.globalAlpha = 0.45;
    g.beginPath();
    g.arc(640 + Math.sin(drift * 0.25) * 22, 235 + Math.cos(drift * 0.21) * 14, 200, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = YELLOW;
    g.globalAlpha = 0.65;
    g.beginPath();
    g.arc(300 + Math.cos(drift * 0.2) * 26, 430 + Math.sin(drift * 0.27) * 12, 110, 0, Math.PI * 2);
    g.fill();
    const pattern = halftone();
    if (pattern) {
        g.save();
        g.translate(500 + Math.sin(drift * 0.18) * 20, 340);
        g.fillStyle = pattern;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.arc(0, 0, 130, 0, Math.PI * 2);
        g.fill();
        g.restore();
    }
    g.restore();

    drawCrowd();

    // floor and court paint
    g.fillStyle = INK;
    g.fillRect(0, FLOOR, W, H - FLOOR);
    g.fillStyle = YELLOW;
    g.fillRect(0, FLOOR, W, 5);
    g.fillStyle = PAPER;
    for (let x = 30; x < W; x += 90) g.fillRect(x, FLOOR + 34, 36, 4);
    // the key under the hoop and a free-throw arc
    g.fillStyle = PINK;
    g.globalAlpha = 0.9;
    g.fillRect(612, FLOOR + 8, 240, 12);
    g.globalAlpha = 1;
    g.strokeStyle = PAPER;
    g.lineWidth = 3;
    g.beginPath();
    g.ellipse(612, FLOOR + 14, 70, 9, 0, Math.PI * 0.5, Math.PI * 1.5);
    g.stroke();
}

function drawCrowd(): void {
    const colors = [INK, CYAN, PINK, YELLOW];
    const cheer = crowdCheer;
    g.save();
    g.globalAlpha = 0.13;
    for (let row = 0; row < 2; row++) {
        const baseY = 86 + row * 24;
        for (let i = 0; i < 38; i++) {
            const x = 12 + i * 24 + (row % 2) * 12;
            const jump = cheer > 0 ? Math.abs(Math.sin(clock * 9 + i)) * 10 * cheer : 0;
            g.fillStyle = colors[(i * 3 + row) % colors.length] ?? INK;
            g.beginPath();
            g.arc(x, baseY - jump, 8, 0, Math.PI * 2);
            g.fill();
            g.fillRect(x - 9, baseY + 6 - jump, 18, 16);
        }
    }
    g.restore();
}

function drawScoreboard(): void {
    const x = W / 2 - 150;
    const y = 12;
    g.fillStyle = CYAN;
    g.fillRect(x + 6, y + 6, 300, 56);
    g.fillStyle = INK;
    g.fillRect(x, y, 300, 56);
    g.fillStyle = CREAM;
    g.font = `800 12px ${DISPLAY}`;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    const n = Math.min(shotsTaken + (phase === "aim" ? 1 : 0), TOTAL_SHOTS);
    g.fillText(`SHOT ${n}/${TOTAL_SHOTS}`, x + 14, y + 20);
    g.fillStyle = YELLOW;
    g.fillText(LEVELS[levelIndex()]!.name.toUpperCase(), x + 14, y + 44);

    // shot clock
    const secs = Math.max(0, Math.ceil(timeLeft));
    g.textAlign = "center";
    g.font = `900 34px ${DISPLAY}`;
    g.fillStyle = phase === "aim" && timeLeft < 3.5 ? PINK : YELLOW;
    g.fillText(String(secs).padStart(2, "0"), x + 150, y + 42);

    // wind gauge
    g.textAlign = "right";
    g.font = `800 12px ${DISPLAY}`;
    g.fillStyle = CREAM;
    g.fillText("WIND", x + 286, y + 20);
    const strength = Math.round(Math.abs(wind) / 10);
    g.fillStyle = CYAN;
    g.font = `900 18px ${DISPLAY}`;
    const arrow = wind < 0 ? "←" : "→";
    g.fillText(strength === 0 ? "0" : wind < 0 ? `${arrow} ${strength}` : `${strength} ${arrow}`, x + 286, y + 44);
}

function drawDefenders(): void {
    world.defenders.forEach((d, i) => drawDefender(d, i));
}

function drawDefender(d: DefenderState, index: number): void {
    const x = d.x;
    const foot = FLOOR - d.lift;
    const top = d.body.y0;
    // shadow
    g.fillStyle = "rgba(8, 16, 48, 0.35)";
    g.beginPath();
    g.ellipse(x, FLOOR + 12, 30 - d.lift / 5, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = INK;
    // legs
    g.fillStyle = INK;
    const stride = Math.sin(clock * 6) * (d.lift > 4 ? 2 : 5);
    g.fillRect(x - 17, foot - 40, 13, 40 - 0);
    g.fillRect(x + 4 + stride, foot - 40, 13, 40);
    // shorts
    g.fillStyle = PINK;
    g.fillRect(x - 22, foot - 62, 44, 26);
    g.strokeRect(x - 22, foot - 62, 44, 26);
    // jersey
    g.fillStyle = index === 0 ? CYAN : YELLOW;
    g.fillRect(x - 22, top + 20, 44, 40);
    g.strokeRect(x - 22, top + 20, 44, 40);
    g.fillStyle = INK;
    g.font = `900 22px ${DISPLAY}`;
    g.textAlign = "center";
    g.fillText(index === 0 ? "7" : "23", x, top + 50);
    // head
    g.fillStyle = "#d9a679";
    g.beginPath();
    g.arc(x, top + 4, 16, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // arms raised to block
    g.lineCap = "round";
    g.lineWidth = 11;
    g.strokeStyle = "#d9a679";
    g.beginPath();
    g.moveTo(x - 20, top + 28);
    g.lineTo(x - 36, top - 54);
    g.moveTo(x + 20, top + 28);
    g.lineTo(x + 36, top - 54);
    g.stroke();
    g.lineCap = "butt";
}

function drawBoard(): void {
    const b = world.board;
    const w = b.x1 - b.x0;
    g.strokeStyle = INK;
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(b.x1, b.y1 - 24);
    g.lineTo(b.x1 + 30, b.y1 - 24);
    g.lineTo(b.x1 + 30, FLOOR);
    g.stroke();
    g.fillStyle = CYAN;
    g.fillRect(b.x0 + 10, b.y0 + 10, w + 8, b.y1 - b.y0);
    g.fillStyle = WHITE;
    g.fillRect(b.x0 - 8, b.y0, w + 8, b.y1 - b.y0);
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.strokeRect(b.x0 - 8, b.y0, w + 8, b.y1 - b.y0);
    g.strokeStyle = PINK;
    g.strokeRect(b.x0 - 8, world.hoopY - 52, w + 8, 52);
    // flag on the pole to show the wind
    const poleX = b.x1 + 30;
    const flagY = FLOOR - 120;
    const lean = Math.max(-1, Math.min(1, wind / 120));
    const wave = reduceMotion ? 0 : Math.sin(clock * 6) * 4;
    g.strokeStyle = INK;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(poleX, flagY);
    g.lineTo(poleX, flagY - 40);
    g.stroke();
    g.fillStyle = YELLOW;
    g.beginPath();
    g.moveTo(poleX, flagY - 40);
    g.lineTo(poleX + lean * 34 + wave, flagY - 32);
    g.lineTo(poleX, flagY - 22);
    g.closePath();
    g.fill();
    g.stroke();
}

function drawRimAndNet(): void {
    const left = world.hoopX - world.rimR;
    const right = world.hoopX + world.rimR;
    const hy = world.hoopY + (reduceMotion ? 0 : Math.sin((clock - lastHitAt) * 50) * Math.max(0, 1 - (clock - lastHitAt) * 3) * 4);

    const age = clock - scoredAt;
    const sway = reduceMotion ? 0 : Math.sin(age * 22) * Math.max(0, 1 - age * 1.6) * 10;
    const bottomY = hy + 78 + (age < 0.4 && !reduceMotion ? 12 : 0);
    const n = 6;
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath();
    const tops: Point[] = [];
    const bots: Point[] = [];
    for (let i = 0; i <= n; i++) {
        const f = i / n;
        tops.push({ x: left + 4 + f * (right - left - 8), y: hy + 4 });
        bots.push({ x: world.hoopX - 28 + f * 56 + sway, y: bottomY });
    }
    for (let i = 0; i <= n; i++) {
        const t = tops[i];
        const b = bots[i];
        if (!t || !b) continue;
        g.moveTo(t.x, t.y);
        g.lineTo(b.x, b.y);
        const nb = bots[i + 1];
        const nt = tops[i + 1];
        if (nb && nt) {
            g.moveTo(t.x, t.y);
            g.lineTo(nb.x, nb.y);
            g.moveTo(nt.x, nt.y);
            g.lineTo(b.x, b.y);
        }
    }
    g.stroke();

    g.lineCap = "round";
    g.strokeStyle = INK;
    g.lineWidth = 13;
    g.beginPath();
    g.moveTo(left, hy);
    g.lineTo(right, hy);
    g.stroke();
    g.strokeStyle = PINK;
    g.lineWidth = 7;
    g.beginPath();
    g.moveTo(left, hy);
    g.lineTo(right, hy);
    g.stroke();
    g.lineCap = "butt";
}

function drawBall(): void {
    const { x, y } = ballRest;

    // motion trail
    if (!reduceMotion) {
        trail.forEach((p, i) => {
            g.fillStyle = ORANGE;
            g.globalAlpha = (i / trail.length) * 0.22;
            g.beginPath();
            g.arc(p.x, p.y, BALL_R * (0.4 + (i / trail.length) * 0.5), 0, Math.PI * 2);
            g.fill();
        });
        g.globalAlpha = 1;
    }

    const height = Math.max(0, FLOOR - y - BALL_R);
    const sh = Math.max(0.35, 1 - height / 520);
    g.fillStyle = "rgba(8, 16, 48, 0.33)";
    g.beginPath();
    g.ellipse(x, FLOOR + 14, BALL_R * 1.15 * sh, 5 * sh, 0, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.translate(x, y + ballSquash * 6);
    g.scale(1 + ballSquash * 0.18, 1 - ballSquash * 0.18);
    g.rotate(ballAngle);
    g.fillStyle = ORANGE;
    g.beginPath();
    g.arc(0, 0, BALL_R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = INK;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(-BALL_R, 0);
    g.lineTo(BALL_R, 0);
    g.moveTo(0, -BALL_R);
    g.lineTo(0, BALL_R);
    g.stroke();
    g.beginPath();
    g.arc(-BALL_R * 1.25, 0, BALL_R * 0.85, -0.95, 0.95);
    g.stroke();
    g.beginPath();
    g.arc(BALL_R * 1.25, 0, BALL_R * 0.85, Math.PI - 0.95, Math.PI + 0.95);
    g.stroke();
    g.lineWidth = 3.5;
    g.beginPath();
    g.arc(0, 0, BALL_R, 0, Math.PI * 2);
    g.stroke();
    g.restore();
}

function drawAim(): void {
    if (phase !== "aim") return;
    const v = currentVelocity();
    if (!v) return;

    // only the first part of the arc, and it ignores the wind
    previewArc(v.x, v.y, 9).forEach((p, i) => {
        g.fillStyle = i % 2 === 0 ? INK : PINK;
        g.globalAlpha = 1 - i * 0.07;
        g.beginPath();
        g.arc(p.x, p.y, Math.max(2.5, 6.5 - i * 0.3), 0, Math.PI * 2);
        g.fill();
    });
    g.globalAlpha = 1;

    const power = Math.min(1, Math.hypot(v.x, v.y) / (MAX_DRAG * 10));
    const gx = START.x - 50;
    const gy = FLOOR + 40;
    g.fillStyle = PAPER;
    g.fillRect(gx, gy, 100, 10);
    g.fillStyle = power > 0.92 ? PINK : CYAN;
    g.fillRect(gx, gy, 100 * power, 10);
}

function drawFlash(): void {
    if (clock > flashUntil || !flash) return;
    const left = flashUntil - clock;
    g.save();
    g.globalAlpha = Math.min(1, left * 3);
    g.textAlign = "center";
    g.font = `900 64px ${DISPLAY}`;
    g.lineWidth = 8;
    g.strokeStyle = INK;
    g.fillStyle = YELLOW;
    g.strokeText(flash, W / 2, 190);
    g.fillText(flash, W / 2, 190);
    g.restore();
}

function drawBits(): void {
    for (const b of bits) {
        g.save();
        g.globalAlpha = Math.min(1, b.life * 2);
        g.translate(b.x, b.y);
        g.rotate(b.rot);
        g.fillStyle = b.color;
        g.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        g.restore();
    }
}

function draw(): void {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (clock < shakeUntil && !reduceMotion) {
        g.translate((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    }
    drawBackground();
    drawScoreboard();
    drawBoard();
    drawDefenders();
    drawBall();
    drawRimAndNet();
    drawAim();
    drawBits();
    drawFlash();
}

// ---------- loop ----------
let last = performance.now();
function frame(now: number): void {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
}

startShot();
void document.fonts.load(`900 24px ${DISPLAY}`).finally(() => requestAnimationFrame(frame));

// Test hook: lets automated checks read the game state without touching the page.
(window as unknown as { __gate?: () => unknown }).__gate = () => ({
    phase,
    shotsTaken,
    scored: shot?.scored ?? false,
    hoopY: world.hoopY,
    hoopX: world.hoopX,
    rimR: world.rimR,
    wind,
    timeLeft,
    clock,
    worldPhase,
    level: levelIndex(),
});
void BOARD_X;
