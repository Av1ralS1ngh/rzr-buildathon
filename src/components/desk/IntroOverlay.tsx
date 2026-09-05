"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SpecLockIntroEmbed } from "@/components/intro/speclock-intro";

const PHASES = [6600, 58600, 13400, 4200];

const STAMPS = [
  {
    label: "NEGOTIATES",
    what: "Trades offers inside limits you signed.",
    eg: "your list ₹60 · your floor ₹35 · settled at ₹54.00 a label",
    rot: "-1.6deg",
    fg: "var(--press)",
    bg: "var(--press-wash)",
    delay: 260,
  },
  {
    label: "ABSORBS CHANGE",
    what: "Reprices a change without restarting the order.",
    eg: "10,000 → 12,000 after approval · you pay the ₹300.42 difference",
    rot: "1.4deg",
    fg: "var(--press)",
    bg: "var(--press-wash)",
    delay: 2560,
  },
  {
    label: "REMEMBERS",
    what: "Writes down every offer, check and change.",
    eg: "9 events · each timestamped · nothing overwritten",
    rot: "1.1deg",
    fg: "var(--seal)",
    bg: "var(--seal-wash)",
    delay: 4860,
  },
  {
    label: "SETTLES IN ₹",
    what: "Takes the deposit in rupees, tied to this spec.",
    eg: "₹2,911.16 captured · bound to spec 4e9b2c07…a18f",
    rot: "-1.3deg",
    fg: "var(--seal)",
    bg: "var(--seal-wash)",
    delay: 7160,
  },
];

function words(line: string, start: number, accent?: string) {
  return line.split(" ").map((w, i) => ({
    w,
    delay: start + i * 105,
    fg: w === accent ? "var(--press)" : "var(--ink)",
  }));
}

function kicker(scene: number, half: boolean) {
  if (scene === 1) return half ? "HOW SPECLOCK DOES IT" : "WHAT A DEAL ACTUALLY TAKES";
  return ["INTRODUCTION", "", "WHY SPECLOCK", "SPECLOCK"][scene] ?? "SPECLOCK";
}

function driveFilm(time: number, playing: boolean) {
  const root = document.querySelector("[data-om-exportable-video-with-duration-secs]");
  if (!root) return;
  root.dispatchEvent(
    new CustomEvent("data-om-seek-to-time-frame", {
      detail: { time, playing },
      bubbles: true,
    })
  );
}

