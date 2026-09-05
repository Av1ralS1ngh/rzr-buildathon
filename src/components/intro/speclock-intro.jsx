"use client";

import React from "react";
import {
  CompositionStage,
  Captions,
  Easing,
  animate,
  clamp,
  useComposition,
} from "./animations-v3";

// Scene list is the single source of structure for the composition engine.
export const OM_SCENES = JSON.stringify([
  { name: "Negotiate", dur: 6.5, desc: "Buyer and printer push number cards toward each other until the gap closes and a green seal lands" },
  { name: "Change", dur: 6.5, desc: "A priced amendment slip and its delta deposit pass to the printer and attach to the already-stamped sheet" },
  { name: "Record", dur: 6.5, desc: "The ledger strip unspools with timestamped marks; its last row condenses into a lock seal" },
  { name: "Agents", dur: 6.5, desc: "A generic shopping agent at the same table: no counteroffer, the locked change bounces off, blank tape cut short in amber" },
  { name: "Ask", dur: 6.5, desc: "The buyer speaks; three spoken fragments fly onto a spec sheet as structured fields and a spec hash stamps" },
  { name: "Verify", dur: 6.5, desc: "The SpecLock agent pays a coin to each of three capability checks and a green tick lands on every card" },
  { name: "Price", dur: 6.5, desc: "Six pricebook line bars grow, then fold into one total card" },
  { name: "Deal", dur: 6.5, desc: "Buyer and agent step their offers inward inside a bracketed signed-authority envelope until they meet on a seal" },
  { name: "Lock", dur: 6.5, desc: "Sheet and deposit coin converge into one hash seal, then a label strip runs off the press" },
]);


var W = 1320, H = 660, GROUND = 500, TABLE_Y = 420, SHIFT = 200, STEP = 700 + SHIFT;

// section order — must match OM_SCENES names and the scenes array below
var NAMES = ['Negotiate', 'Change', 'Record', 'Agents', 'Ask', 'Verify', 'Price', 'Deal', 'Lock'];
// scenes 6-9 were authored on STEP spacing instead of the 700 the world uses;
// this pulls each back onto its camera station without touching their geometry
var STATION_FIX = [0, 0, 0, 0, 0, -200, -400, -600, -800];
var EXAMPLES = [
  { tag: 'THE ORDER', text: '10,000 pickle jar labels. The buyer says \u20B925,000. The printer says \u20B930,000.' },
  { tag: 'THE CHANGE', text: 'Approved already, then: make it 12,000. The printer just adds the difference.' },
  { tag: 'THE RECORD', text: 'Who offered what, and when, kept in order and never rewritten.' },
  { tag: 'TODAY', text: 'A shopping agent knows one page and one price. It cannot do any of that.' },
  { tag: 'YOU TYPE', text: '\u201C10,000 waterproof pickle jar labels, 50\u00D730mm, to 560001, under \u20B925,000.\u201D' },
  { tag: 'IT CHECKS', text: 'Can it print? Is the label legal? Is there capacity? It pays \u20B9350 to find out.' },
  { tag: 'IT PRICES', text: 'Setup \u20B93,500, material \u20B93,200, printing \u20B9600, and so on: \u20B99,703.88.' },
  { tag: 'IT BARGAINS', text: 'You allow \u20B935 to \u20B960 a label. It lands \u20B954 without showing your floor.' },
  { tag: 'IT LOCKS', text: '\u20B92,911.16 deposit taken, tied to this exact spec. Printing starts.' },
];
var CAPTIONS = [
  'Two people can meet in the middle.',
  'And absorb a change halfway through.',
  'And remember every word of it.',
  "AI agents can do none of the three.",
  'SpecLock starts with a sentence, not a form.',
  'Its agent buys the checks that prove the job can be printed.',
  'The price is read off a pricebook, never guessed.',
  'It bargains only inside limits you signed.',
  'Deposit and spec lock together, and the press starts.',
];

function palette(dark) {
  return dark ? {
    bg: '#070C1D', fig: '#ECEFF7', accent: '#4E8BFF', green: '#35C295',
    amber: '#E0A146', paper: '#1A1730', paperEdge: '#322A47',
  } : {
    bg: '#F2F4F8', fig: '#0D1330', accent: '#1F63E8', green: '#0F8A63',
    amber: '#B06B00', paper: '#FBF6EA', paperEdge: '#E8DFC9',
  };
}

// ---- the only three motion helpers -----------------------------------------
var MOTION = {
  enter: function (o) { return animate({ from: o.from, to: o.to, start: o.start, end: o.end, ease: Easing.easeOutCubic }); },
  draw: function (o) { return animate({ from: o.from, to: o.to, start: o.start, end: o.end, ease: Easing.easeInOutCubic }); },
  pop: function (o) { return animate({ from: o.from, to: o.to, start: o.start, end: o.end, ease: Easing.easeOutBack }); },
};
var lerp = function (v, a, b) { return a + (b - a) * v; };
var bob = function (T, phase, amp, speed) { return Math.sin(T * (speed || 1.5) + phase) * (amp || 2); };
var arch = function (v) { return Math.sin(clamp(v, 0, 1) * Math.PI); };

// ---- primitives -------------------------------------------------------------
function Arm(props) {
  var sx = props.sx, sy = props.sy, hx = props.hx, hy = props.hy;
  var mx = (sx + hx) / 2, my = (sy + hy) / 2 + (props.sag == null ? 16 : props.sag);
  return <path d={'M ' + sx + ' ' + sy + ' Q ' + mx + ' ' + my + ' ' + hx + ' ' + hy}
    fill="none" stroke={props.color} strokeWidth={props.w || 16} strokeLinecap="round" opacity={props.opacity} />;
}

