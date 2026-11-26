import { use, useState } from "react";
import { t } from "@/lib/i18n";
import { statusActivity } from "@/lib/activity-runs";
import type { Message } from "@/state/store";
import { bugReportFixedText } from "./BugReportNote";
import { CancelledTurnRow } from "./CancelledTurnRow";
import { FoldedNoticesContext } from "./FailedReplyCard";
import { ConnectAiDialog } from "./onboarding/connect-ai-dialog";
import { NOTE_ACTION, TranscriptNote } from "./TranscriptNote";

// a notice is said in the card above the composer while it is the newest thing; once something follows, an older one
// stays as one quiet line in the chat, never a box. A first reply's wait is the working line's, and a first reply that
// never came is the card's.
export function StatusActivityRow({ message }: { message: Message }) {
  const folded = use(FoldedNoticesContext);
  const [connecting, setConnecting] = useState(false);
  const status = statusActivity(message);
  if (!status) return null;
  if (status.kind === "stopped") return <CancelledTurnRow name={message.tool?.name} />;
  if (message.tool?.rescue) return null;
  if (folded.has(message.id)) return null;
  // a sign-out something has since followed: the AI's own status says the rest
  if (status.kind === "notice" && message.tool?.setup === true) return null;
  const signIn = status.kind === "notice" && message.tool?.signIn === true;
  return <>
    <TranscriptNote text={(message.bugReport && bugReportFixedText(message.bugReport)) ?? status.text}
      actions={signIn && <button type="button" onClick={() => setConnecting(true)} className={NOTE_ACTION}>{t("chat.notice.signIn")}</button>} />
    {connecting && <ConnectAiDialog tested={null} onClose={() => setConnecting(false)} />}
  </>;
}
