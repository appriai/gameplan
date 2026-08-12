import { useCallback, useEffect, useMemo, useState } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

import { dropSticky } from "./annotations";
import { INTENT_ORDER, INTENT_STYLE, docFromLocation, type Intent } from "./protocol";
import { useSync } from "./useSync";

const NAME_KEY = "gameplan.reviewer.name";

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="overlay">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          const name = value.trim();
          if (name) onSubmit(name);
        }}
      >
        <h1>Who's reviewing?</h1>
        <p>
          Your name is attached to every note you leave, so the agent knows who asked
          for what when reviewers disagree.
        </p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Sam"
          maxLength={40}
        />
        <button type="submit" disabled={value.trim() === ""}>
          Join the canvas
        </button>
      </form>
    </div>
  );
}

function Palette({
  onDrop,
  disabled,
}: {
  onDrop: (intent: Intent) => void;
  disabled: boolean;
}) {
  return (
    <div className="palette">
      {INTENT_ORDER.map((intent) => {
        const style = INTENT_STYLE[intent];
        return (
          <button
            key={intent}
            type="button"
            className="swatch"
            disabled={disabled}
            title={`${style.label} — ${style.hint}`}
            onClick={() => onDrop(intent)}
            style={{ background: style.background, borderColor: style.stroke }}
          >
            {style.label}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const doc = docFromLocation();
  const planId = doc?.id;
  const [name, setName] = useState<string | null>(() => localStorage.getItem(NAME_KEY));
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [justSent, setJustSent] = useState(false);

  const sync = useSync(api, planId ?? "", name ?? "", doc?.kind ?? "plan");

  const handleName = useCallback((value: string) => {
    localStorage.setItem(NAME_KEY, value);
    setName(value);
  }, []);

  const handleDrop = useCallback(
    (intent: Intent) => {
      if (api && name) dropSticky(api, intent, name);
    },
    [api, name],
  );

  const handleSubmit = useCallback(() => {
    sync.submit();
    setJustSent(true);
  }, [sync]);

  useEffect(() => {
    if (!justSent) return;
    const timer = window.setTimeout(() => setJustSent(false), 4000);
    return () => window.clearTimeout(timer);
  }, [justSent]);

  const initialData = useMemo(
    () => ({
      elements: [],
      appState: { viewBackgroundColor: "#ffffff" },
      scrollToContent: true,
    }),
    [],
  );

  if (!doc) {
    return (
      <div className="overlay">
        <div className="card">
          <h1>Nothing to open here</h1>
          <p>
            Open a plan at <code>/p/&lt;plan-id&gt;</code> — render one with{" "}
            <code>gameplan render &lt;spec.yaml&gt;</code> — or a diagram at{" "}
            <code>/d/&lt;diagram-id&gt;</code>, rendered with{" "}
            <code>gameplan draw &lt;diagram.yaml&gt;</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!name) return <NamePrompt onSubmit={handleName} />;

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-left">
          <span className="brand">gameplan</span>
          <span className="title">{sync.title ?? planId}</span>
          {sync.revision !== undefined && <span className="rev">rev {sync.revision}</span>}
        </div>

        <div className="bar-centre">
          <span className={`status status-${sync.status}`}>
            {sync.status === "live"
              ? "live"
              : sync.status === "reconnecting"
                ? "reconnecting…"
                : sync.status === "error"
                  ? (sync.error ?? "error")
                  : "connecting…"}
          </span>
          <div className="peers">
            {sync.me && (
              <span className="peer me" style={{ background: sync.me.color }}>
                {initials(sync.me.name)}
              </span>
            )}
            {sync.peers.map((peer) => (
              <span
                key={peer.id}
                className="peer"
                style={{ background: peer.color }}
                title={peer.name}
              >
                {initials(peer.name)}
              </span>
            ))}
          </div>
        </div>

        <div className="bar-right">
          <Palette onDrop={handleDrop} disabled={!sync.ready} />
          <button
            type="button"
            className="send"
            onClick={handleSubmit}
            disabled={!sync.ready}
          >
            {justSent ? "Sent ✓" : "Send to agent"}
          </button>
        </div>
      </header>

      {sync.lastSubmitted && (
        <div className="banner">
          Sent to the agent — {sync.lastSubmitted.summary} (by{" "}
          {sync.lastSubmitted.by.join(", ")})
        </div>
      )}

      <div className="canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={initialData}
          onChange={sync.onChange}
          onPointerUpdate={({ pointer }) => sync.onPointerUpdate(pointer)}
          isCollaborating
          UIOptions={{ canvasActions: { loadScene: false } }}
        />
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}
