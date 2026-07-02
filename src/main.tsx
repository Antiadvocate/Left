import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div className="p-6">
          <div className="font-display text-lg mb-2">The loom jammed.</div>
          <pre className="font-mono text-xs whitespace-pre-wrap" style={{ color: "var(--danger)" }}>
            {String(this.state.err)}
          </pre>
          <button className="btn mt-4" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary><App /></Boundary>
  </React.StrictMode>
);
