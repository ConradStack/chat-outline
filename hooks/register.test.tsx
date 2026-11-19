import { expect, test } from 'claude-code/testing'
import type { SessionMessage } from 'claude-code'

const PANE = {
    plugin: 'chat-outline',
    component: 'Pane',
    requestId: 'chat-outline',
    props: {
        title: 'Outline',
        isFocused: false,
        bodyColumns: 60,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 20 },
        view: {},
    },
} as const

const LONG = 'x'.repeat(1200)

const ROWS: SessionMessage[] = [
    { role: 'user', text: 'How do I sort a list?', toolUses: [], uuid: 'u1' },
    { role: 'assistant', text: 'Let me check.', toolUses: [], uuid: 'a1' },
    { role: 'user', text: '', toolUses: [], toolResults: [], uuid: 'r1' },
    { role: 'assistant', text: 'Use sorted().', toolUses: [], uuid: 'a2' },
    { role: 'user', text: '<command-name>/clear</command-name>', toolUses: [], uuid: 'c1' },
    { role: 'user', text: LONG, toolUses: [], uuid: 'u2' },
]

const TRANSCRIPT =
    [
        JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2020-01-02T03:04:00.000Z' }),
        JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2020-01-02T03:05:00.000Z' }),
    ].join('\n') + '\n'

test('lists only prompts, whole up to the limit, with their time', async ($, on) => {
    on('session.messages', () => ({ value: ROWS }))
    on('session.info', () => ({ value: { transcriptPath: '/t.jsonl' } }))
    on('fs.stat', () => ({ value: { kind: 'file', size: TRANSCRIPT.length, mtimeMs: 0, isLink: false } }))
    on('fs.read', () => ({ value: TRANSCRIPT }))

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

    expect(texts).toContain('How do I sort a list?')
    expect(texts).toContain(`${'x'.repeat(1000)}...`)
    // Shown in local time, so only the form is fixed; not today, so dated.
    expect(texts.some(t => /^#1 {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t))).toBe(true)
    expect(texts).toContain('#2')
    expect(texts.some(t => t.startsWith('#2') && t !== '#2')).toBe(false)
    expect(texts.some(t => t.includes('sorted()') || t.includes('Let me check'))).toBe(false)
    await ui.unmount()
})

test('an empty conversation says so', async ($, on) => {
    on('session.messages', () => ({ value: [] }))

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect((await ui.find({ type: 'Text' }))?.text).toBe('No prompts yet.')
    await ui.unmount()
})
