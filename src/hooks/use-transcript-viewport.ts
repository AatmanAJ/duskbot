import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type PointerEvent,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { BOTTOM_FOLLOW_THRESHOLD, shouldResumeBottomFollow, useBottomFollowResize } from "@/lib/bottom-follow";
import { useFocusMessage } from "@/lib/focus-message";
import { reducedMotion } from "@/lib/onboarding";
import { useArrivalFlow } from "@/hooks/use-arrival-flow";
import { useDispatch, useStoreSelector, type AppState } from "@/state/store";
import type { TranscriptViewport } from "@/components/TranscriptRows";

const selectFocusMessage = (state: AppState) => state.focusMessage;
const NO_ROWS: readonly string[] = [];

export const AUTO_EXPAND_TOP_THRESHOLD = 250;

const WIDGETS_WITH_OWN_ARROW_KEYS = '[role="menu"], [role="menubar"], [role="listbox"], [role="tree"], [role="grid"], [role="tablist"], [role="radiogroup"], [role="slider"], select, [contenteditable="true"]';

export function useTranscriptViewport<T extends { id: string; role?: string }>({
  ownerId,
  threadId,
  messages,
  pinOn,
  transcriptShown = true,
  hasMore = false,
  keepMounted = NO_ROWS,
}: {
  ownerId: string;
  threadId: string;
  messages: readonly T[];
  pinOn: DependencyList;
  transcriptShown?: boolean;
  hasMore?: boolean;
  /** Messages whose rows stay mounted while scrolled away (a bubble being edited). */
  keepMounted?: readonly string[];
}) {
  const dispatch = useDispatch();
  const focusMessage = useStoreSelector(selectFocusMessage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // wraps the transcript column: it clips the column while arrivals move it, so the scroll range never includes them
  const clipRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  // Follow breaks only on an upward user gesture: content growth flickers "at bottom" false for a frame.
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const previousScrollTop = useRef(0);
  const touchY = useRef(0);

  const transcriptKey = `${ownerId}:${threadId}`;

  const setBottomFollow = useCallback((next: boolean) => {
    followRef.current = next;
    setFollow(next);
  }, []);
  useBottomFollowResize(scrollRef, transcriptRef, followRef, transcriptShown ? transcriptKey : null);

  useEffect(() => setBottomFollow(true), [transcriptKey, setBottomFollow]);

  const appliedFocus = useRef<number | null>(null);
  const pendingFocus = focusMessage && !focusMessage.consumed && focusMessage.threadId === threadId ? focusMessage : null;
  useEffect(() => {
    const focus = pendingFocus;
    if (!focus || appliedFocus.current === focus.nonce) return;
    if (!messages.some((message) => message.id === focus.messageId)) return;
    appliedFocus.current = focus.nonce;
    setBottomFollow(false);
  }, [messages, setBottomFollow, pendingFocus]);
  useFocusMessage(threadId, messages.length > 0);

  // Shift scrollTop by the growth after commit (scroll anchoring is off here); a switch drops the capture.
  const preExpandHeight = useRef<{ key: string; height: number } | null>(null);
  const expandingRef = useRef(false);

  const holdRowForPrepend = () => {
    preExpandHeight.current = scrollRef.current ? { key: transcriptKey, height: scrollRef.current.scrollHeight } : null;
    setBottomFollow(false);
  };
  const oldestId = messages[0]?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const captured = preExpandHeight.current;
    if (!captured || !el) {
      expandingRef.current = false;
      return;
    }
    preExpandHeight.current = null;
    if (captured.key !== transcriptKey) {
      expandingRef.current = false;
      return;
    }
    el.scrollTop += el.scrollHeight - captured.height;
    previousScrollTop.current = el.scrollTop;
    expandingRef.current = false;
  }, [oldestId, transcriptKey]);

  // `follow` is omitted on purpose: re-arming only arms future content and never scrolls. Before paint, so an opened
  // chat's first frame is already at its newest row; a switch re-arms following here rather than a frame later.
  useLayoutEffect(() => {
    // the newest row seen is recorded after paint, so here it still names the thread that was open before
    if (seenNewest.current.key !== transcriptKey) setBottomFollow(true);
    const el = scrollRef.current;
    // a search jump into this thread places the transcript itself
    if (!el || !followRef.current || (pendingFocus && appliedFocus.current !== pendingFocus.nonce)) return;
    el.scrollTo({ top: el.scrollHeight });
    previousScrollTop.current = el.scrollTop;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinOn is the caller's dependency list
  }, [transcriptKey, messages.length, ...pinOn]);

  const olderPending = useStoreSelector((state) => Boolean(state.loadingOlder[threadId]));
  const loadOlder = () => {
    holdRowForPrepend();
    dispatch({ type: "loadOlderMessages", threadId });
  };

  useEffect(() => {
    if (!olderPending) expandingRef.current = false;
  }, [olderPending]);

  const triggerAutoEarlier = useCallback(() => {
    if (expandingRef.current || !hasMore || olderPending) return;
    expandingRef.current = true;
    holdRowForPrepend();
    dispatch({ type: "loadOlderMessages", threadId });
  }, [hasMore, olderPending, threadId, dispatch, transcriptKey]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !followRef.current) {
          triggerAutoEarlier();
        }
      },
      { root, rootMargin: "250px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [triggerAutoEarlier]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      const ownKeys = typeof (e.target as Element | null)?.closest === "function" &&
        Boolean((e.target as Element).closest(WIDGETS_WITH_OWN_ARROW_KEYS));
      if (ownKeys || !canScroll()) return;
      if (e.key === "PageUp" || ((e.key === "Home" || e.key === "ArrowUp") && !typing)) {
        setBottomFollow(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setBottomFollow]);

  const canScroll = () => {
    const el = scrollRef.current;
    return Boolean(el && el.scrollHeight - el.clientHeight >= 1);
  };
  // Rows that draw nothing (hidden tool steps) can leave a transcript too short to scroll while earlier pages exist.
  const canScrollUp = () => canScroll() || Boolean(hasMore);
  const atEnd = () => {
    const el = scrollRef.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_FOLLOW_THRESHOLD;
  };
  const jumpToLatest = () => {
    setBottomFollow(true);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    });
  };

  // the person's own new message brings the transcript back to the latest, however far up it was
  const newest = messages.at(-1);
  const seenNewest = useRef({ key: transcriptKey, id: newest?.id });
  const latestJump = useRef(jumpToLatest);
  latestJump.current = jumpToLatest;
  useEffect(() => {
    const seen = seenNewest.current;
    seenNewest.current = { key: transcriptKey, id: newest?.id };
    if (seen.key !== transcriptKey || seen.id === newest?.id || newest?.role !== "user") return;
    if (!followRef.current) latestJump.current();
  }, [transcriptKey, newest?.id, newest?.role]);

  const scrollHandlers = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      // Grabbing the scrollbar is a scroll gesture: its lane lies past clientWidth.
      const el = scrollRef.current;
      if (el && e.target === el && e.nativeEvent.offsetX >= el.clientWidth) setBottomFollow(false);
    },
    onWheel: (e: WheelEvent<HTMLDivElement>) => {
      if (e.deltaY < 0 && canScrollUp()) {
        setBottomFollow(false);
        const el = scrollRef.current;
        if (el && el.scrollTop <= AUTO_EXPAND_TOP_THRESHOLD) {
          triggerAutoEarlier();
        }
      } else if (atEnd()) {
        setBottomFollow(true);
      }
    },
    onTouchStart: (e: TouchEvent<HTMLDivElement>) => {
      touchY.current = e.touches[0]?.clientY ?? 0;
    },
    onTouchMove: (e: TouchEvent<HTMLDivElement>) => {
      const y = e.touches[0]?.clientY ?? 0;
      if (y > touchY.current + 4 && canScrollUp()) {
        setBottomFollow(false);
        const el = scrollRef.current;
        if (el && el.scrollTop <= AUTO_EXPAND_TOP_THRESHOLD) {
          triggerAutoEarlier();
        }
      } else if (atEnd()) {
        setBottomFollow(true);
      }
    },
    onScroll: () => {
      const el = scrollRef.current;
      if (!el) return;
      const scrollTop = el.scrollTop;
      const resume = shouldResumeBottomFollow({
        following: followRef.current,
        previousScrollTop: previousScrollTop.current,
        scrollTop,
        distanceFromBottom: el.scrollHeight - scrollTop - el.clientHeight,
      });
      previousScrollTop.current = scrollTop;
      if (resume) {
        setBottomFollow(true);
      } else if (!followRef.current && scrollTop <= AUTO_EXPAND_TOP_THRESHOLD) {
        triggerAutoEarlier();
      }
    },
  };

  useArrivalFlow({ scrollRef, clipRef, columnRef: transcriptRef, transcriptKey, following: follow });

  const focusMessageId = pendingFocus?.messageId ?? null;
  const viewport = useMemo<TranscriptViewport>(
    () => ({ scrollRef, columnRef: transcriptRef, transcriptKey, startAtEnd: focusMessageId === null, focusMessageId, keepMounted }),
    [transcriptKey, focusMessageId, keepMounted],
  );

  return {
    scrollRef,
    clipRef,
    transcriptRef,
    topSentinelRef,
    transcriptKey,
    following: follow,
    viewport,
    olderPending,
    hasEarlier: Boolean(hasMore),
    loadOlder,
    jumpToLatest,
    scrollHandlers,
  };
}