function Buyer(props) {
  var P = props.P, x = props.x, f = props.facing, o = props.opacity == null ? 1 : props.opacity;
  var y = GROUND + (props.dy || 0);
  var hx = props.hx == null ? x + f * 44 : props.hx;
  var hy = props.hy == null ? y - 112 : props.hy;
  return (
    <g opacity={o}>
      <g transform={'translate(' + x + ' ' + y + ') scale(' + f + ' 1)'}>
        <rect x={-54} y={-96} width={34} height={50} rx={7} fill={P.fig} opacity={0.4} />
        <path d="M -48 -96 Q -37 -119 -26 -96" fill="none" stroke={P.fig} strokeWidth={3.5} opacity={0.45} />
        <path d="M -21 0 L -25 -102 Q -25 -131 0 -131 Q 25 -131 25 -102 L 21 0 Z" fill={P.fig} />
        <circle cx={0} cy={-160} r={26} fill={P.fig} />
        <Arm sx={-15} sy={-119} hx={-40} hy={-100} color={P.fig} w={14} sag={6} />
        {props.showPhone && <rect x={-50} y={-124} width={15} height={24} rx={3} fill={P.fig} opacity={0.55} />}
      </g>
      <Arm sx={x + f * 15} sy={y - 118} hx={hx} hy={hy} color={P.fig} w={15} sag={props.sag} />
    </g>
  );
}

function Printer(props) {
  var P = props.P, x = props.x, f = props.facing, o = props.opacity == null ? 1 : props.opacity;
  var y = GROUND + (props.dy || 0);
  var shX = x + f * 20, shY = y - 116;
  var hx = props.hx == null ? x + f * 50 : props.hx;
  var hy = props.hy == null ? y - 110 : props.hy;
  var rs = props.rollSide === 'right' ? -1 : 1;
  return (
    <g opacity={o}>
      <g transform={'translate(' + x + ' ' + y + ') scale(' + f + ' 1)'}>
        <path d="M -29 0 L -33 -96 Q -33 -130 0 -130 Q 33 -130 33 -96 L 29 0 Z" fill={P.fig} />
        <circle cx={0} cy={-158} r={28} fill={P.fig} />
        <path d="M -24 -168 Q 0 -210 24 -168 Z" fill={P.fig} />
        <rect x={10} y={-178} width={34} height={8} rx={4} fill={P.fig} opacity={0.75} />
        <circle cx={rs * -50} cy={-88} r={30} fill={P.fig} opacity={0.4} />
        <circle cx={rs * -50} cy={-88} r={11} fill={P.bg} />
        {!props.arm2 && <Arm sx={-20} sy={-117} hx={-46} hy={-74} color={P.fig} w={15} sag={6} />}
      </g>
      <Arm sx={shX} sy={shY} hx={hx} hy={hy} color={P.fig} w={16} sag={props.sag} />
      {props.arm2 && <Arm sx={shX} sy={shY + 10} hx={props.arm2.x} hy={props.arm2.y} color={P.fig} w={15}
        sag={props.arm2.sag == null ? 10 : props.arm2.sag} />}
    </g>
  );
}

function Agent(props) {
  var P = props.P, blink = props.blink;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ')'}>
      <rect x={-50} y={-18} width={100} height={18} rx={9} fill={P.fig} opacity={0.4} />
      <path d="M -38 -16 L -36 -120 Q -36 -134 -22 -134 L 22 -134 Q 36 -134 36 -120 L 38 -16 Z" fill={P.fig} />
      <rect x={-24} y={-118} width={48} height={10} rx={5} fill={P.bg} opacity={0.32} />
      <circle cx={-14} cy={-94} r={3.5} fill={P.accent} opacity={0.9} />
      <circle cx={0} cy={-94} r={3.5} fill={P.bg} opacity={0.28} />
      <circle cx={14} cy={-94} r={3.5} fill={P.bg} opacity={0.28} />
      <g opacity={0.26} transform="translate(0 -62)">
        <path d="M -19 -13 L -12 -13 L -6 7 L 14 7 L 18 -6 L -9 -6" fill="none" stroke={P.bg}
          strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={-4} cy={14} r={3.5} fill={P.bg} />
        <circle cx={11} cy={14} r={3.5} fill={P.bg} />
      </g>
      <rect x={-8} y={-152} width={16} height={22} fill={P.fig} />
      <rect x={-42} y={-206} width={84} height={58} rx={17} fill={P.fig} />
      <rect x={-30} y={-190} width={60} height={26} rx={13} fill={P.bg} opacity={0.9} />
      <g transform={'translate(0 -177) scale(1 ' + blink + ')'}>
        <circle cx={0} cy={0} r={7.5} fill={P.fig} opacity={0.7} />
      </g>
      <rect x={-2} y={-222} width={4} height={18} rx={2} fill={P.fig} opacity={0.5} />
      <circle cx={0} cy={-226} r={5} fill={P.fig} opacity={0.5} />
    </g>
  );
}

function NumberCard(props) {
  var P = props.P, s = props.s == null ? 1 : props.s;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') rotate(' + (props.rot || 0) + ') scale(' + s + ')'} opacity={props.opacity}>
      <rect x={-40} y={-28} width={80} height={56} rx={9} fill={P.accent} />
      <rect x={-26} y={-16} width={34} height={12} rx={4} fill={P.bg} opacity={0.9} />
      <rect x={-26} y={2} width={44} height={7} rx={3.5} fill={P.bg} opacity={0.5} />
      <rect x={-26} y={13} width={28} height={7} rx={3.5} fill={P.bg} opacity={0.5} />
    </g>
  );
}

function Slip(props) {
  var P = props.P, s = props.s == null ? 1 : props.s;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') rotate(' + (props.rot || 0) + ') scale(' + s + ')'} opacity={props.opacity}>
      <rect x={-36} y={-26} width={72} height={52} rx={8} fill={P.accent} />
      <rect x={-23} y={-13} width={28} height={9} rx={4.5} fill={P.bg} opacity={0.9} />
      <rect x={-23} y={3} width={40} height={7} rx={3.5} fill={P.bg} opacity={0.5} />
      <circle cx={22} cy={-12} r={5} fill={P.bg} opacity={0.8} />
    </g>
  );
}

