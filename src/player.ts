/**
 * Asks the player to skip this app and move on. ScreenlyOS players have had
 * signalAbort() since 26.9; browsers, older players and the library's types
 * do not, so this returns false there and the caller shows its message.
 */
export function requestSkip(): boolean {
  const player = screenly as { signalAbort?: () => void }
  if (typeof player.signalAbort !== 'function') return false
  player.signalAbort()
  return true
}
