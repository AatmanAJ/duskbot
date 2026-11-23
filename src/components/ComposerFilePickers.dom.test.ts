// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachToComposer, PickProblem, setNativeAttach } from "@/lib/native-attach";
import { pickedPhotos } from "../../apps/mobile/src/native-platform";
import { useComposerFilePickers } from "./ComposerFilePickers";

function mount(onPick: (files: ArrayLike<File> | null) => void) {
  let pickers!: ReturnType<typeof useComposerFilePickers>;
  const Probe = () => { pickers = useComposerFilePickers(onPick); return pickers.inputs; };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(createElement(Probe)));
  return { pickers: () => pickers, container, unmount: () => { flushSync(() => root.unmount()); container.remove(); } };
}

describe("the composer's pickers on the phone app", () => {
  afterEach(() => { setNativeAttach(null); vi.unstubAllGlobals(); });

  it("opens the photo library and Files on the app's own pickers, never the web input that asks which one first", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    const photo = new File(["x"], "image-1.jpg", { type: "image/jpeg" });
    const doc = new File(["y"], "notes.pdf", { type: "application/pdf" });
    const native = { photos: vi.fn(async () => [photo]), files: vi.fn(async () => [doc]) };
    setNativeAttach(native);
    const picked: File[][] = [];
    const app = mount((files) => picked.push(Array.from(files ?? [])));
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click");
    app.pickers().choices!.photos();
    app.pickers().files();
    await vi.waitFor(() => expect(picked).toEqual([[photo], [doc]]));
    expect(inputClick).not.toHaveBeenCalled();
    app.unmount();
  });

  it("adds what a photo pick got and holds on to what it left out, for the error card, until the next pick", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
    const photo = new File(["x"], "image-1.jpg", { type: "image/jpeg" });
    const photos = vi.fn<() => Promise<File[]>>()
      .mockRejectedValueOnce(new PickProblem([], 2, []))
      .mockRejectedValueOnce(new PickProblem([photo], 0, ["IMG_0001"]))
      .mockResolvedValueOnce([photo]);
    setNativeAttach({ photos, files: vi.fn(async () => []) });
    const picked: File[][] = [];
    const app = mount((files) => picked.push(Array.from(files ?? [])));
    app.pickers().choices!.photos();
    await vi.waitFor(() => expect(app.pickers().problem).toMatchObject({ failed: 2, tooLarge: [] }));
    expect(picked).toEqual([]);
    app.pickers().pickPhotosAgain();
    await vi.waitFor(() => expect(app.pickers().problem).toMatchObject({ failed: 0, tooLarge: ["IMG_0001"] }));
    expect(picked).toEqual([[photo]]);
    app.pickers().pickPhotosAgain();
    await vi.waitFor(() => expect(picked).toHaveLength(2));
    expect(app.pickers().problem).toBeNull();
    app.unmount();
  });

  it("counts a picked file the app could not read back as left out", async () => {
    const read = vi.fn(async (url: string) => url.includes("good") ? new Response("x") : new Response(null, { status: 404 }));
    await expect(pickedPhotos({ files: [{ path: "/tmp/good.jpg", name: "good.jpg", type: "image/jpeg" }] }, read as unknown as typeof fetch)).resolves.toHaveLength(1);
    const left = await pickedPhotos({ files: [{ path: "/tmp/gone.jpg", name: "gone.jpg", type: "image/jpeg" }], failed: 1, tooLarge: ["IMG_0002"] }, read as unknown as typeof fetch)
      .catch((error: unknown) => error);
    expect(left).toBeInstanceOf(PickProblem);
    expect(left).toMatchObject({ files: [], failed: 2, tooLarge: ["IMG_0002"] });
  });

  it("takes images handed over from outside the field, as one pasted into the native composer", () => {
    const picked: File[][] = [];
    const app = mount((files) => picked.push(Array.from(files ?? [])));
    const pasted = new File(["z"], "pasted-1.png", { type: "image/png" });
    attachToComposer([pasted]);
    expect(picked).toEqual([[pasted]]);
    app.unmount();
    attachToComposer([pasted]);
    expect(picked).toHaveLength(1);
  });
});
