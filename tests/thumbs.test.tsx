import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { MEANING, RETRY, THUMBS_DOWN, THUMBS_UP } from '../hooks/register'

const message = (text: string) => ({
  message: {
    type: 'assistant' as const,
    role: 'assistant' as const,
    content: [{ type: 'text' as const, text }],
  },
  door: 'response' as const,
  origin: { kind: 'model' as const, model: 'claude-opus-5-5' },
})

const reply = (
  requestId: string,
  text: string,
  surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' = 'desktop',
) =>
  ({
    plugin: 'thumbs-reactions',
    component: 'AssistantMessage',
    requestId,
    surface,
    props: { text, isFirstOfReply: true },
  }) as const

const turnEnd = (agentId?: string) => ({
  reason: 'answer' as const,
  answer: '',
  durationMs: 1,
  isAborted: false,
  turnId: 't',
  ...(agentId === undefined ? {} : { agentId }),
})

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

// Stands for the engine's own drawing of the reply text.
const engine = (on: Parameters<TestBody>[1]) =>
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>reply</Text>
  })

test('buttons show under the latest reply once the turn ends, on every surface', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Old reply'), uuid: 'old' })
  await $.session.append({ ...message('New reply'), uuid: 'new' })
  await $.turn.complete(turnEnd())

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const latest = await $.ui.mount(reply('new', 'New reply', surface))
    expect(await latest.findAll({ type: 'Button' })).toHaveLength(5)
    await latest.unmount()

    const older = await $.ui.mount(reply('old', 'Old reply', surface))
    expect(await older.findAll({ type: 'Button' })).toHaveLength(0)
    await older.unmount()
  }
})

test("matches the latest reply by its words when the surface's id differs", async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Done.\n\nAll  set'), uuid: 'row-1' })
  await $.turn.complete(turnEnd())

  const ui = await $.ui.mount(reply('msg_01abc-t0', 'Done. All set'))
  expect(await keys(ui)).toContain('thumbs-up')
  await ui.unmount()
})

const turnStart = (agentId?: string) => ({
  text: 'go',
  turnId: 't',
  ...(agentId === undefined ? {} : { agentId }),
})

test('no buttons while Claude is working', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.session.append({ ...message('Working on it'), uuid: 'a' })
  await $.turn.start(turnStart())

  const ui = await $.ui.mount(reply('a', 'Working on it'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a subagent finishing does not show the buttons mid-turn', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Main reply'), uuid: 'm' })
  await $.turn.start(turnStart())
  await $.turn.start(turnStart('sub-1'))
  await $.turn.complete(turnEnd('sub-1'))

  const ui = await $.ui.mount(reply('m', 'Main reply'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a tool-only row does not take the buttons', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Here is the answer'), uuid: 'text' })
  await $.session.append({
    ...message(''),
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
    },
    uuid: 'tool',
  })
  await $.turn.complete(turnEnd())

  const ui = await $.ui.mount(reply('text', 'Here is the answer'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  await ui.unmount()
})

test('pressing a button sends the reply and hides the buttons', async ($, on) => {
  const sent: string[] = []
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  for (const [key, text] of [
    ['thumbs-up', THUMBS_UP],
    ['thumbs-down', THUMBS_DOWN],
    ['retry', RETRY],
  ] as const) {
    await $.session.append({ ...message(`Reply for ${key}`), uuid: key })
    await $.turn.complete(turnEnd())

    const ui = await $.ui.mount(reply(key, `Reply for ${key}`))
    await ui.press({ key })
    expect(sent.at(-1)).toBe(text)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('a slash command that starts no turn leaves the buttons up', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())
  await $.prompt.submit(typed('/clear-screen'))

  const ui = await $.ui.mount(reply('r', 'Reply'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  await ui.unmount()
})

test('a press whose prompt is dropped shows the buttons again', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', () => ({ drop: 'refused' }))

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())

  const ui = await $.ui.mount(reply('r', 'Reply'))
  await ui.press({ key: 'thumbs-up' })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(5)
  await ui.unmount()
})

const compose = (surfaces: readonly ('terminal' | 'desktop' | 'vscode' | 'mobile')[]) => ({
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces,
  tools: [],
  outputStyle: null,
  traits: [],
})

test("Claude is told what each button means where buttons are drawn", async ($, on) => {
  on('prompt.compose', () => ({
    sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }],
  }))

  const drawn = await $.prompt.compose(compose(['desktop']))
  expect(drawn.sections.at(-1)).toEqual({
    id: 'thumbs-reactions:meaning',
    text: MEANING,
    scope: 'session',
  })
  for (const text of [THUMBS_UP, THUMBS_DOWN, RETRY]) expect(MEANING).toContain(text)

  const headless = await $.prompt.compose(compose([]))
  expect(headless.sections).toHaveLength(1)
})

