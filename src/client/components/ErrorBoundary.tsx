import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";

// One bad row should break one page, not the app.
//
// There was no boundary anywhere, so a RangeError thrown while formatting a
// corrupt date unmounted the entire React tree and left a white screen with no
// way back and nothing on it to explain itself. That is the part worth fixing
// permanently: the corrupt data was a bug and got fixed, but "a render throws"
// will happen again for some other reason, and the app should still be usable
// when it does.
//
// Placed around the routed page, so the sidebar and navigation survive: whatever
// broke, you can still walk to another view, which is the difference between a
// glitch and a dead app.
export class ErrorBoundary extends Component<
  { children: ReactNode; onReset?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept in the console rather than sent anywhere: single-user app, no error
    // service, and the stack is what makes the next one diagnosable.
    console.error("Page crashed:", error, info.componentStack);
  }

  // A new route is a new attempt: without this, one crash would leave every
  // page you navigate to showing the same dead panel.
  reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full flex-col items-start gap-3 p-8">
        <h2 className="text-lg font-semibold text-foreground">
          This page hit an error
        </h2>
        <p className="max-w-prose text-sm text-muted">
          The rest of the app still works, so you can move to another view from
          the sidebar. The details are in the browser console.
        </p>
        <pre className="max-w-full overflow-x-auto rounded-md bg-surface-2 px-3 py-2 text-xs text-subtle">
          {this.state.error.message}
        </pre>
        <Button onClick={this.reset}>Try again</Button>
      </div>
    );
  }
}
