import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { SearchField } from '../components/SearchField'
import { TabScreen } from '../components/TabScreen'
import {
	addWatchListener,
	clearAllWatches,
	clearWatchLog,
	getAllStoreNames,
	getWatchedStores,
	getWatchLog,
	MAX_LOG,
	unwatchStore,
	watchStore,
} from '../features/livewatch'
import type { WatchEntry } from '../features/livewatch'

const { Button, Stack, TableRow, TableRowGroup } = Design

const MAX_PICKER_ITEMS = 100

const formatTime = (timestamp: number) =>
	new Date(timestamp).toLocaleTimeString()

export function WatchTab() {
	const [storeFilter, setStoreFilter] = React.useState('')
	const [watched, setWatched] = React.useState(getWatchedStores)
	const [log, setLog] = React.useState<WatchEntry[]>(getWatchLog)
	const [expandedId, setExpandedId] = React.useState<string | null>(null)
	const [showPicker, setShowPicker] = React.useState(false)

	// Re-read the store list each time the picker opens.
	const allStores = React.useMemo(() => getAllStoreNames(), [showPicker])

	React.useEffect(
		() =>
			addWatchListener(() => {
				setLog(getWatchLog())
				setWatched(getWatchedStores())
			}),
		[],
	)

	const syncWatches = () => {
		setWatched(getWatchedStores())
		setLog(getWatchLog())
	}

	const toggleStore = (name: string) => {
		if (watched.includes(name)) unwatchStore(name)
		else watchStore(name)
		syncWatches()
	}

	const handleClearLog = () => {
		clearWatchLog()
		setLog([])
		setExpandedId(null)
	}

	const handleCopyLog = () => {
		const text = log
			.map(
				entry =>
					`[${formatTime(entry.timestamp)}] ${entry.storeName}\n${entry.snapshot}`,
			)
			.join('\n\n---\n\n')
		Clipboard.setString(text || 'No events.')
	}

	const handleStopAll = () => {
		clearAllWatches()
		syncWatches()
	}

	const handleEntryPress = (entry: WatchEntry) => {
		if (expandedId !== entry.id) return setExpandedId(entry.id)

		Clipboard.setString(entry.snapshot)
		setExpandedId(null)
	}

	const needle = storeFilter.toLowerCase()
	const filtered = allStores.filter(name => name.toLowerCase().includes(needle))

	return (
		<TabScreen>
			<TableRowGroup title={`Available stores (${allStores.length})`}>
				{allStores.length === 0 ? (
					<TableRow
						label="Flux store registry not found."
						subLabel="The store registry is not exposed by the current client."
					/>
				) : (
					<TableRow
						label={showPicker ? 'Hide store list' : 'Browse & pick stores'}
						subLabel="Choose stores to monitor for changes."
						arrow
						onPress={() => setShowPicker(value => !value)}
					/>
				)}
			</TableRowGroup>

			{showPicker && allStores.length > 0 && (
				<>
					<SearchField
						value={storeFilter}
						onChange={setStoreFilter}
						placeholder="Filter stores"
					/>
					<TableRowGroup title="Pick stores to watch">
						{filtered.slice(0, MAX_PICKER_ITEMS).map(name => (
							<TableRow
								key={name}
								label={name}
								trailing={
									<TableRow.TrailingText
										text={watched.includes(name) ? 'Watching' : 'Watch'}
									/>
								}
								onPress={() => toggleStore(name)}
							/>
						))}
						{filtered.length > MAX_PICKER_ITEMS && (
							<TableRow
								label={`${filtered.length - MAX_PICKER_ITEMS} more. Narrow the filter to see them.`}
							/>
						)}
					</TableRowGroup>
				</>
			)}

			{watched.length > 0 && (
				<TableRowGroup title={`Watching (${watched.length})`}>
					{watched.map(name => (
						<TableRow
							key={name}
							label={name}
							trailing={<TableRow.TrailingText text="Stop" />}
							onPress={() => toggleStore(name)}
						/>
					))}
				</TableRowGroup>
			)}

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
					variant="secondary"
					grow
					disabled={log.length === 0}
					onPress={handleClearLog}
				/>
			</Stack>

			{watched.length > 0 && (
				<Button
					text="Stop all watches"
					variant="destructive"
					onPress={handleStopAll}
				/>
			)}

			<TableRowGroup title={`Event log (${log.length}/${MAX_LOG})`}>
				{log.length === 0 ? (
					<TableRow
						label={watched.length === 0 ? 'No events yet.' : 'Watching stores…'}
						subLabel={
							watched.length === 0
								? 'Select a store above to begin.'
								: 'Changes will appear here. The log stays available when you leave this screen.'
						}
					/>
				) : (
					log.map(entry => {
						const expanded = expandedId === entry.id
						return (
							<TableRow
								key={entry.id}
								label={entry.storeName}
								subLabel={
									expanded
										? `${formatTime(entry.timestamp)}\n\n${entry.snapshot}`
										: `${formatTime(entry.timestamp)} · ${entry.snapshot.slice(0, 100)}`
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
