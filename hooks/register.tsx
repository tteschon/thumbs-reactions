import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { LatestReply } from '../types'

export const THUMBS_UP = '👍 Looks good, continue'
export const THUMBS_DOWN = "👎 That's not right — try another approach"
export const RETRY = '🔁 Try that again'

// Tells Claude what a press means, so a reaction is never read as more than it says.
export const MEANING = `The person has 👍, 👎 and 🔁 buttons under your latest reply (the thumbs-reactions mod). A press reaches you as a message the thumbs-reactions plugin sent, with one of these texts:
- "${THUMBS_UP}": the person approves your last reply. If it ended with one yes/no question or one recommended next step, that is a yes to it. If it asked them to choose between options or to supply something (a name, a value, a setting), a thumb answers nothing: say so in one line, restate the choice briefly, and wait. It never approves anything the reply did not propose. If nothing was pending, acknowledge in a line and stop.
- "${THUMBS_DOWN}": your last reply missed. Do not repeat it: say in a line what you will change, or ask one short question when what was wrong is unclear.
- "${RETRY}": redo the last reply's work as a fresh attempt, not a rewording of it.`

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
  // Busy follows model turns alone, so a slash command or a dropped prompt
  // that starts no turn never leaves the buttons hidden.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await safely(update($, isBusy, () => true))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await safely(update($, isBusy, () => false))
    return result
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    // Only where a surface draws the buttons; never for `-p` or the SDK.
    if (e.surfaces.length === 0) return result
    return {
      ...result,
      sections: [
        ...result.sections,
        { id: 'thumbs-reactions:meaning', text: MEANING, scope: 'session' as const },
      ],
    }
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
    // Matched by the row's id alone: a reply with the same words as an older
    // one no longer takes the buttons too.
    const isLatest = last !== null && e.requestId === last.id

    if (!isLatest || busy) return next(e)

    const { Box, Button } = $.ui.resolve(e)
    const react = (text: string) => async () => {
      // Hide the buttons first so a double press cannot queue two turns.
      await safely(update($, isBusy, () => true))
      const sent = await $.prompt.submit({ text }).catch(() => undefined)
      // Nothing started a turn (refused or dropped): show the buttons again.
      if (sent === undefined || sent.drop !== undefined) {
        await safely(update($, isBusy, () => false))
      }
    }

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Box flexDirection="row" gap={1}>
          <Button key="thumbs-up" label="👍" onPress={react(THUMBS_UP)} />
          <Button key="thumbs-down" label="👎" onPress={react(THUMBS_DOWN)} />
          <Button key="retry" label="🔁" onPress={react(RETRY)} />
        </Box>
      </Box>
    )
  })
}
