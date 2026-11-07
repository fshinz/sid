import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
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

const {
	Card,
	TableRadioGroup,
	TableRadioRow,
	TableRow,
	TableRowGroup,
	TableSwitchRow,
	Text,
	TextInput,
} = Design
const { Pressable, ScrollView, Share, View, useWindowDimensions } = ReactNative

const SHOWN = 300

type Severity = 'all' | 'warn' | 'error'
type Picking = 'level' | 'who'

const SEVERE: Record<Severity, (level: string) => boolean> = {
	all: () => true,
	warn: level => level === 'warn' || level === 'error' || level === 'fatal',
	error: level => level === 'error' || level === 'fatal',
}

const LEVEL_LABEL: Record<Severity, string> = {
	all: 'Everything',
	warn: 'Warnings and errors',
	error: 'Errors',
}

const DISCORD = '(discord)'

function whoWrote(entry: LogEntry) {
	return entry.plugin ?? DISCORD
}

function colourFor(level: string) {
	if (level === 'error' || level === 'fatal') return 'text-feedback-critical'
	if (level === 'warn') return 'text-feedback-warning'
	if (level === 'debug') return 'text-muted'
	return 'text-default'
}

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

function statusOf(session: SessionMeta) {
	if (session.clean) return 'Ended normally'
	if (session.crashed) return 'Crash recorded'
	if (session.id === currentSession().id) return 'Running now'
	return 'Ended unexpectedly'
}

