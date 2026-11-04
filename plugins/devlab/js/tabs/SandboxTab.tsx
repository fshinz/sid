import { Design } from '@valenced/discord/design'
import { nodeUtil } from '@valenced/externals/browserify'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import { getErrorStack } from '@valenced/utils/error'
import { pluginApi } from '../api'
import { TabScreen } from '../components/TabScreen'

const {
	Button,
	Card,
	Stack,
	TableRow,
	TableRowGroup,
	TableSwitchRow,
	Text,
	TextArea,
} = Design

const MAX_HISTORY = 30

type HistoryEntry = {
	id: number
	code: string
	result: string
	ok: boolean
	ts: number
}

type HistoryListener = (entries: HistoryEntry[]) => void

const QUICK_ACTIONS = [
	{
		label: 'List Flux stores',
		code: 'return Object.keys(valenced?.discord?.flux?.Stores ?? {}).sort()',
	},
	{
		label: 'Selected channel ID',
		code: 'return valenced?.discord?.flux?.Stores?.SelectedChannelStore?.getChannelId?.() ?? null',
	},
	{
		label: 'Selected guild ID',
		code: 'return valenced?.discord?.flux?.Stores?.SelectedGuildStore?.getGuildId?.() ?? null',
	},
	{
		label: 'Plugin API keys',
		code: 'return Object.keys(api ?? {}).sort()',
	},
]

// Lets snippets use top-level await.
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	...args: string[]
) => (...args: any[]) => Promise<any>

// History is module-level so it survives leaving the DevLab screen.
let history: HistoryEntry[] = []
let nextHistoryId = 0
const historyListeners = new Set<HistoryListener>()

function setHistory(entries: HistoryEntry[]) {
	history = entries
	for (const listener of [...historyListeners]) listener(history)
}

function addToHistory(code: string, result: string, ok: boolean) {
	const entry = { id: nextHistoryId++, code, result, ok, ts: Date.now() }
	setHistory([entry, ...history].slice(0, MAX_HISTORY))
}

export function SandboxTab() {
	const { ScrollView } = ReactNative

	// The ref keeps Run reading the latest text even when pressed mid-edit.
	const codeRef = React.useRef('')
	const [code, setCode] = React.useState('')
	const [result, setResult] = React.useState('')
	const [resultOk, setResultOk] = React.useState(true)
	const [wordWrap, setWordWrap] = React.useState(true)
	const [running, setRunning] = React.useState(false)
	const [entries, setEntries] = React.useState(history)

	React.useEffect(() => {
		historyListeners.add(setEntries)
		setEntries(history)
		return () => {
			historyListeners.delete(setEntries)
		}
	}, [])

	const loadCode = (value: string) => {
		codeRef.current = value
		setCode(value)
	}

	const run = async () => {
		const source = codeRef.current.trim()
		if (!source || running) return

		codeRef.current = source
		setRunning(true)

		try {
			if (!pluginApi) {
				throw new Error(
					'DevLab plugin API is not available. Try reloading the plugin.',
				)
			}

			const execute = new AsyncFunction(
				'api',
				'valenced',
				`"use strict";\n${source}\n//# sourceURL=Valenced:DevLab:Sandbox`,
			)
			const value = await execute(pluginApi, (globalThis as any).valenced)

			const output =
				value === undefined
					? 'undefined'
					: nodeUtil.inspect(value, {
							depth: 4,
							showHidden: false,
							maxArrayLength: 100,
							maxStringLength: 10000,
						})

			setResult(output)
			setResultOk(true)
			addToHistory(source, output, true)
		} catch (error) {
			const stack = getErrorStack(error)
			setResult(stack)
			setResultOk(false)
			addToHistory(source, stack, false)
		} finally {
			setRunning(false)
		}
	}

	const handleClear = () => {
		loadCode('')
		setResult('')
		setResultOk(true)
	}

	return (
		<TabScreen>
			<TextArea
				autoFocus={false}
				label="JavaScript"
				value={code}
				onChange={(value: string) => loadCode(value)}
				placeholder={
					'return Object.keys(valenced.discord.flux.Stores)\n\n// Async works automatically:\nreturn await Promise.resolve("hello")'
				}
				size="md"
			/>

			<TableRowGroup title="Quick actions">
				{QUICK_ACTIONS.map(action => (
					<TableRow
						key={action.label}
						label={action.label}
						trailing={<TableRow.TrailingText text="Load" />}
						onPress={() => {
							loadCode(action.code)
							setResult(`Loaded: ${action.label}\nPress Run to execute.`)
							setResultOk(true)
						}}
					/>
				))}
			</TableRowGroup>

			<Stack direction="horizontal" spacing={8}>
				<Button
					text={running ? 'Running…' : 'Run'}
					variant="primary"
					grow
					disabled={running}
					onPress={run}
				/>
				<Button text="Clear" variant="secondary" onPress={handleClear} />
			</Stack>

			<TableRowGroup title="Output options">
				<TableSwitchRow
					label="Word wrap"
					subLabel="Wrap long output lines."
					value={wordWrap}
					onValueChange={setWordWrap}
				/>
			</TableRowGroup>

			<Stack spacing={8}>
				<Text
					variant="heading-sm/semibold"
					color={resultOk ? 'text-strong' : 'text-danger'}
				>
					{resultOk ? 'Result' : 'Error'}
				</Text>

				<Card>
					<ScrollView nestedScrollEnabled style={{ maxHeight: 320 }}>
						<ScrollView nestedScrollEnabled horizontal={!wordWrap}>
							<Text selectable style={{ fontFamily: 'monospace' }}>
								{result || 'Run code to see its output.'}
							</Text>
						</ScrollView>
					</ScrollView>
				</Card>

				{result && (
					<Button
						text="Copy result"
						variant="secondary"
						onPress={() => Clipboard.setString(result)}
					/>
				)}
			</Stack>

			<TableRowGroup title={`History (${entries.length}/${MAX_HISTORY})`}>
				{entries.length === 0 ? (
					<TableRow
						label="No runs yet."
						subLabel="Recent results stay available when you navigate away from DevLab."
					/>
				) : (
					entries.map(entry => (
						<TableRow
							key={entry.id}
							label={
								entry.code.length > 64
									? `${entry.code.slice(0, 64)}…`
									: entry.code
							}
							subLabel={`${new Date(entry.ts).toLocaleTimeString()} · ${entry.ok ? 'Success' : 'Error'} · ${entry.result.slice(0, 90)}`}
							subLabelLineClamp={2}
							onPress={() => {
								loadCode(entry.code)
								setResult(entry.result)
								setResultOk(entry.ok)
							}}
						/>
					))
				)}
			</TableRowGroup>

			{entries.length > 0 && (
				<Button
					text="Clear history"
					variant="destructive"
					onPress={() => setHistory([])}
				/>
			)}
		</TabScreen>
	)
}
