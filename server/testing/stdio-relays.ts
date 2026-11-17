/** For a suite that reads a turn's relay settings (the comms token, the bot's id) out of the engine's launch config,
 * which an MCP host mount never carries: its servers, and fixtures it launches, keep dusk bot's stdio relays. */
export function keepStdioRelays(): void {
  process.env.DUSK_MCP_HOST = "0";
}