function Coin(props) {
  var P = props.P;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') scale(' + (props.s == null ? 1 : props.s) + ')'} opacity={props.opacity}>
      <circle cx={0} cy={0} r={14} fill={P.accent} />
      <circle cx={0} cy={0} r={7} fill="none" stroke={P.bg} strokeWidth={3} opacity={0.85} />
    </g>
  );
}

function HashSeal(props) {
  var P = props.P, s = props.s == null ? 1 : props.s;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') scale(' + s + ')'} opacity={props.opacity}>
      <circle cx={0} cy={0} r={23} fill="none" stroke={P.green} strokeWidth={5} />
      <path d="M -8 -3 L -8 -9 Q -8 -17 0 -17 Q 8 -17 8 -9 L 8 -3" fill="none" stroke={P.fig}
        strokeWidth={4} strokeLinecap="round" opacity={0.85} />
      <rect x={-11} y={-4} width={22} height={16} rx={4} fill={P.fig} opacity={0.85} />
    </g>
  );
}

function Sheet(props) {
  var P = props.P, w = props.w || 116, h = props.h || 84;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') rotate(' + (props.rot || 0) + ')'} opacity={props.opacity}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={5} fill={P.paper} stroke={P.paperEdge} strokeWidth={2.5} />
      {[0, 1, 2].map(function (i) {
        return <rect key={i} x={-w / 2 + 14} y={-h / 2 + 16 + i * 14} width={i === 2 ? 32 : 54 - i * 8}
          height={5.5} rx={2.8} fill={P.fig} opacity={0.3} />;
      })}
      {props.stamp != null && (
        <g transform={'translate(' + (w / 2 - 26) + ' ' + (h / 2 - 24) + ') scale(' + props.stamp + ')'} opacity={clamp(props.stamp, 0, 1)}>
          <circle cx={0} cy={0} r={17} fill="none" stroke={P.green} strokeWidth={4.5} />
          <path d="M -7 0 L -2 6 L 8 -6" fill="none" stroke={P.green} strokeWidth={4.5}
            strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </g>
  );
}

function Table(props) {
  var P = props.P, legs = [];
  for (var lx = -200; lx < 9200; lx += 460) legs.push(lx);
  return (
    <g>
      <rect x={-500} y={TABLE_Y} width={10200} height={24} rx={6} fill={P.fig} opacity={0.14} />
      <rect x={-500} y={TABLE_Y} width={10200} height={4} fill={P.fig} opacity={0.28} />
      {legs.map(function (lx) {
        return <rect key={lx} x={lx} y={TABLE_Y + 24} width={18} height={90} rx={5} fill={P.fig} opacity={0.1} />;
      })}
    </g>
  );
}

// SpecLock's own agent: same machine build, accent panel, a lock on its chest.
function SpecAgent(props) {
  var P = props.P;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ')'} opacity={props.opacity}>
      <rect x={-50} y={-18} width={100} height={18} rx={9} fill={P.fig} opacity={0.4} />
      <path d="M -38 -16 L -36 -120 Q -36 -134 -22 -134 L 22 -134 Q 36 -134 36 -120 L 38 -16 Z" fill={P.fig} />
      <rect x={-26} y={-104} width={52} height={30} rx={9} fill={P.accent} />
      <circle cx={0} cy={-89} r={7} fill={P.bg} />
      <g transform="translate(0 -46)">
        <circle cx={0} cy={0} r={17} fill="none" stroke={P.green} strokeWidth={4} />
        <path d="M -6 -2 L -6 -8 Q -6 -15 0 -15 Q 6 -15 6 -8 L 6 -2" fill="none" stroke={P.bg} strokeWidth={3.5} strokeLinecap="round" />
        <rect x={-8} y={-3} width={16} height={13} rx={2.5} fill={P.bg} />
      </g>
      <rect x={-2.5} y={-152} width={5} height={20} rx={2.5} fill={P.fig} opacity={0.6} />
      <circle cx={0} cy={-156} r={6} fill={P.green} opacity={props.pulse == null ? 1 : props.pulse} />
    </g>
  );
}

// a spoken fragment on its way to becoming a structured field
function Chip(props) {
  var P = props.P;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') rotate(' + (props.rot || 0) + ')'} opacity={props.opacity}>
      <rect x={-props.w / 2} y={-11} width={props.w} height={22} rx={11} fill={P.accent} opacity={0.16} />
      <rect x={-props.w / 2 + 9} y={-3.5} width={props.w - 18} height={7} rx={3.5} fill={P.accent} opacity={0.8} />
    </g>
  );
}

// a check the agent pays for: outline, then a green tick once settled
function CheckCard(props) {
  var P = props.P, s = props.s == null ? 1 : props.s;
  return (
    <g transform={'translate(' + props.x + ' ' + props.y + ') scale(' + s + ')'} opacity={props.opacity}>
      <rect x={-38} y={-30} width={76} height={60} rx={9} fill={P.paper} stroke={props.done > 0.5 ? P.green : P.paperEdge} strokeWidth={2.5} />
      <rect x={-24} y={-18} width={34} height={6} rx={3} fill={P.fig} opacity={0.35} />
      <rect x={-24} y={-6} width={22} height={5} rx={2.5} fill={P.fig} opacity={0.22} />
      <g transform={'translate(14 14) scale(' + clamp(props.done, 0, 1) + ')'} opacity={clamp(props.done, 0, 1)}>
        <circle cx={0} cy={0} r={13} fill="none" stroke={P.green} strokeWidth={4} />
        <path d="M -5.5 0 L -1.5 4.5 L 6 -4.5" fill="none" stroke={P.green} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </g>
  );
}

