import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { TabScreen } from '../components/TabScreen'
import {
	clearEntries,
	currentSession,
	entriesFor,
	formatEntry,
	formatWhen,
	isCapturePaused,
	onEntries,
	sessions,
	setCapturePaused,
} from '../features/errlog'
import type { LogEntry, SessionMeta } from '../features/errlog'

const { Button, Stack, TableRow, TableRowGroup, TableSwitchRow } = Design

const MAX_ROWS = 100
const TOAST_KEY = 'shin.devlab.errors'

type Filter = 'errors' | 'warnings' | 'all'
const FILTERS: Array<{ id: Filter; label: string }> = [
	{ id: 'errors', label: 'Errors' },
	{ id: 'warnings', label: 'Warnings' },
	{ id: 'all', label: 'Everything' },
]

function rowIcon(...names: string[]) {
	const DesignAny = Design as any
	const Icon = DesignAny.TableRow?.Icon ?? DesignAny.TableRowIcon
	for (const name of names) {
		let Component: any
		try {
			Component = lookupGeneratedIconComponent(name)
		} catch {
			Component = undefined
		}
		if (!Component) continue
		if (Icon) return <Icon IconComponent={Component} />
		return <Component />
	}
	return undefined
}

function whoLabel(entry: LogEntry) {
	return (
		entry.plugin ??
		(entry.src === 'discord'
			? `Discord${entry.tag ? `/${entry.tag}` : ''}`
			: 'Discord')
	)
}

function sessionCounts(entries: LogEntry[]) {
	let errors = 0
	let warnings = 0
	for (const entry of entries) {
		if (entry.lvl === 'error' || entry.lvl === 'fatal') errors++
		else if (entry.lvl === 'warn') warnings++
	}
	return { errors, warnings }
}

function sessionLine(session: SessionMeta, entries: LogEntry[]) {
	const counts = sessionCounts(entries)
	const ending = session.clean
		? 'Ended normally'
		: session.crashed
			? 'Ended unexpectedly — crash recorded'
			: 'Ended unexpectedly'
	return [
		ending,
		counts.errors
			? `${counts.errors} error${counts.errors === 1 ? '' : 's'}`
			: null,
		counts.warnings
			? `${counts.warnings} warning${counts.warnings === 1 ? '' : 's'}`
			: null,
	]
		.filter(Boolean)
		.join(' · ')
}

function matches(entry: LogEntry, filter: Filter) {
	if (filter === 'all') return true
	if (filter === 'warnings') return entry.lvl === 'warn'
	return entry.lvl === 'error' || entry.lvl === 'fatal'
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
	const serious = entry.lvl === 'error' || entry.lvl === 'fatal'
	return (
		<TableRow
			icon={
				serious
					? rowIcon('CircleErrorIcon', 'CircleWarningIcon')
					: rowIcon('CircleInformationIcon', 'CircleErrorIcon')
			}
			label={entry.msg}
			labelLineClamp={2}
			subLabel={
				expanded
					? formatEntry(entry)
					: `${formatWhen(entry.t)} · ${whoLabel(entry)}${
							entry.repeats ? ` · ×${entry.repeats + 1}` : ''
						}`
			}
			subLabelLineClamp={expanded ? 30 : 1}
			trailing={
				<TableRow.TrailingText
					text={expanded ? 'Copy' : entry.lvl.toUpperCase()}
				/>
			}
			onPress={onPress}
		/>
	)
}

