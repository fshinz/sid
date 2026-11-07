import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { TabScreen } from '../components/TabScreen'
import {
	clearEntries,
	entries,
	formatEntry,
	isCapturePaused,
	logCounts,
	onEntries,
	setCapturePaused,
} from '../features/errlog'
import type { LogEntry } from '../features/errlog'

const { Button, Stack, TableRow, TableRowGroup, TableSwitchRow } = Design

const MAX_ROWS = 120
const TOAST_KEY = 'shin.devlab.errors'

type Filter = 'all' | 'errors' | 'warnings'
const FILTERS: Array<{ id: Filter; label: string }> = [
	{ id: 'all', label: 'All' },
	{ id: 'errors', label: 'Errors' },
	{ id: 'warnings', label: 'Warnings' },
]

function levelLabel(entry: LogEntry) {
	if (entry.lvl === 'fatal') return 'FATAL'
	return entry.lvl.toUpperCase()
}

function whoLabel(entry: LogEntry) {
	return (
		entry.plugin ??
		(entry.src === 'discord'
			? `Discord${entry.tag ? `/${entry.tag}` : ''}`
			: 'Discord')
	)
}

function headLine(entry: LogEntry) {
	const time = new Date(entry.t).toLocaleTimeString()
	return `${time} · ${levelLabel(entry)} · ${whoLabel(entry)}${
		entry.repeats ? ` (×${entry.repeats + 1})` : ''
	}`
}

function matches(entry: LogEntry, filter: Filter) {
	if (filter === 'all') return true
	if (filter === 'errors') return entry.lvl === 'error' || entry.lvl === 'fatal'
	return entry.lvl === 'warn'
}

function LogRow({
	entry,
	expanded,
	onPress,
}: {
	entry: LogEntry
	expanded: boolean
	onPress: () => void
}) {
	return (
		<TableRow
			label={headLine(entry)}
			subLabel={expanded ? formatEntry(entry) : entry.msg}
			subLabelLineClamp={expanded ? 30 : 2}
			trailing={
				<TableRow.TrailingText text={expanded ? 'Copy' : levelLabel(entry)} />
			}
			onPress={onPress}
		/>
	)
}

export function ErrorsTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [expanded, setExpanded] = React.useState<number | null>(null)
	const [filter, setFilter] = React.useState<Filter>('all')

	React.useEffect(() => onEntries(rerender), [])

	const all = entries()
	const counts = logCounts()
	const visible = all
		.filter(entry => matches(entry, filter))
		.slice()
		.reverse()
	const paused = isCapturePaused()

	const toast = (text: string, variant?: 'success' | 'critical') => {
		try {
			ToastActionCreators.open(TOAST_KEY, { text, variant })
		} catch {
			// Ignore.
		}
	}

	const handleRowPress = (entry: LogEntry, index: number) => {
		if (expanded !== index) {
			setExpanded(index)
			return
		}
		Clipboard.setString(formatEntry(entry))
		setExpanded(null)
		toast('Entry copied.', 'success')
	}

	const handleCopyAll = () => {
		const text = visible.map(formatEntry).join('\n\n')
		Clipboard.setString(text || 'No log entries.')
		toast('Log copied.', 'success')
	}

	const handleClear = () => {
		clearEntries()
		setExpanded(null)
	}

	const filterIndex = FILTERS.findIndex(item => item.id === filter)

	return (
		<TabScreen>
			<TableRowGroup
				title="Log"
				description="Everything the client logs — console, Discord's logger, and uncaught errors — with plugin attribution. Live: new entries appear as they happen."
			>
				<TableRow
					label="Errors"
					trailing={<TableRow.TrailingText text={String(counts.errors)} />}
				/>
				<TableRow
					label="Warnings"
					trailing={<TableRow.TrailingText text={String(counts.warnings)} />}
				/>
				<TableRow
					label="Total entries"
					trailing={<TableRow.TrailingText text={String(counts.total)} />}
				/>
				<TableSwitchRow
					label="Capture"
					subLabel="When off, new console output and errors are not recorded."
					value={!paused}
					onValueChange={value => setCapturePaused(!value)}
				/>
				<TableRow
					label="Filter"
					subLabel="Tap to cycle what the list below shows."
					trailing={<TableRow.TrailingText text={FILTERS[filterIndex].label} />}
					onPress={() =>
						setFilter(FILTERS[(filterIndex + 1) % FILTERS.length].id)
					}
				/>
			</TableRowGroup>

			<Stack direction="horizontal" spacing={8}>
				<Button
					text="Copy all"
					variant="secondary"
					grow
					disabled={visible.length === 0}
					onPress={handleCopyAll}
				/>
				<Button
					text="Clear"
					variant="destructive"
					grow
					disabled={all.length === 0}
					onPress={handleClear}
				/>
			</Stack>

			<TableRowGroup
				title={`${FILTERS[filterIndex].label} (${visible.length})`}
			>
				{visible.length === 0 ? (
					<TableRow label="Nothing logged yet." />
				) : (
					visible
						.slice(0, MAX_ROWS)
						.map((entry, index) => (
							<LogRow
								key={`${entry.t}-${index}`}
								entry={entry}
								expanded={expanded === index}
								onPress={() => handleRowPress(entry, index)}
							/>
						))
				)}
				{visible.length > MAX_ROWS && (
					<TableRow
						label={`${visible.length - MAX_ROWS} older entries not shown. Narrow the filter or copy all.`}
					/>
				)}
			</TableRowGroup>
		</TabScreen>
	)
}