// ---- scene 1: negotiation (station centre 660) -------------------------------
function SceneNegotiate(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var rise = MOTION.enter({ from: 44, to: 0, start: 0.05, end: 0.9 })(t);
  var fade = MOTION.enter({ from: 0, to: 1, start: 0.05, end: 0.8 })(t);
  var conv = MOTION.draw({ from: 0, to: 1, start: 2.1, end: 3.9 })(t);
  var cardAx = lerp(conv, 552, 622), cardBx = lerp(conv, 768, 698);
  var handY = TABLE_Y - 48;
  var sealS = MOTION.pop({ from: 0, to: 1, start: 4.15, end: 4.9 })(t);
  var nod = arch((t - 4.2) / 0.7) * 5;
  var gapOp = MOTION.enter({ from: 0, to: 1, start: 1.4, end: 2.0 })(t) * (1 - clamp((conv - 0.5) / 0.35, 0, 1));

  if (layer === 'figures') return (
    <g>
      <Buyer P={P} x={470} facing={1} dy={rise + nod + bob(T, 0, 2)} opacity={fade}
        hx={cardAx - 34} hy={handY} sag={20} />
      <Printer P={P} x={850} facing={-1} dy={rise + nod + bob(T, 1.7, 2)} opacity={fade}
        hx={cardBx + 34} hy={handY} sag={20} />
    </g>
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <g opacity={gapOp}>
        <path d={'M ' + (cardAx + 44) + ' 328 L ' + (cardBx - 44) + ' 328'} stroke={P.fig}
          strokeWidth={2.5} strokeDasharray="8 9" opacity={0.45} />
        <rect x={cardAx + 42} y={316} width={3} height={24} fill={P.fig} opacity={0.5} />
        <rect x={cardBx - 45} y={316} width={3} height={24} fill={P.fig} opacity={0.5} />
      </g>
      <NumberCard P={P} x={cardAx} y={378 + bob(T, 0.4, 2.5)} rot={-5 + conv * 3}
        s={MOTION.pop({ from: 0.72, to: 1, start: 0.6, end: 1.4 })(t)}
        opacity={MOTION.enter({ from: 0, to: 1, start: 0.6, end: 1.1 })(t)} />
      <NumberCard P={P} x={cardBx} y={370 + bob(T, 2.2, 2.5)} rot={6 - conv * 3.6}
        s={MOTION.pop({ from: 0.72, to: 1, start: 0.95, end: 1.75 })(t)}
        opacity={MOTION.enter({ from: 0, to: 1, start: 0.95, end: 1.45 })(t)} />
      <g transform={'translate(660 ' + (TABLE_Y - 100) + ') scale(' + sealS + ')'} opacity={clamp(sealS, 0, 1)}>
        <circle cx={0} cy={0} r={19} fill="none" stroke={P.green} strokeWidth={5} />
        <circle cx={0} cy={0} r={6.5} fill={P.green} />
      </g>
    </g>
  );
}

// ---- scene 2: priced amendment on a locked sheet (station centre 1360) -------
function SceneChange(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var sheetX = lerp(clamp(t / c.dur, 0, 1), 1308, 1420);
  var sheetY = 374 + bob(T, 0.9, 2);
  var lift = MOTION.enter({ from: 0, to: 1, start: 0.9, end: 1.8 })(t);
  var pass = MOTION.draw({ from: 0, to: 1, start: 1.5, end: 3.3 })(t);
  var place = MOTION.draw({ from: 0, to: 1, start: 3.5, end: 4.5 })(t);
  var shown = MOTION.enter({ from: 0, to: 1, start: 0.85, end: 1.35 })(t);
  var nod = arch((t - 3.3) / 0.6) * 6;
  var drop = MOTION.enter({ from: 0, to: 1, start: 2.0, end: 2.9 })(t);
  var bHand = { x: 1248, y: lerp(lift, 386, 348) };
  var pHand = { x: 1478, y: lerp(lift, 392, 356) };
  var attach = { x: sheetX + 40, y: sheetY - 38 };
  // the slip and its delta deposit travel together: buyer -> printer -> onto the locked sheet
  var track = function (d) {
    var a = clamp(pass - d, 0, 1), b = clamp(place - d, 0, 1);
    if (b <= 0) return { x: lerp(a, bHand.x, pHand.x), y: lerp(a, bHand.y, pHand.y) - arch(a) * 40, r: a * 12 };
    return { x: lerp(b, pHand.x, attach.x), y: lerp(b, pHand.y, attach.y) - arch(b) * 20, r: lerp(b, 12, -7) };
  };
  var sl = track(0), co = track(0.16);

  if (layer === 'figures') return (
    <g>
      <Buyer P={P} x={1170} facing={1} dy={bob(T, 0.6, 2)}
        hx={lerp(drop, bHand.x, 1222)}
        hy={lerp(drop, bHand.y + arch(pass * 1.4) * 8, 388)} sag={lerp(drop, 10, 18)} />
      <Printer P={P} x={1550} facing={-1} dy={nod + bob(T, 2.4, 2)}
        hx={place > 0.02 ? lerp(place, pHand.x, attach.x + 26) : pHand.x}
        hy={place > 0.02 ? lerp(place, pHand.y, attach.y + 20) : pHand.y}
        arm2={{ x: sheetX + 26, y: sheetY + 16, sag: 34 }} sag={12} />
    </g>
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <Sheet P={P} x={sheetX} y={sheetY} rot={-2}
        stamp={MOTION.pop({ from: 0.4, to: 1, start: 0.1, end: 0.8 })(t)} />
      <Slip P={P} x={sl.x} y={sl.y} rot={sl.r} opacity={shown} s={0.8} />
      <Coin P={P} x={co.x + lerp(place, 44, -74)} y={co.y + lerp(place, 26, 64)} opacity={shown} s={0.8} />
    </g>
  );
}

