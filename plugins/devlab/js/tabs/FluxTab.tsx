import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { SearchField } from '../components/SearchField'
import { TabScreen } from '../components/TabScreen'
import {
	addFluxLogListener,
	clearFluxLog,
	getFluxLog,
	getFluxTypeCounts,
	isFluxPaused,
	MAX_FLUX_LOG,
	serializeFluxEntry,
	setFluxPaused,
} from '../features/fluxlog'
import type { FluxLogEntry } from '../features/fluxlog'

const { Button, Stack, TableRow, TableRowGroup, TableSwitchRow } = Design

const formatTime = (timestamp: number) =>
	new Date(timestamp).toLocaleTimeString()

export function FluxTab() {
	const [filter, setFilter] = React.useState('')
	const [log, setLog] = React.useState<FluxLogEntry[]>(getFluxLog)
	const [paused, setPaused] = React.useState(isFluxPaused)
	const [expandedId, setExpandedId] = React.useState<string | null>(null)

	React.useEffect(() => addFluxLogListener(() => setLog(getFluxLog())), [])

	const counts = React.useMemo(() => getFluxTypeCounts(), [log])

	const handleTogglePause = (value: boolean) => {
		setFluxPaused(value)
		setPaused(value)
	}

	const handleClear = () => {
		clearFluxLog()
		setLog([])
		setExpandedId(null)
	}

	const handleCopyLog = () => {
		const text = log
			.map(
				entry =>
					`[${formatTime(entry.timestamp)}] ${entry.type}\n${serializeFluxEntry(entry)}`,
			)
			.join('\n\n---\n\n')
		Clipboard.setString(text || 'No events.')
	}

	const handleEntryPress = (entry: FluxLogEntry) => {
		if (expandedId !== entry.id) return setExpandedId(entry.id)
		Clipboard.setString(`${entry.type}\n${serializeFluxEntry(entry)}`)
		setExpandedId(null)
	}

	const needle = filter.toLowerCase()
	const filtered = log.filter(
		entry =>
			needle === '' ||
			entry.type.toLowerCase().includes(needle) ||
			entry.summary.toLowerCase().includes(needle),
	)

	return (
		<TabScreen>
			<TableRowGroup
				title="Flux Tracker"
				description="Logs every dispatch through the Flux dispatcher while DevLab is loaded."
			>
				<TableRow
					label="Captured events"
					trailing={<TableRow.TrailingText text={String(log.length)} />}
				/>
				<TableRow
					label="Distinct action types"
					trailing={<TableRow.TrailingText text={String(counts.length)} />}
				/>
			</TableRowGroup>

			<TableSwitchRow
				label="Pause capturing"
				subLabel="Dispatches keep flowing in Discord; they just are not recorded."
				value={paused}
				onValueChange={handleTogglePause}
			/>

			<Stack direction="horizontal" spacing={8}>
				<Button
					text="Copy log"
					variant="secondary"
					grow
					disabled={log.length === 0}
					onPress={handleCopyLog}
				/>
				<Button
					text="Clear log"
					variant="destructive"
					grow
					disabled={log.length === 0}
					onPress={handleClear}
				/>
			</Stack>

			<SearchField
				value={filter}
				onChange={setFilter}
				placeholder="Filter by action type or payload"
			/>

			{counts.length > 0 && (
				<TableRowGroup title={`Most dispatched (${counts.length})`}>
					{counts.slice(0, 8).map(([type, count]) => (
						<TableRow
							key={type}
							label={type}
							trailing={<TableRow.TrailingText text={String(count)} />}
							onPress={() => setFilter(type)}
						/>
					))}
				</TableRowGroup>
			)}

			<TableRowGroup title={`Event log (${filtered.length}/${MAX_FLUX_LOG})`}>
				{filtered.length === 0 ? (
					<TableRow
						label={log.length === 0 ? 'No events yet.' : 'No events matched.'}
						subLabel={
							log.length === 0
								? 'Dispatches appear here as they happen. The log stays available when you leave this screen.'
								: 'Widen the filter to see more.'
						}
					/>
				) : (
					filtered.map(entry => {
						const expanded = expandedId === entry.id
						return (
							<TableRow
								key={entry.id}
								label={entry.type}
								subLabel={
									expanded
										? `${formatTime(entry.timestamp)}\n\n${serializeFluxEntry(entry)}`
										: `${formatTime(entry.timestamp)}${entry.summary ? ` · ${entry.summary}` : ''}`
								}
								subLabelLineClamp={expanded ? 30 : 2}
								trailing={
									<TableRow.TrailingText text={expanded ? 'Copy' : 'Details'} />
								}
								onPress={() => handleEntryPress(entry)}
							/>
						)
					})
				)}
			</TableRowGroup>
		</TabScreen>
	)
}
