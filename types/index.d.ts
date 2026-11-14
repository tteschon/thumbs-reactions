/** The main loop's latest assistant row that holds text. */
export type LatestReply = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'thumbs-reactions': {
      latest: LatestReply | null
      isBusy: boolean
      /** Slash commands the session can run now; null until listed. */
      available: readonly string[] | null
      /** Whether 🔍 has work: the last main turn edited a file, or git shows changes. */
      hasEdited: boolean
      /** Whether the 🧹 button is waiting for its ✓ / ✕. */
      isConfirmingClear: boolean
      /** Fingerprint of the uncommitted changes the last 🔍 review read. */
      reviewedChanges: string | null
    }
  }
}