// ---- scene 3: the record, ending in a seal (station centre 2060) -------------
function SceneRecord(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var spoolX = 1848, spoolY = 402;
  var len = MOTION.draw({ from: 300, to: 404, start: 0.05, end: 2.6 })(t);
  var endX = spoolX + 36 + len;
  var wave = function (x) { return Math.sin((x - spoolX) * 0.016 - T * 1.3) * 4.5; };
  var strip = 'M ' + (spoolX + 36) + ' ' + (spoolY - 26), i, px;
  for (i = 0; i <= 22; i++) { px = spoolX + 36 + (len * i) / 22; strip += ' L ' + px + ' ' + (spoolY - 26 + wave(px)); }
  for (i = 22; i >= 0; i--) { px = spoolX + 36 + (len * i) / 22; strip += ' L ' + px + ' ' + (spoolY + 28 + wave(px)); }
  strip += ' Z';
  var sealS = MOTION.pop({ from: 0, to: 1, start: 3.9, end: 4.8 })(t);
  var sealX = Math.min(endX - 40, 2214);
  var rows = [];
  for (i = 0; i < 6; i++) {
    var rx = spoolX + 84 + i * 62;
    if (rx < endX - 30) rows.push({ x: rx, y: spoolY + wave(rx), o: clamp((endX - 30 - rx) / 50, 0, 1) * (rx > sealX - 46 ? 1 - clamp(sealS, 0, 1) : 1) });
  }

  var near = clamp((endX - 2166) / 120, 0, 1);
  if (layer === 'figures') return (
    <Buyer P={P} x={2328} facing={-1} dy={bob(T, 1.1, 2, 1.1)}
      hx={lerp(near, 2294, 2282)} hy={lerp(near, 414, spoolY - 14)} sag={lerp(near, 6, 12)} />
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <circle cx={spoolX} cy={spoolY} r={34} fill="none" stroke={P.fig} strokeWidth={9} opacity={0.3} />
      <g transform={'translate(' + spoolX + ' ' + spoolY + ') rotate(' + (-len * 0.6) + ')'} opacity={0.18}>
        <rect x={-3} y={-22} width={6} height={44} rx={3} fill={P.fig} />
        <rect x={-22} y={-3} width={44} height={6} rx={3} fill={P.fig} />
      </g>
      <circle cx={spoolX} cy={spoolY} r={7} fill={P.fig} opacity={0.35} />
      <path d={strip} fill={P.paper} stroke={P.paperEdge} strokeWidth={2.5} />
      {rows.map(function (r, k) {
        return (
          <g key={k} opacity={r.o}>
            <circle cx={r.x} cy={r.y - 9} r={3.5} fill={P.fig} opacity={0.4} />
            <rect x={r.x + 10} y={r.y - 13} width={32} height={6.5} rx={3.2} fill={P.fig} opacity={0.42} />
            <rect x={r.x + 10} y={r.y + 2} width={22} height={5.5} rx={2.8} fill={P.fig} opacity={0.26} />
          </g>
        );
      })}
      <HashSeal P={P} x={sealX} y={spoolY + wave(sealX)} s={sealS} opacity={clamp(sealS, 0, 1)} />
    </g>
  );
}

// ---- scene 4: a generic checkout agent at the same table (centre 2760) -------
function SceneAgents(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var bx = 2930;
  var jitter = Math.sin(T * 8) * 0.6;
  var blink = Math.abs(Math.sin(T * 0.85)) > 0.985 ? 0.14 : 1;
  var offer = MOTION.enter({ from: 0, to: 1, start: 0.5, end: 1.2 })(t);
  var toss = MOTION.draw({ from: 0, to: 1, start: 1.2, end: 2.1 })(t);
  var ric = MOTION.enter({ from: 0, to: 1, start: 2.1, end: 3.6 })(t);
  var bHand = { x: lerp(offer, 2684, 2702), y: lerp(offer, 396, 340) };
  var slipX = toss <= 0 ? bHand.x : (toss < 1 ? lerp(toss, 2702, 2888) : lerp(ric, 2888, 2686));
  var slipY = toss <= 0 ? bHand.y : (toss < 1 ? lerp(toss, 364, 384) - arch(toss) * 44 : 384 + ric * ric * 150);
  var slipOp = clamp(MOTION.enter({ from: 0, to: 1, start: 0.55, end: 0.85 })(t) - clamp((ric - 0.6) / 0.35, 0, 1), 0, 1);
  var impact = arch((t - 2.07) / 0.45);
  var tape = MOTION.draw({ from: 0, to: 1, start: 2.4, end: 4.4 })(t);
  var tapeEnd = lerp(tape, 2946, 3082);
  var dropB = MOTION.enter({ from: 0, to: 1, start: 2.15, end: 3.1 })(t);

  if (layer === 'back') return (
    <g opacity={MOTION.enter({ from: 0, to: 1, start: 2.35, end: 3.0 })(t)}>
      <rect x={2946} y={370} width={Math.max(0, tapeEnd - 2946)} height={34} rx={4}
        fill={P.paper} stroke={P.paperEdge} strokeWidth={2.5} />
      <rect x={tapeEnd - 5} y={368} width={7} height={38} rx={3} fill={P.amber} opacity={clamp(tape * 2.5, 0, 1)} />
    </g>
  );
  if (layer === 'figures') return (
    <g>
      <Buyer P={P} x={2520} facing={1} dy={bob(T, 0.3, 2, 1.05)} showPhone
        hx={2562} hy={394} sag={20} />
      <Printer P={P} x={2646} facing={1} dy={bob(T, 2.1, 2, 1.05)} rollSide="right"
        hx={lerp(dropB, bHand.x, 2688)} hy={lerp(dropB, bHand.y, 398)} sag={lerp(dropB, 8, 22)} />
      <Agent P={P} x={bx + jitter} y={GROUND + bob(T, 4, 1.1, 2.1)} blink={blink} />
      <circle cx={2882} cy={384} r={13 + impact * 15} fill="none" stroke={P.fig} strokeWidth={3.5} opacity={impact * 0.35} />
    </g>
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <rect x={2738} y={348} width={104} height={72} rx={11} fill="none" stroke={P.fig} strokeWidth={3}
        strokeDasharray="10 10" opacity={MOTION.enter({ from: 0, to: 1, start: 0.6, end: 1.4 })(t) * 0.4} />
      <Slip P={P} x={slipX} y={slipY} rot={toss * 12 - ric * 44} s={0.94} opacity={slipOp} />
    </g>
  );
}

