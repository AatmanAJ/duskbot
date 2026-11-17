import { useEffect } from "react";
import { shownChatIsUnread } from "@/lib/shown-chat-unread";
import { useStoreRef } from "@/state/store-ref";

/** Replies that reached the shown chat while the window was in the background stay unread; once the window has focus
 * again, that chat is read through `select`, which also puts the "New" divider above them. */
export function useReadShownChatOnFocus(): void {
  const store = useStoreRef();
  useEffect(() => {
    const readShownChat = () => {
      const state = store.state();
      if (state.selectedId && shownChatIsUnread(state)) store.dispatch({ type: "select", id: state.selectedId });
    };
    window.addEventListener("focus", readShownChat);
    return () => window.removeEventListener("focus", readShownChat);
  }, [store]);
}
