"use client";

import { useEffect, useState } from "react";
import { AgentMeshTab } from "./AgentMeshTab";
import { CatalogTab } from "./CatalogTab";
import { FlowTab } from "./FlowTab";
import { IntroOverlay, RegMark } from "./IntroOverlay";
import { MerchantTab } from "./MerchantTab";
import { NegotiationTab } from "./NegotiationTab";

export type DeskTab = "flow" | "catalog" | "merchant" | "negotiate" | "mesh";

const TABS: { key: DeskTab; label: string }[] = [
  { key: "flow", label: "Flow" },
  { key: "catalog", label: "Catalog" },
  { key: "merchant", label: "Merchant" },
  { key: "negotiate", label: "Negotiation" },
  { key: "mesh", label: "Agent mesh" },
];

export function DealDesk({
  initialTab = "flow",
  initialRfqId,
  skipIntro = false,
}: {
  initialTab?: DeskTab;
  initialRfqId?: string;
  skipIntro?: boolean;
}) {
  const [tab, setTab] = useState<DeskTab>(initialTab);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [intro, setIntro] = useState(!skipIntro && !initialRfqId);
  const [rfqId, setRfqId] = useState<string | undefined>(initialRfqId);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("speclock-theme");
    if (stored === "dark" || stored === "light") setTheme(stored);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || skipIntro || initialRfqId) setIntro(false);
  }, [initialRfqId, skipIntro]);

  useEffect(() => {
    window.localStorage.setItem("speclock-theme", theme);
  }, [theme]);

  function openRfq(id: string) {
    setRfqId(id);
    setTab("flow");
    history.replaceState(null, "", `/rfq/${id}`);
    scrollEl?.scrollTo({ top: 0 });
  }

  return (
    <div
      data-theme={theme}
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--stock)",
        color: "var(--ink)",
        fontFamily: "var(--font-ui)",
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      {intro && <IntroOverlay dark={theme === "dark"} onDone={() => setIntro(false)} />}

      <header
        className="sl-header"
        style={{
          flex: "0 0 auto",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
          padding: "0 28px",
          background: "var(--sheet)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, overflow: "hidden" }}>
          <RegMark size={17} />
          <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Spec<span style={{ color: "var(--press)" }}>Lock</span>
          </span>
          <span style={{ width: 1, height: 18, background: "var(--rule)" }} />
          <span
            style={{
              fontFamily: "var(--font-code)",
              fontSize: 11,
              color: "var(--ink-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            ABC LABELS · BENGALURU
          </span>
        </div>
        <div
          className="sl-header-tabs"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: 3,
            background: "var(--sunken)",
            border: "1px solid var(--rule-soft)",
            borderRadius: 9,
            flex: "0 0 auto",
          }}
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => {
                  setTab(t.key);
                  scrollEl?.scrollTo({ top: 0 });
                  if (t.key === "merchant") history.replaceState(null, "", "/merchant");
                  else if (t.key === "catalog") history.replaceState(null, "", "/catalog");
                  else if (t.key === "negotiate") history.replaceState(null, "", "/negotiation");
                  else if (t.key === "mesh") history.replaceState(null, "", "/");
                  else if (t.key === "flow" && rfqId) history.replaceState(null, "", `/rfq/${rfqId}`);
                  else history.replaceState(null, "", "/");
                }}
                style={{
                  appearance: "none",
                  border: 0,
                  fontFamily: "inherit",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--ink)" : "var(--ink-3)",
                  background: active ? "var(--sheet)" : "transparent",
                  padding: "6px 13px",
                  borderRadius: 6,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 120ms linear, color 120ms linear",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
          <button type="button" className="sl-btn sl-btn-chip" onClick={() => setIntro(true)}>
            INTRO
          </button>
          <button
            type="button"
            className="sl-btn sl-btn-chip"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            style={{ display: "flex", alignItems: "center", gap: 7 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 5,
                border: "1px solid var(--ink-3)",
                background: theme === "dark" ? "var(--ink)" : "transparent",
              }}
            />
            {theme === "dark" ? "DARK" : "LIGHT"}
          </button>
        </div>
      </header>

      <div ref={setScrollEl} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {tab === "flow" && <FlowTab initialRfqId={rfqId} scrollEl={scrollEl} />}
        {tab === "catalog" && <CatalogTab />}
        {tab === "merchant" && <MerchantTab onOpenRfq={openRfq} />}
        {tab === "negotiate" && <NegotiationTab />}
        {tab === "mesh" && <AgentMeshTab />}
      </div>
    </div>
  );
}