// ---- scene 5: it starts with a sentence (station centre 3460) ---------------
function SceneAsk(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var sx = 3596, sy = 344;
  var mouth = { x: 3352, y: 306 };
  var plate = MOTION.enter({ from: 0, to: 1, start: 0.5, end: 1.3 })(t);
  var specs = [{ d: 0, w: 82 }, { d: 0.62, w: 62 }, { d: 1.24, w: 72 }];
  var rows = specs.map(function (ch, i) {
    var fly = MOTION.draw({ from: 0, to: 1, start: 1.0 + ch.d, end: 2.5 + ch.d })(t);
    return {
      w: ch.w, fly: fly,
      x: lerp(fly, mouth.x, sx - 4), y: lerp(fly, mouth.y - i * 3, sy - 20 + i * 21) - arch(fly) * 40,
      rot: lerp(fly, -4 + i * 3, 0),
      o: MOTION.enter({ from: 0, to: 1, start: 0.8 + ch.d, end: 1.15 + ch.d })(t)
    };
  });
  var hash = MOTION.pop({ from: 0, to: 1, start: 3.5, end: 4.2 })(t);

  if (layer === 'figures') return (
    <Buyer P={P} x={3272} facing={1} dy={bob(T, 0.5, 2)}
      hx={3316} hy={392} sag={18} />
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <g opacity={plate}>
        <rect x={sx - 104} y={sy - 44} width={208} height={126} rx={7} fill={P.paper} stroke={P.paperEdge} strokeWidth={2.5} />
        <rect x={sx - 86} y={sy - 30} width={54} height={6} rx={3} fill={P.fig} opacity={0.3} />
      </g>
      {rows.map(function (r, k) {
        return <Chip key={k} P={P} x={r.x} y={r.y} w={r.w} rot={r.rot} opacity={r.o} />;
      })}
      <g transform={'translate(' + (sx + 66) + ' ' + (sy + 58) + ') scale(' + hash + ')'} opacity={clamp(hash, 0, 1)}>
        <circle cx={0} cy={0} r={15} fill="none" stroke={P.accent} strokeWidth={4} />
        <path d="M -6 -5 L 6 -5 M -6 4 L 6 4 M -2 -9 L -3.5 8 M 3 -9 L 1.5 8" stroke={P.accent} strokeWidth={2.6} strokeLinecap="round" fill="none" />
      </g>
    </g>
  );
}

// ---- scene 6: the agent buys the checks (station centre 4360) ---------------
function SceneVerify(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var ax = 4198, cardY = 318;
  var cards = [4326, 4438, 4550];
  var hand = { x: ax + 54, y: 352 };
  var pay = cards.map(function (cx, i) {
    var go = MOTION.draw({ from: 0, to: 1, start: 0.65 + i * 1.15, end: 1.55 + i * 1.15 })(t);
    return {
      x: lerp(go, hand.x, cx), y: lerp(go, hand.y, cardY + 34) - arch(go) * 46,
      o: clamp(MOTION.enter({ from: 0, to: 1, start: 0.5 + i * 1.15, end: 0.8 + i * 1.15 })(t) - clamp((go - 0.86) / 0.14, 0, 1), 0, 1),
      done: MOTION.pop({ from: 0, to: 1, start: 1.5 + i * 1.15, end: 2.1 + i * 1.15 })(t),
      shown: MOTION.enter({ from: 0, to: 1, start: 0.2 + i * 0.3, end: 0.9 + i * 0.3 })(t)
    };
  });
  var pulse = 0.5 + Math.abs(Math.sin(T * 2.6)) * 0.5;

  if (layer === 'figures') return (
    <g>
      <SpecAgent P={P} x={ax} y={GROUND + bob(T, 3.2, 1.6, 1.4)} pulse={pulse} />
      <Arm sx={ax + 22} sy={GROUND - 128} hx={hand.x} hy={hand.y} color={P.fig} w={14} sag={10} />
    </g>
  );
  if (layer !== 'front') return null;
  return (
    <g>
      {cards.map(function (cx, k) {
        return (
          <g key={k}>
            <CheckCard P={P} x={cx} y={cardY + bob(T, k * 1.4, 2.5)} done={pay[k].done}
              s={MOTION.pop({ from: 0.8, to: 1, start: 0.2 + k * 0.3, end: 0.95 + k * 0.3 })(t)}
              opacity={pay[k].shown} />
            <Coin P={P} x={pay[k].x} y={pay[k].y} s={0.72} opacity={pay[k].o} />
          </g>
        );
      })}
    </g>
  );
}

