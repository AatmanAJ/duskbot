/** The one sentence a person or a teammate reads when a bot's computer could not be reached: the cause stays in the logs. */
export const COMPUTER_UNREACHABLE = "The bot's computer isn't answering right now. Try again in a minute: it restarts by itself.";

/** How a docker, ssh or docker-gate transport failure reads: a Go client's "error during connect", a socket path, an ssh
 * or gate refusal. Never words for a chat. */
const RAW_TRANSPORT = /error during connect|docker[ -]over[ -]ssh|%2F\S*docker|docker\.sock\b|\bdial (?:unix|tcp)\b|\bssh: |docker gate:|cannot connect to the docker daemon/i;

export function isRawComputerTransportError(text: string): boolean {
  return RAW_TRANSPORT.test(text);
}

/** `text` unchanged, unless it is a raw transport failure: then the plain sentence. */
export function plainComputerFailure(text: string): string {
  return isRawComputerTransportError(text) ? COMPUTER_UNREACHABLE : text;
}
