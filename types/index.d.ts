/** The main loop's latest assistant row that holds text. */
export type LatestReply = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'thumbs-reactions': { latest: LatestReply | null; isBusy: boolean }
  }
}
