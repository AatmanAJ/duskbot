// A local stand-in for a chat site's DM thread (x.com's is the model): a contenteditable composer with role=textbox in a
// virtualised message list, a placeholder laid over it, and React-style rendering that swaps the composer for a new
// node when it first takes focus and whenever the page re-renders. Enter sends; Shift+Enter starts a new line.
// window.dm holds what was sent and the draft; window.dm.rerender() swaps the composer as the next render would.

export type ComposerPlace = "page" | "shadow" | "frame";

const APP = String.raw`
(() => {
  const dm = { sent: [], renders: 0, composer: null };
  window.dm = dm;
  const place = document.currentScript.dataset.place;
  const host = document.getElementById("thread");
  const root = place === "shadow" ? host.attachShadow({ mode: "open" }) : host;
  root.innerHTML = '<style>.list{height:220px;overflow:auto}.row{padding:6px}.bar{position:relative;padding:8px}.edit{min-height:22px;padding:6px 10px;border:1px solid #888;border-radius:14px;outline:none}.ph{position:absolute;left:20px;top:15px;color:#888;pointer-events:none}</style>' +
    '<section aria-label="Conversation"><div class="list" role="list"></div><div class="bar"></div></section>';
  const list = root.querySelector(".list");
  const bar = root.querySelector(".bar");
  const rows = () => {
    list.replaceChildren(...Array.from({ length: 40 }, (_, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.setAttribute("role", "listitem");
      row.textContent = (dm.sent[i - 40 + dm.sent.length] ?? "older message " + i);
      return row;
    }));
    list.scrollTop = list.scrollHeight;
  };
  const draftOf = (node) => (node ? node.innerText.replace(/\n$/, "") : "");
  const caretToEnd = (node) => {
    const selection = (root.getSelection ? root : document).getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const render = (focus) => {
    dm.renders++;
    const draft = draftOf(dm.composer);
    const placeholder = document.createElement("div");
    placeholder.className = "ph";
    placeholder.textContent = draft ? "" : "Start a new message";
    const edit = document.createElement("div");
    edit.className = "edit";
    edit.contentEditable = "true";
    edit.setAttribute("role", "textbox");
    edit.setAttribute("aria-label", "Message");
    edit.setAttribute("aria-multiline", "true");
    edit.innerText = draft;
    let fresh = true;
    edit.addEventListener("focus", () => {
      if (!fresh) return;
      fresh = false;
      render(true);
    });
    edit.addEventListener("input", () => { placeholder.textContent = draftOf(edit) ? "" : "Start a new message"; });
    edit.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      dm.sent.push(draftOf(edit));
      edit.innerText = "";
      rows();
    });
    bar.replaceChildren(edit, placeholder);
    dm.composer = edit;
    if (focus) {
      fresh = false;
      edit.focus();
      caretToEnd(edit);
    }
    rows();
  };
  dm.rerender = () => render(dm.composer && (root.activeElement ?? document.activeElement) === dm.composer);
  dm.draft = () => draftOf(dm.composer);
  render(false);
})();`;

/** The thread page with its composer in the page, in an open shadow root, or in a frame (`frameUrl` serves `threadPage("page")`). */
export function threadPage(place: ComposerPlace, frameUrl?: string): string {
  const head = `<!doctype html><meta charset="utf-8"><title>Messages</title><style>body{margin:0;font:14px sans-serif}</style>`;
  if (place === "frame") {
    if (!frameUrl) throw new Error("A framed thread needs the frame's address.");
    return `${head}<nav aria-label="Chats"><a href="#a">Creator A</a> <a href="#b">Creator B</a></nav><iframe title="Thread" src="${frameUrl}" style="width:600px;height:360px;border:0"></iframe>`;
  }
  return `${head}<nav aria-label="Chats"><a href="#a">Creator A</a> <a href="#b">Creator B</a></nav><main id="thread"></main><script data-place="${place}">${APP}</script>`;
}