// ---- scene 7: the price is read, not guessed (station centre 5260) ---------
function ScenePrice(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var base = TABLE_Y - 24, x0 = 5106, gap = 42;
  var hs = [58, 92, 36, 24, 32, 66];
  var cx = 5260;
  var ruleW = MOTION.draw({ from: 0, to: 1, start: 2.5, end: 3.4 })(t);
  var totalS = MOTION.pop({ from: 0, to: 1, start: 3.3, end: 4.1 })(t);
  var dim = 1 - clamp((totalS - 0.4) / 0.6, 0, 1) * 0.45;

  if (layer === 'figures') return (
    <Printer P={P} x={5036} facing={1} dy={bob(T, 1.3, 2)} rollSide="right"
      hx={5082} hy={396} sag={18} />
  );
  if (layer !== 'front') return null;
  return (
    <g>
      {hs.map(function (h, k) {
        var grow = MOTION.enter({ from: 0, to: 1, start: 0.3 + k * 0.26, end: 1.1 + k * 0.26 })(t);
        var hh = h * grow;
        return (
          <rect key={k} x={x0 + k * gap - 14} y={base - hh} width={28} height={hh} rx={5}
            fill={k === 5 ? P.green : P.accent} opacity={(k === 4 ? 0.5 : 0.8) * dim} />
        );
      })}
      <path d={'M ' + (x0 - 30) + ' ' + (base + 12) + ' L ' + lerp(ruleW, x0 - 30, x0 + 5 * gap + 30) + ' ' + (base + 12)}
        stroke={P.fig} strokeWidth={2.5} strokeLinecap="round" opacity={0.3} />
      <g opacity={clamp(totalS, 0, 1)}>
        <path d={'M ' + (x0 + 5 * gap + 26) + ' ' + (base - 46) + ' L ' + (x0 + 5 * gap + 66) + ' ' + (base - 46)}
          stroke={P.fig} strokeWidth={2} opacity={0.22} />
        <g transform={'translate(' + (x0 + 5 * gap + 132) + ' ' + (base - 46 + bob(T, 1.2, 2)) + ') scale(' + totalS * 1.4 + ')'}>
          <rect x={-40} y={-28} width={80} height={56} rx={9} fill={P.fig} />
          <rect x={-26} y={-15} width={38} height={11} rx={4} fill={P.bg} opacity={0.92} />
          <rect x={-26} y={3} width={26} height={9} rx={4} fill={P.bg} opacity={0.6} />
          <circle cx={26} cy={13} r={7} fill={P.green} />
        </g>
      </g>
    </g>
  );
}

// ---- scene 8: bargaining inside signed limits (station centre 6160) --------
function SceneDeal(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var lo = 6086, hi = 6244, mid = 6165, y = 358;
  var env = MOTION.enter({ from: 0, to: 1, start: 0.25, end: 1.1 })(t);
  var hop = function (start) { return MOTION.draw({ from: 0, to: 1, start: start, end: start + 0.62 })(t); };
  var bStep = hop(1.2) + hop(2.35), aStep = hop(1.75) + hop(2.9);
  var bx = lerp(clamp(bStep / 2, 0, 1), 5992, mid - 26);
  var ax = lerp(clamp(aStep / 2, 0, 1), 6338, mid + 26);
  var bxc = Math.max(bx, lo + 22), axc = Math.min(ax, hi - 22);
  var sealS = MOTION.pop({ from: 0, to: 1, start: 4.1, end: 4.9 })(t);
  var push = arch((t - 3.5) / 0.5);
  var pulse = 0.5 + Math.abs(Math.sin(T * 2.6)) * 0.5;

  if (layer === 'figures') return (
    <g>
      <Buyer P={P} x={5904} facing={1} dy={bob(T, 0.8, 2)} hx={bxc - 30} hy={y + 34} sag={18} />
      <SpecAgent P={P} x={6420} y={GROUND + bob(T, 2.6, 1.6, 1.4)} pulse={pulse} />
      <Arm sx={6398} sy={GROUND - 128} hx={axc + 30} hy={y + 34} color={P.fig} w={14} sag={12} />
    </g>
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <g opacity={env * 0.75}>
        <path d={'M ' + lo + ' ' + (y - 62) + ' L ' + lo + ' ' + (y + 62)} stroke={P.accent} strokeWidth={3.5} strokeLinecap="round" />
        <path d={'M ' + hi + ' ' + (y - 62) + ' L ' + hi + ' ' + (y + 62)} stroke={P.accent} strokeWidth={3.5} strokeLinecap="round" />
        <path d={'M ' + lo + ' ' + (y - 62) + ' L ' + (lo + 20) + ' ' + (y - 62) + ' M ' + lo + ' ' + (y + 62) + ' L ' + (lo + 20) + ' ' + (y + 62)} stroke={P.accent} strokeWidth={3.5} strokeLinecap="round" />
        <path d={'M ' + hi + ' ' + (y - 62) + ' L ' + (hi - 20) + ' ' + (y - 62) + ' M ' + hi + ' ' + (y + 62) + ' L ' + (hi - 20) + ' ' + (y + 62)} stroke={P.accent} strokeWidth={3.5} strokeLinecap="round" />
        <rect x={lo + 4} y={y - 58} width={hi - lo - 8} height={116} rx={8} fill={P.accent} opacity={0.06} />
      </g>
      <NumberCard P={P} x={bxc - push * 5} y={y + bob(T, 0.6, 2)} rot={-4} s={0.8}
        opacity={MOTION.enter({ from: 0, to: 1, start: 0.7, end: 1.2 })(t) * (1 - clamp(sealS, 0, 1))} />
      <NumberCard P={P} x={axc + push * 5} y={y + bob(T, 2.4, 2)} rot={4} s={0.8}
        opacity={MOTION.enter({ from: 0, to: 1, start: 1.25, end: 1.75 })(t) * (1 - clamp(sealS, 0, 1))} />
      <g transform={'translate(' + mid + ' ' + y + ') scale(' + sealS + ')'} opacity={clamp(sealS, 0, 1)}>
        <circle cx={0} cy={0} r={21} fill="none" stroke={P.green} strokeWidth={5} />
        <circle cx={0} cy={0} r={7} fill={P.green} />
      </g>
    </g>
  );
}

