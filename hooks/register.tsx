import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

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
const available = atom(
  { plugin: 'thumbs-reactions', key: 'available' } as const,
  null as readonly string[] | null,
)
const hasEdited = atom({ plugin: 'thumbs-reactions', key: 'hasEdited' } as const, false)
const isConfirmingClear = atom(
  { plugin: 'thumbs-reactions', key: 'isConfirmingClear' } as const,
  false,
)
const reviewedChanges = atom(
  { plugin: 'thumbs-reactions', key: 'reviewedChanges' } as const,
  null as string | null,
)

/** Slash-command buttons, after the reactions. */
export const COMMANDS = [
  { key: 'clear', label: '🧹', command: 'clear', isConfirmed: true, isAfterEdits: false },
  { key: 'compact', label: '🗜️', command: 'compact', isConfirmed: false, isAfterEdits: false },
  { key: 'review', label: '🔍', command: 'code-review', isConfirmed: false, isAfterEdits: true },
] as const

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// A failed state write must never hold up a prompt or a stored row.
const safely = (p: Promise<unknown>) => p.catch(() => undefined)

/** Lists the commands the session can run now; a failed list keeps the last. */
async function refreshCommands($: EngineInterface) {
  const names = await $.command.list().then(
    list => list.map(c => c.name),
    () => null,
  )
  if (names !== null) await safely(update($, available, () => names))
}

/**
 * A short fingerprint of the working tree's uncommitted changes: '' when
 * there are none, null outside git or when git fails.
 */
async function changesFingerprint($: EngineInterface) {
  const run = (argv: string[], stdin?: string) =>
    $.process
      .run(argv, { timeoutMs: 5000, ...(stdin === undefined ? {} : { stdin }) })
      .catch(() => null)
  const status = await run(['git', 'status', '--porcelain'])
  if (status === null || status.exitCode !== 0) return null
  if (status.stdout.trim() === '') return ''
  const diff = await run(['git', 'diff', 'HEAD'])
  const hashed = await run(['git', 'hash-object', '--stdin'], status.stdout + (diff?.stdout ?? ''))
  return hashed !== null && hashed.exitCode === 0 ? hashed.stdout.trim() : status.stdout
}

/** After a main turn: refresh the command list and whether 🔍 has work. */
async function afterTurn($: EngineInterface) {
  await refreshCommands($)
  const changes = await changesFingerprint($)
  // Changes 🔍 already reviewed, unchanged since, give it no work.
  if (changes !== null && changes !== '' && changes !== (await read($, reviewedChanges))) {
    await safely(update($, hasEdited, () => true))
  }
}

/** Marks 🔍 as having work once an edit tool ran, and passes its result on. */
async function noteEdit<R extends { deny?: unknown; isError?: boolean }>($: EngineInterface, ran: R) {
  if (ran.deny === undefined && ran.isError !== true) {
    await safely(update($, hasEdited, () => true))
  }
  return ran
}

export const register: Register = on => {
  // Counts main-loop turns, so a command press can tell whether it started one.
  let turnsStarted = 0
  // The ids of drawn reply blocks, and those drawn before the current main
  // turn began: a block drawn before it is an older reply, even when it has
  // the latest reply's words. A reload starts both empty.
  const drawn = new Set<string>()
  let drawnBeforeTurn = new Set<string>()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // No turn is running at a start: nothing may stay hidden or half-asked.
    await safely(update($, isBusy, () => false))
    await safely(update($, isConfirmingClear, () => false))
    await refreshCommands($)
    return result
  })

  // Main loop only: a subagent's turns and rows never move the buttons.
  // Busy follows model turns alone, so a slash command or a dropped prompt
  // that starts no turn never leaves the buttons hidden.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turnsStarted += 1
      drawnBeforeTurn = new Set(drawn)
      await safely(update($, isBusy, () => true))
      await safely(update($, hasEdited, () => false))
      await safely(update($, isConfirmingClear, () => false))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      await safely(update($, isBusy, () => false))
      // Not awaited: the turn's end never waits on git or the command list.
      void afterTurn($)
    }
    return result
  })

  // 🔍 has work when the turn edited a file with an edit tool (a subagent's
  // too), or when git shows uncommitted changes at the turn's end that 🔍 has
  // not reviewed yet, which also catches edits made through a shell command.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => noteEdit($, await next(e)))
  on('tool.call', { tool: 'Write' }, async ($, e, next) => noteEdit($, await next(e)))
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => noteEdit($, await next(e)))

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
      // The last text block: a surface draws each block of a reply on its own.
      const text = (message.content ?? [])
        .flatMap((b): string[] => (b.type === 'text' ? [String(b.text)] : []))
        .at(-1) ?? ''
      if (norm(text) !== '') {
        await safely(update($, latest, () => ({ id: result.uuid, text })))
      }
    }
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    drawn.add(e.requestId)

    const last = await read($, latest)
    const busy = await read($, isBusy)
    // A surface's id for a drawn block is its own (the desktop's is the API
    // message id plus the block's index), never the stored row's, so the block
    // is matched by its words, and only if it was not drawn before this turn.
    const isLatest =
      last !== null &&
      (e.requestId === last.id ||
        (norm(e.props.text) === norm(last.text) && !drawnBeforeTurn.has(e.requestId)))

    if (!isLatest || busy) return next(e)

    const names = await read($, available)
    const edited = await read($, hasEdited)
    const confirming = await read($, isConfirmingClear)
    const commands = COMMANDS.filter(
      c => (names === null || names.includes(c.command)) && (!c.isAfterEdits || edited),
    )

    const { Box, Button, Text } = $.ui.resolve(e)
    const runCommand = (command: string) => async () => {
      const before = turnsStarted
      await safely(update($, isConfirmingClear, () => false))
      await safely(update($, isBusy, () => true))
      // What a review is about to read, so 🔍 hides until the changes move on.
      const reviewing = command === 'code-review' ? await changesFingerprint($) : null
      const ran = await $.command.run({ command }).then(
        () => true,
        () => {
          $.ui.toast(`/${command} didn't run`)
          return false
        },
      )
      if (ran && command === 'clear') await safely(update($, latest, () => null))
      if (ran && reviewing !== null) await safely(update($, reviewedChanges, () => reviewing))
      // A command that started a model turn leaves busy to that turn's end.
      if (turnsStarted === before) await safely(update($, isBusy, () => false))
    }
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
          {commands.length > 0 ? <Text dimColor>│</Text> : null}
          {commands.map(c =>
            c.isConfirmed && confirming ? (
              <Box key={c.key} flexDirection="row" gap={1}>
                <Text>Clear the conversation?</Text>
                <Button key={`${c.key}-yes`} label="✓" onPress={runCommand(c.command)} />
                <Button
                  key={`${c.key}-no`}
                  label="✕"
                  onPress={() => update($, isConfirmingClear, () => false)}
                />
              </Box>
            ) : (
              <Button
                key={c.key}
                label={c.label}
                onPress={
                  c.isConfirmed
                    ? () => update($, isConfirmingClear, () => true)
                    : runCommand(c.command)
                }
              />
            ),
          )}
        </Box>
      </Box>
    )
  })
}
