// Foundation taken from T3 Code: adapted from pingdotgg/t3code@b387e3a1
// apps/web/src/components/chat/MermaidDiagram.tsx (sanitizeDiagramSvg, sanitizeMathDiagramSvg), MIT License,
// Copyright (c) 2026 T3 Tools Inc. (full text in third_party/t3-code/LICENSE); modified: it cleans mermaid's SVG
// rather than Pele's, so mermaid's own <style> and the HTML labels it puts in <foreignObject> stay, and any url()
// that points outside the diagram is dropped, and it returns markup instead of a DOM fragment.
import DOMPurify from "dompurify";

// Security: mermaid's securityLevel "strict" already escapes labels and drops click links. This second pass keeps a
// diagram from navigating, running script or fetching anything remote even if a mermaid bug lets markup through.
const FORBID_TAGS = ["a", "image", "img", "script", "iframe", "object", "embed", "use", "animate", "set", "audio", "video",
  "form", "input", "button", "textarea", "select"];
const FORBID_ATTR = ["href", "xlink:href", "src", "srcset", "action", "formaction"];
// mermaid's own CSS has no escapes and no image-set(); either one in a value is how a remote URL would hide from the url() check.
const UNSAFE_VALUE = /url\(\s*(?!['"]?\s*#)|\\|image-set\s*\(/i;
const CSS_ESCAPE = /\\(?:[0-9a-f]{1,6}\s?|[\s\S])/gi;
const REMOTE_CSS = /@import[^;]*;?|url\(\s*(?!['"]?\s*#)[^)]*\)|image-set\s*\(/gi;

let purifier: ReturnType<typeof DOMPurify> | null = null;

function diagramPurifier(): ReturnType<typeof DOMPurify> {
  if (purifier) return purifier;
  const created = DOMPurify(window);
  created.addHook("uponSanitizeAttribute", (_node, data) => {
    if (UNSAFE_VALUE.test(data.attrValue)) data.keepAttr = false;
  });
  created.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName === "style" && node.textContent) node.textContent = node.textContent.replace(CSS_ESCAPE, "").replace(REMOTE_CSS, "none");
  });
  purifier = created;
  return created;
}

export function sanitizeDiagramSvg(svg: string): string {
  return diagramPurifier().sanitize(svg, {
    ADD_TAGS: ["foreignObject"],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS,
    FORBID_ATTR,
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
  });
}