export function IntroOverlay({
  dark,
  onDone,
}: {
  dark: boolean;
  onDone: () => void;
}) {
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [half, setHalf] = useState(false);
  const [fading, setFading] = useState(false);
  const elapsed = useRef(0);
  const last = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const sceneRef = useRef(0);
  const playingRef = useRef(true);
  const fadingRef = useRef(false);

  sceneRef.current = scene;
  playingRef.current = playing;
  fadingRef.current = fading;

  const stopClock = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    last.current = null;
  }, []);

  const endIntro = useCallback(() => {
    stopClock();
    setFading(true);
    fadingRef.current = true;
    window.setTimeout(onDone, 520);
  }, [onDone, stopClock]);

  const goScene = useCallback(
    (i: number) => {
      stopClock();
      if (i >= PHASES.length) {
        endIntro();
        return;
      }
      elapsed.current = 0;
      setHalf(false);
      setScene(i);
      sceneRef.current = i;
      setPlaying(true);
      playingRef.current = true;
      if (i === 1) driveFilm(0, true);
    },
    [endIntro, stopClock]
  );

  const startClock = useCallback(() => {
    last.current = null;
    const tick = (now: number) => {
      if (fadingRef.current || !playingRef.current) {
        raf.current = null;
        return;
      }
      if (last.current == null) last.current = now;
      elapsed.current += Math.min(120, now - last.current);
      last.current = now;
      const phase = PHASES[sceneRef.current];
      if (sceneRef.current === 1) {
        driveFilm(elapsed.current / 1000, true);
        const nextHalf = elapsed.current >= 26000;
        setHalf((prev) => (prev === nextHalf ? prev : nextHalf));
      }
      if (elapsed.current >= phase) {
        goScene(sceneRef.current + 1);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [goScene]);

  useEffect(() => {
    startClock();
    return stopClock;
  }, [scene, playing, startClock, stopClock]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (playingRef.current) {
        stopClock();
        setPlaying(false);
        playingRef.current = false;
        if (sceneRef.current === 1) driveFilm(elapsed.current / 1000, false);
      } else {
        setPlaying(true);
        playingRef.current = true;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [stopClock]);

  const hello1 = words("Hi I am Aviral, an undergrad from IIT Roorkee.", 260);
  const hello2 = words("This project's called SpecLock", 1370, "SpecLock");

  return (
    <div
      data-intro-paused={playing ? "0" : "1"}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "var(--stock)",
        display: "flex",
        flexDirection: "column",
        animation: fading ? "introOut 500ms var(--ease) both" : "none",
      }}
    >
      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <RegMark size={15} />
          <span
            style={{
              fontFamily: "var(--font-code)",
              fontSize: 10,
              letterSpacing: "0.16em",
              color: "var(--ink-3)",
            }}
          >
            {kicker(scene, half)}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="sl-btn sl-btn-chip"
            onClick={(e) => {
              e.stopPropagation();
              if (playing) {
                stopClock();
                setPlaying(false);
                if (scene === 1) driveFilm(elapsed.current / 1000, false);
              } else {
                setPlaying(true);
              }
            }}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 13px" }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                background: playing ? "var(--press)" : "var(--flag)",
              }}
            />
            {playing ? "PAUSE" : "PLAY"}
          </button>
          <button
            type="button"
            className="sl-btn sl-btn-chip"
            onClick={(e) => {
              e.stopPropagation();
              endIntro();
            }}
            style={{ padding: "8px 13px" }}
          >
            SKIP
          </button>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 32px",
          overflow: "hidden",
        }}
      >
        {scene === 0 && (
          <button
            type="button"
            onClick={() => goScene(1)}
            style={{
              width: "min(820px, 84vw)",
              background: "none",
              border: 0,
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: "clamp(26px, 4.6vh, 40px)",
                fontWeight: 500,
                letterSpacing: "-0.032em",
                lineHeight: 1.32,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
                {hello1.map((w) => (
                  <span
                    key={`l1-${w.w}-${w.delay}`}
                    style={{
                      color: w.fg,
                      animation: `wordIn 420ms var(--ease) ${w.delay}ms both`,
                    }}
                  >
                    {w.w}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0 12px" }}>
                {hello2.map((w) => (
                  <span
                    key={`l2-${w.w}-${w.delay}`}
                    style={{
                      color: w.fg,
                      animation: `wordIn 420ms var(--ease) ${w.delay}ms both`,
                    }}
                  >
                    {w.w}
                  </span>
                ))}
              </div>
            </div>
            <div
              style={{
                height: 1,
                background: "var(--rule-strong)",
                marginTop: 26,
                transformOrigin: "left",
                animation: "ruleSweep 520ms var(--ease) 2150ms both",
              }}
            />
            <div
              style={{
                fontFamily: "var(--font-code)",
                fontSize: 11,
                letterSpacing: "0.16em",
                color: "var(--ink-3)",
                marginTop: 14,
                animation: "capIn 420ms var(--ease) 2450ms both",
              }}
            >
              AGENTIC CHECKOUT FOR CUSTOM MANUFACTURING
            </div>
          </button>
        )}

        {scene === 1 && (
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 1320,
              aspectRatio: "2 / 1",
              maxHeight: "100%",
              overflow: "hidden",
              borderRadius: 14,
            }}
          >
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "calc(100% + 48px)" }}>
              <div style={{ position: "absolute", inset: 0 }}>
                <SpecLockIntroEmbed dark={dark} />
              </div>
            </div>
          </div>
        )}

        {scene === 2 && (
          <button
            type="button"
            onClick={() => goScene(3)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "min(22px, 2.6vh)",
              cursor: "pointer",
              animation: "sceneIn 460ms var(--ease) both",
              background: "none",
              border: 0,
              color: "inherit",
              padding: 0,
            }}
          >
            <div
              style={{
                width: "min(780px, 84vw)",
                padding: "min(34px, 3.6vh) min(38px, 4vw) min(36px, 3.8vh)",
                background: "var(--plate)",
                border: "1px solid var(--plate-edge)",
                borderRadius: 6,
                boxShadow: "var(--lift)",
                textAlign: "left",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-code)",
                      fontSize: 10,
                      letterSpacing: "0.16em",
                      color: "var(--plate-ink)",
                    }}
                  >
                    SPEC PLATE · SEALED
                  </div>
                  <div
                    style={{
                      fontSize: "clamp(20px, 3vh, 26px)",
                      fontWeight: 600,
                      letterSpacing: "-0.03em",
                      marginTop: 8,
                    }}
                  >
                    Four stamps a human deal earns.
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-code)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    color: "var(--plate-ink)",
                    textAlign: "right",
                    whiteSpace: "nowrap",
                  }}
                >
                  SPECLOCK
                  <br />
                  EARNS ALL FOUR
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: "min(24px, 3vh)" }}>
                {STAMPS.map((s) => (
                  <div
                    key={s.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "178px 38px minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "center",
                      paddingTop: 12,
                      borderTop: "1px solid var(--plate-edge)",
                      animation: `settleIn 400ms var(--ease) ${s.delay}ms both`,
                    }}
                  >
                    <div
                      style={{
                        ["--rot" as string]: s.rot,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "9px 10px",
                        border: `1.5px solid ${s.fg}`,
                        borderRadius: 7,
                        color: s.fg,
                        background: s.bg,
                        fontFamily: "var(--font-code)",
                        fontSize: 12.5,
                        fontWeight: 500,
                        letterSpacing: "0.1em",
                        textAlign: "center",
                        animation: `stampHit 320ms var(--ease) ${s.delay}ms both`,
                      }}
                    >
                      {s.label}
                    </div>
                    <svg viewBox="0 0 38 12" style={{ width: 38, height: 12, overflow: "visible" }}>
                      <path d="M36 6 H4" stroke={s.fg} strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
                      <path
                        d="M9 2 L3 6 L9 10"
                        fill="none"
                        stroke={s.fg}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", textWrap: "pretty" }}>
                        {s.what}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-code)",
                          fontSize: 12,
                          color: "var(--ink-2)",
                          marginTop: 4,
                          textWrap: "pretty",
                        }}
                      >
                        {s.eg}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div
              style={{
                textAlign: "center",
                maxWidth: 640,
                fontSize: 14.5,
                lineHeight: 1.5,
                color: "var(--ink-2)",
                textWrap: "pretty",
              }}
            >
              One agent that bargains, absorbs a change, keeps the record, and settles the deposit in rupees.
            </div>
          </button>
        )}

        {scene === 3 && (
          <div
            style={{
              position: "relative",
              width: 560,
              height: 260,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              maxWidth: "92vw",
            }}
          >
            <svg
              viewBox="0 0 560 260"
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
            >
              <g stroke="var(--ink-4)" strokeWidth="1" fill="none" strokeDasharray="34">
                <path d="M14 40 h26 M27 27 v26" style={{ animation: "regDraw 380ms var(--ease) 40ms both" }} />
                <path d="M520 40 h26 M533 27 v26" style={{ animation: "regDraw 380ms var(--ease) 100ms both" }} />
                <path d="M14 220 h26 M27 207 v26" style={{ animation: "regDraw 380ms var(--ease) 160ms both" }} />
                <path d="M520 220 h26 M533 207 v26" style={{ animation: "regDraw 380ms var(--ease) 220ms both" }} />
              </g>
            </svg>
            <div
              style={{
                position: "relative",
                width: 372,
                height: 116,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                viewBox="0 0 372 116"
                style={{ position: "absolute", inset: 0, width: 372, height: 116, pointerEvents: "none" }}
              >
                <rect
                  x="1"
                  y="1"
                  width="370"
                  height="114"
                  rx="57"
                  fill="none"
                  stroke="var(--seal)"
                  strokeWidth="1.25"
                  pathLength="1"
                  strokeDasharray="1"
                  style={{ strokeDashoffset: 1, animation: "sealDraw 560ms var(--ease) 700ms forwards" }}
                />
              </svg>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "baseline",
                  fontSize: 52,
                  fontWeight: 700,
                  letterSpacing: "-0.045em",
                }}
              >
                <span style={{ animation: "specIn 620ms var(--ease) 120ms both" }}>SPEC</span>
                <span style={{ color: "var(--press)", animation: "lockIn 620ms var(--ease) 120ms both" }}>LOCK</span>
              </div>
            </div>
            <div
              style={{
                width: 232,
                height: 1,
                background: "var(--rule-strong)",
                marginTop: 22,
                transformOrigin: "center",
                animation: "ruleSweep 420ms var(--ease) 740ms both",
              }}
            />
            <div
              style={{
                marginTop: 16,
                fontFamily: "var(--font-code)",
                fontSize: 11,
                letterSpacing: "0.16em",
                color: "var(--ink-3)",
                animation: "capIn 420ms var(--ease) 1020ms both",
              }}
            >
              SPEC ⨝ PAYMENT · ONE HASH
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 7, padding: "0 28px 26px" }}>
        {PHASES.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-label={`Intro phase ${i + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              goScene(i);
            }}
            style={{
              flex: d,
              height: 2,
              borderRadius: 2,
              cursor: "pointer",
              border: 0,
              padding: 0,
              background: i === scene ? "var(--press)" : i < scene ? "var(--rule-strong)" : "var(--rule)",
              transition: "background 300ms linear",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function RegMark({ size = 17 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" style={{ width: size, height: size, flex: `0 0 ${size}px` }}>
      <g stroke="var(--press)" strokeWidth="1.4" fill="none">
        <path d="M10 1.5 v17 M1.5 10 h17" />
        <circle cx="10" cy="10" r="4.6" />
      </g>
    </svg>
  );
}
