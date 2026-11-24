import { useEffect, useState } from "react";

import { fetchMemoryDoc, fetchMemoryNotes, MEMORY_INDEX, type MemoryDoc } from "@/lib/memory";
import { useStore, type Bot } from "@/state/store";
import { isArchiveTopic } from "../../../shared/memory-topics";

export interface MemoryNotesState {
  /** MEMORY.md first, then the topic files (never the archive). Null until read. */
  docs: MemoryDoc[] | null;
  error: boolean;
  /** On a Team Cloud the notes are the signed-in person's own layer. */
  mine: boolean;
  setDoc: (doc: MemoryDoc) => void;
  reload: () => Promise<void>;
}

async function readDocs(botId: string, mine: boolean): Promise<MemoryDoc[]> {
  const overview = await fetchMemoryNotes(botId, mine);
  if (overview.notes) return overview.notes;
  const topics = (overview.topics ?? []).filter((topic) => !isArchiveTopic(topic.path.slice("memory/".length)));
  return Promise.all([MEMORY_INDEX, ...topics.map((topic) => topic.path)].map((path) => fetchMemoryDoc(botId, path, mine)));
}

/** The notes the bot panel shows for a bot whose memory is on. They are read again as a turn starts and ends, so a note
 * the bot just saved shows. */
export function useMemoryDoc(bot: Pick<Bot, "id" | "memoryEnabled" | "busy">): MemoryNotesState {
  const mine = Boolean(useStore().state.config?.team);
  const [state, setState] = useState<{ botId: string; docs: MemoryDoc[] | null; error: boolean }>({ botId: bot.id, docs: null, error: false });
  const memoryOn = bot.memoryEnabled !== false;

  const read = async (botId: string, cancelled?: () => boolean) => {
    try {
      const docs = await readDocs(botId, mine);
      if (!cancelled?.()) setState({ botId, docs, error: false });
    } catch {
      if (!cancelled?.()) setState({ botId, docs: null, error: true });
    }
  };

  const busy = Boolean(bot.busy);
  useEffect(() => {
    if (!memoryOn) return;
    let cancelled = false;
    void read(bot.id, () => cancelled);
    return () => { cancelled = true; };
  }, [bot.id, memoryOn, busy, mine]);

  const own = state.botId === bot.id;
  return {
    docs: own ? state.docs : null,
    error: own && state.error,
    mine,
    setDoc: (doc) => setState((current) => ({
      botId: bot.id,
      docs: (current.botId === bot.id ? current.docs ?? [] : []).map((existing) => existing.path === doc.path ? doc : existing),
      error: false,
    })),
    reload: () => read(bot.id),
  };
}