export function ErrorsTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [severity, setSeverity] = React.useState<Severity>('warn')
	const [who, setWho] = React.useState('all')
	const [picking, setPicking] = React.useState<Picking | undefined>()
	const [query, setQuery] = React.useState('')
	const [selected, setSelected] = React.useState<string | null>(null)

	// Throttled live updates — bursts of log calls must not re-render
	// per entry.
	React.useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined
		const off = onEntries(() => {
			if (!timer) {
				timer = setTimeout(() => {
					timer = undefined
					rerender()
				}, 500)
			}
		})
		return () => {
			off()
			if (timer) clearTimeout(timer)
		}
	}, [])

	const all = sessions()
	const current = currentSession()
	const selectedSession =
		all.find(session => session.id === selected) ?? current
	const shownEntries = entriesFor(selectedSession.id)
	const past = all
		.filter(session => session.id !== current.id)
		.slice()
		.reverse()

	const writers = [...new Set(shownEntries.map(whoWrote))].sort()
	const needle = query.trim().toLowerCase()
	const matching = shownEntries.filter(
		entry =>
			SEVERE[severity](entry.lvl) &&
			(who === 'all' || whoWrote(entry) === who) &&
			(!needle ||
				`${entry.msg} ${entry.plugin ?? ''} ${entry.tag ?? ''}`
					.toLowerCase()
					.includes(needle)),
	)
	const total = matching.length
	const lines = matching.slice(-SHOWN).reverse()

	const shownText = () =>
		lines.length
			? `DevLab log · ${formatWhen(selectedSession.startedAt)}\n${lines
					.map(formatEntry)
					.join('\n')}`
			: ''

	const handleCopyShown = () => {
		const text = shownText()
		try {
			Clipboard.setString(text || 'Nothing to copy.')
		} catch {
			// Ignore.
		}
	}

	const handleShareShown = () => {
		const text = shownText()
		if (!text) return
		try {
			void Share.share({ message: text })
		} catch {
			// Ignore.
		}
	}

	const handleClear = () => {
		clearEntries()
		setWho('all')
		setQuery('')
	}

	const toggle = (which: Picking) =>
		setPicking(picking === which ? undefined : which)
	const logHeight = Math.max(
		280,
		Math.round(useWindowDimensions().height * 0.55),
	)

	return (
		<TabScreen>
			<TableRowGroup hasIcons>
				<TableRow
					icon={
						selectedSession.clean
							? rowIcon('CircleCheckIcon', 'CircleInformationIcon')
							: rowIcon('CircleErrorIcon', 'CircleWarningIcon')
					}
					label={statusOf(selectedSession)}
					subLabel={`Started ${formatWhen(selectedSession.startedAt)}${
						selectedSession.crashed ? ' · a crash was recorded' : ''
					} · ${sessionLine(selectedSession, shownEntries)}`}
					subLabelLineClamp={2}
				/>
			</TableRowGroup>

			<TableRowGroup
				title="Sessions"
				description="Kept across restarts, so crashes and errors survive an app restart. Tap to view a session's log."
			>
				<TableRow
					icon={rowIcon('ClockIcon', 'CircleInformationIcon')}
					label="This session"
					subLabel={sessionLine(current, entriesFor(current.id))}
					subLabelLineClamp={1}
					trailing={
						<TableRow.TrailingText
							text={selectedSession.id === current.id ? 'Viewing' : 'View'}
						/>
					}
					onPress={() => {
						setSelected(current.id)
						setWho('all')
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
						subLabelLineClamp={1}
						trailing={
							<TableRow.TrailingText
								text={selectedSession.id === session.id ? 'Viewing' : 'View'}
							/>
						}
						onPress={() => {
							setSelected(session.id)
							setWho('all')
						}}
					/>
				))}
			</TableRowGroup>

			<TableRowGroup title="Show">
				<TableRow
					label="Level"
					subLabel={LEVEL_LABEL[severity]}
					arrow
					onPress={() => toggle('level')}
				/>
				{writers.length > 1 && (
					<TableRow
						label="Written by"
						subLabel={who === 'all' ? 'Anyone' : who}
						arrow
						onPress={() => toggle('who')}
					/>
				)}
				<TableSwitchRow
					label="Capture"
					subLabel="When off, new console output and errors are not recorded."
					value={!isCapturePaused()}
					onValueChange={value => setCapturePaused(!value)}
				/>
			</TableRowGroup>

			{picking === 'level' && (
				<TableRadioGroup
					defaultValue={severity}
					onChange={(value: string) => {
						setSeverity(value as Severity)
						setPicking(undefined)
					}}
				>
					<TableRadioRow label="Everything" value="all" />
					<TableRadioRow label="Warnings and errors" value="warn" />
					<TableRadioRow label="Errors" value="error" />
				</TableRadioGroup>
			)}

			{picking === 'who' && (
				<TableRadioGroup
					defaultValue={who}
					onChange={(value: string) => {
						setWho(value)
						setPicking(undefined)
					}}
				>
					<TableRadioRow label="Anyone" value="all" />
					{writers.map(writer => (
						<TableRadioRow key={writer} label={writer} value={writer} />
					))}
				</TableRadioGroup>
			)}

			<TextInput
				placeholder="Search"
				value={query}
				onChange={(value: string) => setQuery(value)}
				isClearable
				returnKeyType="search"
			/>

			<Card
				variant="secondary"
				border="none"
				style={{ padding: 0, overflow: 'hidden' }}
			>
				<View
					style={{
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'space-between',
						paddingHorizontal: 16,
						paddingVertical: 10,
					}}
				>
					<Text color="text-muted" variant="text-sm/semibold">
						{total > SHOWN
							? `NEWEST ${SHOWN} OF ${total}`
							: `${total} LINE${total === 1 ? '' : 'S'}`}
					</Text>
					<View style={{ flexDirection: 'row', gap: 16 }}>
						<Pressable onPress={handleCopyShown} hitSlop={8}>
							<Text color="text-link" variant="text-sm/semibold">
								Copy
							</Text>
						</Pressable>
						<Pressable onPress={handleShareShown} hitSlop={8}>
							<Text color="text-link" variant="text-sm/semibold">
								Share
							</Text>
						</Pressable>
						<Pressable onPress={handleClear} hitSlop={8}>
							<Text color="text-feedback-critical" variant="text-sm/semibold">
								Clear
							</Text>
						</Pressable>
					</View>
				</View>
				<ScrollView
					nestedScrollEnabled
					style={{ maxHeight: logHeight }}
					contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
				>
					{lines.map((entry, index) => (
						<Pressable
							key={`${entry.t}-${index}`}
							onLongPress={() => {
								try {
									Clipboard.setString(formatEntry(entry))
								} catch {
									// Ignore.
								}
							}}
							style={{ paddingVertical: 4 }}
						>
							<Text
								color={colourFor(entry.lvl)}
								variant="text-xs/normal"
								style={{ fontFamily: 'monospace' }}
							>
								{formatEntry(entry)}
							</Text>
						</Pressable>
					))}
					{lines.length === 0 ? (
						<Text
							color="text-muted"
							variant="text-sm/normal"
							style={{ paddingVertical: 8 }}
						>
							Nothing here.
						</Text>
					) : total > SHOWN ? (
						<Text
							color="text-muted"
							variant="text-sm/normal"
							style={{ paddingVertical: 8 }}
						>
							{`Showing the newest ${SHOWN}. Share to get them all, or narrow it down.`}
						</Text>
					) : null}
				</ScrollView>
			</Card>

			<Text color="text-muted" variant="text-xs/normal">
				Long-press a line to copy it. Copy and Share above export everything
				shown, with the plugin that wrote each line.
			</Text>
		</TabScreen>
	)
}