// The test runner has timers; the module's lib (no DOM) does not declare them.
declare function setTimeout(fn: (value?: unknown) => void, ms: number): unknown

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const keys = async (ui: { findAll: (q: { type: 'Button' }) => Promise<{ key?: string }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key)

const commandsAre = (names: string[]) => () => ({
  value: names.map(name => ({ name, description: '', source: 'builtin' as const })),
})

test('command buttons follow what the session can run', async ($, on) => {
  engine(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.list', commandsAre(['clear', 'help']))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())

  const ui = await $.ui.mount(reply('r', 'Reply'))
  expect(await keys(ui)).toEqual(['thumbs-up', 'thumbs-down', 'retry', 'clear'])
  await ui.unmount()
})

test('🔍 shows only under a reply whose turn edited a file', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))

  await $.turn.start(turnStart())
  await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  await $.session.append({ ...message('Edited'), uuid: 'e1' })
  await $.turn.complete(turnEnd())

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(reply('e1', 'Edited', surface))
    expect(await keys(ui)).toContain('review')
    await ui.unmount()
  }

  await $.turn.start(turnStart())
  await $.session.append({ ...message('Just talk'), uuid: 'e2' })
  await $.turn.complete(turnEnd())

  const ui = await $.ui.mount(reply('e2', 'Just talk'))
  expect(await keys(ui)).not.toContain('review')
  await ui.unmount()
})

test('🧹 asks first, and only ✓ runs /clear', async ($, on) => {
  const ran: string[] = []
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(reply('r', 'Reply', surface))
    await ui.press({ key: 'clear' })
    expect(await keys(ui)).toContain('clear-yes')
    await ui.press({ key: 'clear-no' })
    expect(await keys(ui)).toContain('clear')
    await ui.unmount()
  }
  expect(ran).toEqual([])

  const ui = await $.ui.mount(reply('r', 'Reply'))
  await ui.press({ key: 'clear' })
  await ui.press({ key: 'clear-yes' })
  expect(ran).toEqual(['clear'])
  await ui.unmount()
})

test('🗜️ runs /compact and the buttons come back when no turn starts', async ($, on) => {
  const ran: string[] = []
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  on('command.run', (_, e) => {
    ran.push(e.command)
    return { text: '' }
  })

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())
  const ui = await $.ui.mount(reply('r', 'Reply'))

  await ui.press({ key: 'compact' })
  expect(ran).toEqual(['compact'])
  expect(await keys(ui)).toContain('thumbs-up')
  await ui.unmount()
})

test('🔍 also shows when git has uncommitted changes (a shell edit)', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.list', commandsAre(['clear', 'compact', 'code-review']))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: ' M a.ts\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.turn.start(turnStart())
  await $.session.append({ ...message('Edited via Bash'), uuid: 'b' })
  await $.turn.complete(turnEnd())
  // The git check runs after the turn's end without holding it.
  await new Promise(resolve => setTimeout(resolve, 20))

  const ui = await $.ui.mount(reply('b', 'Edited via Bash'))
  expect(await keys(ui)).toContain('review')
  await ui.unmount()
})

