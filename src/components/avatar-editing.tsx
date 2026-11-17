import { useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";

import { useStoreActions, type Bot } from "@/state/store";
import { imageAttachmentFromFile } from "@/lib/composer-attachments";
import { useOrganizationBranding } from "@/lib/use-organization-branding";
import { AVATAR_FOCUS_CENTER, AVATAR_ZOOM_MAX, AVATAR_ZOOM_MIN, botAvatarUrlFromStoredPath, clampAvatarFocus, clampAvatarZoom } from "../../shared/bot-avatar";
import { DEFAULT_BOT_BODY } from "../../shared/bot-body";
import { BotAvatar } from "./Avatar";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { friendlyError } from "@/lib/plain-error";

export type AvatarPatch = Partial<
  Pick<Bot, "avatarCrop" | "avatarUrl" | "avatarZoom" | "avatarFocusX" | "avatarFocusY" | "color" | "mascotExpression" | "mascotBody" | "mascotFaceColor">
>;

export const RESET_MASCOT_PATCH: AvatarPatch = { avatarCrop: "mascot", color: "green", mascotExpression: null, mascotBody: DEFAULT_BOT_BODY, mascotFaceColor: null };

const FRAME_SIZE = 168;

export function AvatarFraming({
  bot,
  disabled,
  onPatch,
}: {
  bot: Bot;
  disabled: boolean;
  onPatch: (patch: AvatarPatch) => void;
}) {
  const zoom = clampAvatarZoom(bot.avatarZoom ?? AVATAR_ZOOM_MIN);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? AVATAR_FOCUS_CENTER);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? AVATAR_FOCUS_CENTER);
  const framed = zoom !== AVATAR_ZOOM_MIN || focusX !== AVATAR_FOCUS_CENTER || focusY !== AVATAR_FOCUS_CENTER;
  const drag = useRef<{ x: number; y: number; focusX: number; focusY: number; pointer: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, focusX, focusY, pointer: event.pointerId };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || event.pointerId !== start.pointer) return;
    onPatch({
      avatarFocusX: clampAvatarFocus(start.focusX - (event.clientX - start.x) / FRAME_SIZE / zoom),
      avatarFocusY: clampAvatarFocus(start.focusY - (event.clientY - start.y) / FRAME_SIZE / zoom),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null;
  };
  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (disabled || event.deltaY === 0) return;
    event.preventDefault();
    onPatch({ avatarZoom: clampAvatarZoom(zoom + (event.deltaY < 0 ? 0.08 : -0.08)) });
  };

  return (
    <div className="py-3">
      <div
        className="mx-auto w-fit cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <BotAvatar bot={bot} size={FRAME_SIZE} animated={false} label={`${bot.name} avatar preview`} />
      </div>
      <div className="mb-1 mt-3 flex items-baseline justify-between text-[12px] leading-4 tracking-[0.01em] text-ink/68">
        <span>Zoom</span>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
      </div>
      <input
        type="range"
        min={AVATAR_ZOOM_MIN}
        max={AVATAR_ZOOM_MAX}
        step={0.01}
        value={zoom}
        disabled={disabled}
        aria-label="Zoom avatar"
        aria-valuemin={AVATAR_ZOOM_MIN}
        aria-valuemax={AVATAR_ZOOM_MAX}
        aria-valuenow={zoom}
        aria-valuetext={`${Math.round(zoom * 100)}%`}
        onChange={(event) => onPatch({ avatarZoom: clampAvatarZoom(Number(event.target.value)) })}
        className="w-full accent-ink"
      />
      <div className="mt-1 flex items-center justify-between gap-3 text-[12px] leading-4 text-ink/56">
        <span>Drag the picture to reposition it. Scroll to zoom.</span>
        {framed && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPatch({ avatarZoom: AVATAR_ZOOM_MIN, avatarFocusX: AVATAR_FOCUS_CENTER, avatarFocusY: AVATAR_FOCUS_CENTER })}
            className="h-6 shrink-0 cursor-pointer rounded-full bg-ink/6 px-2 text-[12px] leading-4 text-ink hover:bg-ink/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50"
          >
            Reset framing
          </button>
        )}
      </div>
    </div>
  );
}

export function OrganizationAvatarIcons({ busy, onUpload }: { busy: boolean; onUpload: (file: File) => void }) {
  const organization = useOrganizationBranding();
  if (!organization?.icons.length) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="text-[12px] leading-4 tracking-[0.01em] text-ink/68">{organization.name} icons</div>
      <div className="flex flex-wrap gap-2">{organization.icons.map(icon => <button key={icon.id} type="button" disabled={busy} title={icon.name} aria-label={`Use ${icon.name} icon`} className="flex size-12 cursor-pointer items-center justify-center rounded-[10px] border border-transparent hover:bg-ink/[0.035] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-50" onClick={() => {
        const bytes = Uint8Array.from(atob(icon.image.slice(22)), byte => byte.charCodeAt(0));
        onUpload(new File([bytes], `${icon.id}.png`, { type: "image/png" }));
      }}><img src={icon.image} alt="" className="size-10 rounded-md object-contain" /></button>)}</div>
    </div>
  );
}

export function useAvatarImage(bot: Bot, onPatch: (patch: AvatarPatch) => void) {
  const { flushBotPatches } = useStoreActions();
  const { request: api, uploadAvatar } = useBotEditor();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [savingConnection, setSavingConnection] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const crop = bot.avatarCrop ?? "mascot";
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const busy = uploading || generating || savingConnection;

  const upload = async (file: File | undefined) => {
    if (!file || busy) return;
    setUploading(true);
    setError(null);
    try {
      const saved = uploadAvatar ? null : await imageAttachmentFromFile(file);
      const avatarUrl = uploadAvatar ? await uploadAvatar(file) : saved ? botAvatarUrlFromStoredPath(saved.path) : null;
      if (!avatarUrl) throw new Error("The uploaded image could not be used as an avatar");
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl,
        avatarCrop: latestCrop === "mascot" ? "circle" : latestCrop,
        avatarZoom: AVATAR_ZOOM_MIN,
        avatarFocusX: AVATAR_FOCUS_CENTER,
        avatarFocusY: AVATAR_FOCUS_CENTER,
      });
    } catch (uploadError) {
      setError(friendlyError(uploadError));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = () => {
    setError(null);
    onPatch({
      avatarUrl: null,
      avatarCrop: "mascot",
      avatarZoom: AVATAR_ZOOM_MIN,
      avatarFocusX: AVATAR_FOCUS_CENTER,
      avatarFocusY: AVATAR_FOCUS_CENTER,
    });
  };

  const generate = async (direction: string) => {
    if (busy) return;
    setGenerating(true);
    setError(null);
    try {
      // Commit debounced profile edits first, then feed the generated avatar back through the same serialized mutation
      // lane as upload and remove.
      const cropAtStart = cropRef.current;
      await flushBotPatches(bot.id);
      const result: { avatarUrl: string; bot: Bot } = await api(`/api/bots/${bot.id}/avatar/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: direction.trim() }),
      });
      const latestCrop = cropRef.current;
      onPatch({
        avatarUrl: result.avatarUrl,
        avatarCrop:
          latestCrop === cropAtStart
            ? (result.bot.avatarCrop ?? "circle")
            : latestCrop,
      });
    } catch (generateError) {
      setError(friendlyError(generateError));
    } finally {
      setGenerating(false);
    }
  };

  return { fileRef, crop, uploading, generating, setSavingConnection, busy, error, upload, removeImage, generate };
}
