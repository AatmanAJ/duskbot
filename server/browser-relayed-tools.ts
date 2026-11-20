export const BROWSER_UPLOAD_TOOL = "agent_browser_upload";
export const BROWSER_HOVER_TOOL = "agent_browser_hover";
/** agent-browser 0.37.0 offers upload and hover only in its 156-tool "all" profile, so dusk bot runs these two through the daemon's relay. */
export const RELAYED_TOOL_SPECS = [
  {
    name: BROWSER_UPLOAD_TOOL,
    description: "Put files into a file input (<input type=\"file\">), then submit its form as usual. files are absolute paths of files the person attached to this conversation or files in your own working folder; any other path is refused.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["selector", "files"],
      properties: {
        selector: { type: "string", minLength: 1, description: "The file input: an @eN ref from a snapshot, or a CSS selector." },
        files: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", minLength: 1 }, description: "Absolute paths of the files to put in the input." },
      },
    },
  },
  {
    name: BROWSER_HOVER_TOOL,
    description: "Move the mouse over an element, for menus and tooltips that open on hover.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["selector"],
      properties: { selector: { type: "string", minLength: 1, description: "An @eN ref from a snapshot, or a CSS selector." } },
    },
  },
];
export type RelayedToolSpec = (typeof RELAYED_TOOL_SPECS)[number];
export const RELAYED_TOOLS: ReadonlyMap<string, RelayedToolSpec> = new Map(RELAYED_TOOL_SPECS.map((spec) => [spec.name, spec]));
