import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionMessage } from 'claude-code'

const PANE = 'chat-outline'
const TITLE = 'Outline'
const DEFAULT_MAX_CHARS = 1000

// Bumped whenever the main conversation gains a prompt or is cleared, so the
// pane (which reads it while drawing) is drawn again and re-reads the rows.
const revision = atom({ plugin: 'chat-outline', key: 'revision' } as const, 0, {
    shape: 'revision-1',
})

type Query = { turn: number; uuid: string; text: string }

// A user row the person typed: has text, carries no tool results, and is not
// an engine-made wrapper such as a slash command record or a reminder.
const isQuery = (row: SessionMessage): boolean =>
    row.role === 'user' &&
    (row.toolResults ?? []).length === 0 &&
    row.text.trim() !== '' &&
    !row.text.trimStart().startsWith('<')

const toQueries = (rows: readonly SessionMessage[]): Query[] =>
    rows
        .filter(isQuery)
        .flatMap(row => (row.uuid === undefined ? [] : [{ uuid: row.uuid, text: row.text }]))
        .map((row, index) => ({ turn: index + 1, ...row }))

const truncate = (text: string, max: number): string => {
    const trimmed = text.trim()

    return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`
}

// The `maxQueryChars` option: a positive whole number, or the manifest's
// default when unset. Anything else is reported in the pane, not replaced.
const maxCharsFrom = (raw: unknown): number | { error: string } => {
    if (raw === undefined) {
        return DEFAULT_MAX_CHARS
    }
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
        return raw
    }

    return { error: `maxQueryChars must be a positive whole number, got ${JSON.stringify(raw)}` }
}

// The `autoOpen` option: whether the pane opens when a session starts; true
// when unset. Anything else is reported in the pane, not replaced.
const autoOpenFrom = (raw: unknown): boolean | { error: string } => {
    if (raw === undefined) {
        return true
    }
    if (typeof raw === 'boolean') {
        return raw
    }

    return { error: `autoOpen must be true or false, got ${JSON.stringify(raw)}` }
}

// Row timestamps, read from the session's transcript file (JSONL, one row per
// line, each with `uuid` and `timestamp`). Read incrementally: only the bytes
// added since the last read, up to the last complete line.
const stamps = new Map<string, string>()
const transcript = { path: '', offset: 0, unreadableLines: 0 }

const loadStamps = async ($: EngineInterface): Promise<string | undefined> => {
    const { transcriptPath } = await $.session.info()
    if (transcriptPath === '') {
        return 'this session keeps no transcript file'
    }
    if (transcriptPath !== transcript.path) {
        transcript.path = transcriptPath
        transcript.offset = 0
        transcript.unreadableLines = 0
        stamps.clear()
    }
    const { size } = await $.fs.stat(transcriptPath)
    if (size < transcript.offset) {
        transcript.offset = 0
    }
    if (size === transcript.offset) {
        return undefined
    }
    const text = await $.fs.read(transcriptPath, {
        offset: transcript.offset,
        length: size - transcript.offset,
    })
    const end = text.lastIndexOf('\n')
    if (end < 0) {
        return undefined
    }
    const complete = text.slice(0, end + 1)
    transcript.offset += new TextEncoder().encode(complete).length
    for (const line of complete.split('\n')) {
        if (line.trim() === '') {
            continue
        }
        let row: unknown
        try {
            row = JSON.parse(line)
        } catch {
            transcript.unreadableLines += 1
            continue
        }
        if (typeof row === 'object' && row !== null) {
            const { uuid, timestamp } = row as { uuid?: unknown; timestamp?: unknown }
            if (typeof uuid === 'string' && typeof timestamp === 'string') {
                stamps.set(uuid, timestamp)
            }
        }
    }

    return undefined
}

const pad = (n: number): string => String(n).padStart(2, '0')

// Local time, with the date added when it is not today.
const formatStamp = (iso: string, now: Date): string => {
    const at = new Date(iso)
    if (Number.isNaN(at.getTime())) {
        return iso
    }
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
    const isToday = at.toDateString() === now.toDateString()

    return isToday ? time : `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`
}

export const register: Register = (on, options) => {
    const maxChars = maxCharsFrom(options['maxQueryChars'])
    const autoOpen = autoOpenFrom(options['autoOpen'])

    on('session.start', async ($, e, next) => {
        await $.command.register({
            name: 'outline',
            description: 'Show the conversation outline pane',
        })
        const started = await next(e)
        // An invalid value opens the pane too, so the error it draws is seen.
        if (autoOpen !== false) {
            void $.ui.open({ id: PANE, title: TITLE })
        }

        return started
    })

    on('command.run', { command: 'outline' }, async $ => {
        await update($, revision, n => n + 1)
        const opened = await $.ui.open({ id: PANE, title: TITLE })

        return {
            text: opened.isPlaced
                ? 'Outline pane opened.'
                : `Outline pane not shown: ${opened.reason}`,
        }
    })

    on('session.append', async ($, e, next) => {
        const stored = await next(e)
        if (e.agentId === undefined && e.door === 'prompt') {
            await update($, revision, n => n + 1)
        }

        return stored
    }).catch(($, e, next) => next(e))

    on('session.end', async ($, e, next) => {
        const ended = await next(e)
        if (e.reason === 'clear') {
            await update($, revision, n => n + 1)
        }

        return ended
    })

    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
        const { Box, Text } = $.ui.resolve(e)
        await read($, revision)

        if (typeof autoOpen !== 'boolean') {
            return <Text color="red">{autoOpen.error}</Text>
        }
        if (typeof maxChars !== 'number') {
            return <Text color="red">{maxChars.error}</Text>
        }

        const rows = await $.session.messages({ last: 4096 })
        if (!Array.isArray(rows)) {
            return <Text color="red">Could not read the conversation: {rows.deny}</Text>
        }

        const queries = toQueries(rows)
        if (queries.length === 0) {
            return <Text dimColor>No prompts yet.</Text>
        }

        const stampError = await loadStamps($).catch(
            (error: unknown) => `could not read the transcript (${String(error)})`,
        )
        const now = new Date()
        const rule = '-'.repeat(Math.max(4, e.props.bodyColumns))

        return (
            <Box flexDirection="column">
                {stampError !== undefined && (
                    <Box marginBottom={1}>
                        <Text dimColor>Timestamps unavailable: {stampError}</Text>
                    </Box>
                )}
                {queries.map((query, index) => {
                    const stamp = stamps.get(query.uuid)

                    return (
                        <Box key={query.uuid} flexDirection="column">
                            {index > 0 && <Text dimColor>{rule}</Text>}
                            <Text>
                                <Text bold color="cyan">{`#${query.turn}`}</Text>
                                {stamp !== undefined && (
                                    <Text dimColor>{`  ${formatStamp(stamp, now)}`}</Text>
                                )}
                            </Text>
                            <Text wrap="wrap">{truncate(query.text, maxChars)}</Text>
                        </Box>
                    )
                })}
                {transcript.unreadableLines > 0 && (
                    <Box marginTop={1}>
                        <Text dimColor>
                            {`${transcript.unreadableLines} transcript line(s) could not be parsed`}
                        </Text>
                    </Box>
                )}
            </Box>
        )
    })
}
