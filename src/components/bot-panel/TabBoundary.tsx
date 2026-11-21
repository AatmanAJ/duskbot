import { Component, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import { smallButtonCls } from "../ui/GrokDialog";

/** One tab that fails to draw (its screen's code did not load, a bad answer) says so in place, with a way to try again;
 * the panel and the window around it stay. */
export class TabBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null; attempt: number }> {
  state: { error: Error | null; attempt: number } = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return <TabAttempt key={this.state.attempt}>{this.props.children}</TabAttempt>;
    return (
      <div role="alert" data-panel-tab-failed="" className="flex min-h-7 items-center gap-2 px-1 pt-1">
        <span className="min-w-0 flex-1 text-[12px] leading-4 text-ink/[0.68]">{t("computer.problem.failed", { name: this.props.name })}</span>
        <button type="button" data-panel-action="retry-tab" className={smallButtonCls}
          onClick={() => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }))}>
          {t("botPanel.ui.commonTryAgain")}
        </button>
      </div>
    );
  }
}

function TabAttempt({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
