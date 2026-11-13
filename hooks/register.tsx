import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LatestReply } from '../types'

export const THUMBS_UP = '👍 Looks good, continue'
export const THUMBS_DOWN = "👎 That's not right — try another approach"

const latest = atom(
  { plugin: 'thumbs-reactions', key: 'latest' } as const,
  null as LatestReply | null,
)
const isBusy = atom({ plugin: 'thumbs-reactions', key: 'isBusy' } as const, false)

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// A failed state write must never hold up a prompt or a stored row.
const safely = (p: Promise<unknown>) => p.catch(() => undefined)

export const register: Register = on => {
  // Main loop only: a subagent's turns and rows never move the buttons.
  on('prompt.submit', async ($, e, next) => {
    await safely(update($, isBusy, () => true))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await safely(update($, isBusy, () => true))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await safely(update($, isBusy, () => false))
    return result
  })

  on('session.append', async ($, e, next) => {
    const result = await next(e)
    const message = result.message ?? e.message
    if (e.agentId === undefined && message.type === 'assistant') {
      const text = (message.content ?? [])
        .flatMap(b => (b.type === 'text' ? [b.text] : []))
        .join('\n')
      if (norm(text) !== '') {
        await safely(update($, latest, () => ({ id: result.uuid, text })))
      }
    }
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)

    const last = await read($, latest)
    const busy = await read($, isBusy)
    const isLatest =
      last !== null &&
      (e.requestId === last.id || norm(e.props.text) === norm(last.text))

    if (!isLatest || busy) return next(e)

    const { Box, Button } = $.ui.resolve(e)
    const react = (text: string) => async () => {
      // Hide the buttons first so a double press cannot queue two turns.
      await update($, isBusy, () => true)
      void $.prompt.submit({ text })
    }

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="row" gap={1}>
          <Button key="thumbs-up" label="👍" onPress={react(THUMBS_UP)} />
          <Button key="thumbs-down" label="👎" onPress={react(THUMBS_DOWN)} />
        </Box>
      </Box>
    )
  })
}
