export const SCRIPT_SAVE_SCHEMA = {
  save_to: { type: "string", description: "script only: file in your folder its output is written to (no card needed)." },
  save_mode: { type: "string", enum: ["append"] },
} as const;

export const CHAIN_FIELDS_SCHEMA = {
  read_from: { type: "array", maxItems: 5, items: { type: "string" }, description: "Schedules: trigger ids whose latest report each run reads." },
  after: { type: "array", maxItems: 5, items: { type: "string" }, description: "Schedules: trigger ids to run after (chaining): runs when one finishes with news, given its report. schedule optional. Not with check." },
  hand_to: { type: "object", additionalProperties: false, properties: { bot_id: { type: "string" }, room_id: { type: "string" } }, description: "Schedules: also send each report to another bot's chat (bot_id) or a room (room_id)." },
  clear_chain: { type: "boolean", description: "Updates: removes read_from, after, hand_to; giving any replaces all three." },
} as const;
