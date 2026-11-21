// Page scripts the fixtures share.

/**
 * A rich-text editor that keeps its own model, as Draft.js, Lexical and Slack's do: it cancels every beforeinput and
 * renders from the model, so text put in the DOM any other way (textContent, innerHTML, execCommand into a stale
 * selection) is wiped on the next render and never reaches send.
 */
export const RICH_EDITOR_JS = `function richEditor(el, options) {
  const opts = options || {};
  let model = "";
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const caretEnd = () => {
    if (document.activeElement !== el) return;
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  };
  const render = () => {
    el.innerHTML = (model ? model.split("\\n") : [""]).map((line) => '<div data-block="true"><span data-text="true">' + (line ? esc(line) : "<br>") + "</span></div>").join("");
    el.classList.toggle("empty", !model);
    caretEnd();
    opts.onChange && opts.onChange(model);
  };
  const allSelected = () => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return false;
    return sel.toString().replace(/\\s/g, "").length >= model.replace(/\\s/g, "").length;
  };
  el.addEventListener("beforeinput", (e) => {
    e.preventDefault();
    const replace = allSelected();
    const base = replace ? "" : model;
    const data = e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData("text/plain") : "");
    switch (e.inputType) {
      case "insertText": case "insertReplacementText": case "insertFromPaste": case "insertFromDrop": case "insertCompositionText":
        model = base + data.replace(/\\r\\n?/g, "\\n"); break;
      case "insertParagraph":
        if (opts.onEnter) { opts.onEnter(); return; }
        model = base + "\\n"; break;
      case "insertLineBreak": model = base + "\\n"; break;
      case "deleteContentBackward": case "deleteContentForward": case "deleteByCut": case "deleteWordBackward": case "deleteSoftLineBackward": case "deleteHardLineBackward":
        model = replace ? "" : model.slice(0, -1); break;
      default: return;
    }
    render();
  });
  el.addEventListener("focus", () => setTimeout(caretEnd, 0));
  render();
  return { get text() { return model; }, clear() { model = ""; render(); } };
}`;

export const EDITOR_CSS = `[contenteditable]{outline:none}[contenteditable].empty:before{content:attr(data-placeholder);color:#8a8a8e;position:absolute;pointer-events:none}`;
