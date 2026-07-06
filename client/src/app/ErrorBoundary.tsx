import React from "react";

/**
 * Surfaces a render error to the DOM (id="err") instead of a blank canvas — handy
 * for diagnosing the 3D scene when a screenshot isn't available.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <pre
          id="err"
          style={{ color: "#ff6b6b", padding: 24, whiteSpace: "pre-wrap", fontSize: 13 }}
        >
          {String(this.state.error?.message)}
          {"\n\n"}
          {String(this.state.error?.stack).slice(0, 800)}
        </pre>
      );
    }
    return this.props.children;
  }
}
