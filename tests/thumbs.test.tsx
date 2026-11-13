import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { THUMBS_DOWN, THUMBS_UP } from '../hooks/register'

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
    expect(await latest.findAll({ type: 'Button' })).toHaveLength(2)
    await latest.unmount()

    const older = await $.ui.mount(reply('old', 'Old reply', surface))
    expect(await older.findAll({ type: 'Button' })).toHaveLength(0)
    await older.unmount()
  }
})

test('matches the latest reply by its text when the ids differ', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Done.\n\nAll  set'), uuid: 'row-1' })
  await $.turn.complete(turnEnd())

  const ui = await $.ui.mount(reply('other-id', 'Done. All set'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await ui.unmount()
})

test('no buttons while Claude is working', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.append({ ...message('Working on it'), uuid: 'a' })
  await $.prompt.submit(typed('next thing'))

  const ui = await $.ui.mount(reply('a', 'Working on it'))
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  await ui.unmount()
})

test('a subagent finishing does not show the buttons mid-turn', async ($, on) => {
  engine(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.append({ ...message('Main reply'), uuid: 'm' })
  await $.prompt.submit(typed('go'))
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
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
  await ui.unmount()
})

test('pressing a thumb sends the reply and hides the buttons', async ($, on) => {
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