// ---- scene 9: deposit and spec lock, the press starts (centre 7060) --------
function SceneLock(props) {
  var P = props.P, T = props.T, c = props.c, layer = props.layer;
  var t = T - c.start;
  var cx = 7060, y = 352;
  var join = MOTION.draw({ from: 0, to: 1, start: 0.9, end: 2.4 })(t);
  var sheetX = lerp(join, 6968, cx - 4), coinX = lerp(join, 7212, cx + 6);
  var sealS = MOTION.pop({ from: 0, to: 1.55, start: 2.3, end: 3.15 })(t);
  var fade = 1 - clamp((join - 0.72) / 0.28, 0, 1);
  var roll = MOTION.draw({ from: 0, to: 1, start: 3.4, end: 5.2 })(t);
  var stripEnd = lerp(roll, cx + 46, cx + 244);
  var labels = [];
  for (var i = 0; i < 7; i++) {
    var lx = cx + 70 + i * 28;
    if (lx < stripEnd - 12) labels.push({ x: lx, o: clamp((stripEnd - 12 - lx) / 24, 0, 1) });
  }
  var pulse = 0.5 + Math.abs(Math.sin(T * 2.6)) * 0.5;

  if (layer === 'figures') return (
    <SpecAgent P={P} x={6796} y={GROUND + bob(T, 1.4, 1.6, 1.4)} pulse={pulse} />
  );
  if (layer === 'back') return (
    <g opacity={MOTION.enter({ from: 0, to: 1, start: 3.35, end: 3.9 })(t)}>
      <rect x={cx + 46} y={y + 16} width={Math.max(0, stripEnd - cx - 46)} height={40} rx={5}
        fill={P.paper} stroke={P.paperEdge} strokeWidth={2.5} />
      {labels.map(function (l, k) {
        return <rect key={k} x={l.x} y={y + 26} width={18} height={20} rx={3} fill={P.accent} opacity={l.o * 0.75} />;
      })}
    </g>
  );
  if (layer !== 'front') return null;
  return (
    <g>
      <Sheet P={P} x={sheetX} y={y + bob(T, 0.7, 2) * fade} rot={-3 + join * 3} opacity={fade}
        stamp={MOTION.pop({ from: 0.4, to: 1, start: 0.15, end: 0.85 })(t)} />
      <Coin P={P} x={coinX} y={y + bob(T, 2.1, 2.4) * fade} s={0.95} opacity={fade} />
      <HashSeal P={P} x={cx} y={y} s={sealS} opacity={clamp(sealS, 0, 1)} />
    </g>
  );
}

// ---- the piece --------------------------------------------------------------
function Piece(props) {
  var comp = useComposition();
  var T = comp.T, CUES = comp.CUES, total = comp.authoredTotal;
  var P = palette(props.dark);
  var starts = NAMES.map(function (n, i) { return i === 0 ? 0 : CUES[n]; });
  var secs = starts.map(function (st, i) {
    return { start: st, dur: (i + 1 < starts.length ? starts[i + 1] : total) - st };
  });
  var B = starts.slice(1), camX = 0;
  for (var i = 0; i < B.length; i++) camX += MOTION.draw({ from: 0, to: STEP, start: B[i] - 0.5, end: B[i] + 1.0 })(T);
  camX += Math.sin(T * 0.33) * 7;
  var s = 1.94 - 0.06 * clamp(T / total, 0, 1) + Math.sin(T * 0.21 + 1) * 0.008;
  var camY = 60 + Math.sin(T * 0.27) * 4;
  var world = 'translate(660 330) scale(' + s + ') translate(' + (-660 - camX) + ' ' + (-330 - camY) + ')';
  var scenes = [SceneNegotiate, SceneChange, SceneRecord, SceneAgents, SceneAsk, SceneVerify, ScenePrice, SceneDeal, SceneLock];
  var layer = function (name) {
    return scenes.map(function (S, k) {
      return (
        <g key={k} transform={'translate(' + (SHIFT * k + STATION_FIX[k]) + ' 0)'}>
          <S P={P} T={T} c={secs[k]} layer={name} />
        </g>
      );
    });
  };

  return (
    <div style={{ position: 'absolute', inset: 0, background: P.bg }}>
      <svg width="100%" height="100%" viewBox={'0 0 ' + W + ' ' + H} style={{ display: 'block' }}>
        <g transform={world}>
          {layer('back')}
          {layer('figures')}
          <Table P={P} />
          {layer('front')}
        </g>
      </svg>
      {props.showCaptions && <ExampleStrip T={T} secs={secs} P={P} />}
      {props.showCaptions && (
        <Captions
          items={CAPTIONS.map(function (text, i) {
            return {
              at: secs[i].start + 0.6,
              until: i === CAPTIONS.length - 1 ? undefined : secs[i].start + secs[i].dur - 0.25,
              text: text,
            };
          })}
          style={{
            bottom: '4.5%', font: '500 33px "Helvetica Neue", Helvetica, Arial, sans-serif',
            letterSpacing: '-0.015em', color: P.fig, textShadow: 'none',
          }}
        />
      )}
    </div>
  );
}

function ExampleStrip(props) {
  var T = props.T, secs = props.secs, P = props.P;
  var idx = 0, i;
  for (i = 0; i < secs.length; i++) if (T >= secs[i].start) idx = i;
  var st = secs[idx].start, en = st + secs[idx].dur;
  var fadeIn = clamp((T - st - 0.3) / 0.55, 0, 1);
  var fadeOut = idx === secs.length - 1 ? 1 : clamp((en - 0.3 - T) / 0.55, 0, 1);
  var ex = EXAMPLES[idx];
  return (
    <div style={{
      position: 'absolute', top: '4.5%', left: '50%', transform: 'translateX(-50%)',
      width: '78%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px',
      opacity: fadeIn * fadeOut, pointerEvents: 'none', textAlign: 'center',
    }}>
      <span style={{
        padding: '7px 14px', borderRadius: '7px',
        background: P.accent, color: P.bg,
        font: '500 15px ui-monospace, Menlo, Consolas, monospace', letterSpacing: '0.18em',
      }}>{ex.tag}</span>
      <span style={{
        font: '400 30px "Helvetica Neue", Helvetica, Arial, sans-serif',
        lineHeight: 1.38, letterSpacing: '-0.016em', color: P.fig, opacity: 0.9,
        maxWidth: '900px', textWrap: 'balance',
      }}>{ex.text}</span>
    </div>
  );
}

export function SpecLockIntroEmbed(props) {
  return (
    <CompositionStage width={W} height={H} scenes={OM_SCENES} persist={false}
      playback={'{"mode":"times","count":1}'} bg={palette(props.dark).bg}>
      <Piece dark={props.dark} showCaptions={props.showCaptions !== false} />
    </CompositionStage>
  );
}