test('a command that fails says so and brings the buttons back', async ($, on) => {
  const toasts: string[] = []
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => {
    throw new Error('unknown command')
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())
  const ui = await $.ui.mount(reply('r', 'Reply'))

  await ui.press({ key: 'compact' })
  expect(toasts).toEqual(["/compact didn't run"])
  expect(await keys(ui)).toContain('thumbs-up')
  await ui.unmount()
})

test('a command that starts a reply keeps the buttons hidden until it ends', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', async () => {
    await $.turn.start(turnStart())
    return { text: '' }
  })

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())
  const ui = await $.ui.mount(reply('r', 'Reply'))

  await ui.press({ key: 'compact' })
  expect(await keys(ui)).toEqual([])

  await $.turn.complete(turnEnd())
  expect(await keys(ui)).toContain('thumbs-up')
  await ui.unmount()
})

test('a reply with several text blocks takes the buttons on its last block', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({
    ...message(''),
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [
        { type: 'text', text: 'First part.' },
        { type: 'text', text: 'Last part.' },
      ],
    },
    uuid: 'multi',
  })
  await $.turn.complete(turnEnd())

  const first = await $.ui.mount(reply('msg_01x-t0', 'First part.'))
  expect(await keys(first)).toEqual([])
  await first.unmount()
  const last = await $.ui.mount(reply('msg_01x-t1', 'Last part.'))
  expect(await keys(last)).toContain('thumbs-up')
  await last.unmount()
})

test('an older reply with the same words, drawn before this turn, gets no buttons', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  await $.turn.start(turnStart())
  await $.session.append({ ...message('Done.'), uuid: 'a' })
  await $.turn.complete(turnEnd())
  const older = await $.ui.mount(reply('msg_a-t0', 'Done.'))
  expect(await keys(older)).toContain('thumbs-up')

  await $.turn.start(turnStart())
  await $.session.append({ ...message('Done.'), uuid: 'b' })
  await $.turn.complete(turnEnd())

  expect(await keys(older)).toEqual([])
  await older.unmount()
  const newer = await $.ui.mount(reply('msg_b-t0', 'Done.'))
  expect(await keys(newer)).toContain('thumbs-up')
  await newer.unmount()
})

test('a session start brings back buttons a killed turn left hidden', async ($, on) => {
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.start(turnStart())
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount(reply('r', 'Reply'))
  expect(await keys(ui)).toContain('thumbs-up')
  await ui.unmount()
})

test('after /clear the old reply loses its buttons', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))

  await $.session.append({ ...message('Reply'), uuid: 'r' })
  await $.turn.complete(turnEnd())
  const ui = await $.ui.mount(reply('r', 'Reply'))
  await ui.press({ key: 'clear' })
  await ui.press({ key: 'clear-yes' })

  expect(await keys(ui)).toEqual([])
  await ui.unmount()
})

test('🔍 hides after a review until the changes move on', async ($, on) => {
  let fingerprint = 'h1'
  const ok = (stdout: string) => ({
    value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  engine(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('process.run', (_, e) =>
    e.argv[1] === 'status' ? ok(' M a.ts\n') : e.argv[1] === 'diff' ? ok('diff') : ok(`${fingerprint}\n`),
  )
  const wait = () => new Promise(resolve => setTimeout(resolve, 20))
  const turn = async (uuid: string) => {
    await $.turn.start(turnStart())
    await $.session.append({ ...message(`Reply ${uuid}`), uuid })
    await $.turn.complete(turnEnd())
    await wait()
    return $.ui.mount(reply(`msg_${uuid}-t0`, `Reply ${uuid}`))
  }

  let ui = await turn('1')
  expect(await keys(ui)).toContain('review')
  await ui.press({ key: 'review' })
  await ui.unmount()

  ui = await turn('2')
  expect(await keys(ui)).not.toContain('review')
  await ui.unmount()

  fingerprint = 'h2'
  ui = await turn('3')
  expect(await keys(ui)).toContain('review')
  await ui.unmount()
})