export function ErrorsTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [expanded, setExpanded] = React.useState<number | null>(null)
	const [filter, setFilter] = React.useState<Filter>('errors')
	const [selected, setSelected] = React.useState<string | null>(null)

	React.useEffect(() => onEntries(rerender), [])

	const all = sessions()
	const current = currentSession()
	const selectedSession =
		all.find(session => session.id === selected) ?? current
	const shown = entriesFor(selectedSession.id)
	const fatalAll = all.flatMap(session =>
		entriesFor(session.id).filter(entry => entry.lvl === 'fatal'),
	)
	const visible = shown
		.filter(entry => matches(entry, filter))
		.slice()
		.reverse()
	const filterIndex = FILTERS.findIndex(item => item.id === filter)
	const past = all
		.filter(session => session.id !== current.id)
		.slice()
		.reverse()

	const toast = (text: string, variant?: 'success' | 'critical') => {
		try {
			ToastActionCreators.open(TOAST_KEY, { text, variant })
		} catch {
			// Ignore.
		}
	}

	const handleEntryPress = (entry: LogEntry, index: number) => {
		if (expanded !== index) {
			setExpanded(index)
			return
		}
		Clipboard.setString(formatEntry(entry))
		setExpanded(null)
		toast('Entry copied.', 'success')
	}

	const handleCopyAll = () => {
		const text = shown.map(formatEntry).join('\n\n')
		Clipboard.setString(text || 'No log entries.')
		toast('Session log copied.', 'success')
	}

	return (
		<TabScreen>
			<TableRowGroup
				title="Session"
				description="Every session is kept with its log, so crashes and errors survive an app restart. Sessions that never ended cleanly are marked."
				hasIcons
			>
				<TableRow
					icon={rowIcon('ClockIcon', 'CircleInformationIcon')}
					label="This session"
					subLabel={sessionLine(current, entriesFor(current.id))}
					trailing={
						<TableRow.TrailingText
							text={selectedSession.id === current.id ? 'Viewing' : 'View'}
						/>
					}
					onPress={() => {
						setSelected(current.id)
						setExpanded(null)
					}}
				/>
				{past.map(session => (
					<TableRow
						key={session.id}
						icon={
							!session.clean || session.crashed
								? rowIcon('CircleErrorIcon', 'CircleWarningIcon')
								: rowIcon('CircleCheckIcon', 'CircleInformationIcon')
						}
						label={formatWhen(session.startedAt)}
						subLabel={sessionLine(session, entriesFor(session.id))}
						subLabelLineClamp={2}
						trailing={
							<TableRow.TrailingText
								text={selectedSession.id === session.id ? 'Viewing' : 'View'}
							/>
						}
						onPress={() => {
							setSelected(session.id)
							setExpanded(null)
						}}
					/>
				))}
			</TableRowGroup>

			{fatalAll.length > 0 && (
				<TableRowGroup title={`Crashes (${fatalAll.length})`}>
					{fatalAll
						.slice(-10)
						.reverse()
						.map((entry, index) => (
							<TableRow
								key={`${entry.t}-${index}`}
								icon={rowIcon('CircleErrorIcon', 'CircleWarningIcon')}
								label={entry.msg}
								labelLineClamp={2}
								subLabel={`${formatWhen(entry.t)} · ${whoLabel(entry)} · tap to copy`}
								subLabelLineClamp={1}
								onPress={() => Clipboard.setString(formatEntry(entry))}
							/>
						))}
				</TableRowGroup>
			)}

			<TableRowGroup title={`Log — ${formatWhen(selectedSession.startedAt)}`}>
				<TableRow
					label="Filter"
					subLabel="Errors shows errors and crashes first — the important stuff."
					trailing={<TableRow.TrailingText text={FILTERS[filterIndex].label} />}
					onPress={() =>
						setFilter(FILTERS[(filterIndex + 1) % FILTERS.length].id)
					}
				/>
				<TableSwitchRow
					label="Capture"
					subLabel="When off, new console output and errors are not recorded."
					value={!isCapturePaused()}
					onValueChange={value => setCapturePaused(!value)}
				/>
			</TableRowGroup>

			<Stack direction="horizontal" spacing={8}>
				<Button
					text="Copy session"
					variant="secondary"
					grow
					disabled={shown.length === 0}
					onPress={handleCopyAll}
				/>
				<Button
					text="Clear log"
					variant="destructive"
					grow
					disabled={shown.length === 0}
					onPress={() => {
						clearEntries()
						setExpanded(null)
					}}
				/>
			</Stack>

			<TableRowGroup
				title={`${FILTERS[filterIndex].label} (${visible.length})`}
			>
				{visible.length === 0 ? (
					<TableRow label="Nothing logged in this session." />
				) : (
					visible
						.slice(0, MAX_ROWS)
						.map((entry, index) => (
							<LogRow
								key={`${entry.t}-${index}`}
								entry={entry}
								expanded={expanded === index}
								onPress={() => handleEntryPress(entry, index)}
							/>
						))
				)}
				{visible.length > MAX_ROWS && (
					<TableRow
						label={`${visible.length - MAX_ROWS} older entries not shown. Narrow the filter or copy the session.`}
					/>
				)}
			</TableRowGroup>
		</TabScreen>
	)
}
