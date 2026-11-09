import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { TabScreen } from '../components/TabScreen'
import {
	copyText,
	formatPluginReport,
	formatVersion,
	hostOf,
	lastCheckup,
	onCheckup,
	runCheckup,
} from '../features/diagcheck'
import {
	iconCacheState,
	runCheck,
	setAutoRepair,
	subscribeIconCache,
} from '../features/diagicons'
import {
	EXPORT_FOLDER,
	exportFullReport,
	formatReportMessage,
	gatherReport,
} from '../features/diagreport'
import {
	currentSession,
	entries,
	entriesFor,
	exitWentWrong,
	formatBytes,
	formatEntry,
	formatWhen,
	isCapturePaused,
	sessions as jsSessions,
	loadNativeLogs,
	onEntries,
	parseEntries,
	readNativeLog,
	setCapturePaused,
} from '../features/errlog'
import type { Checkup, Diagnosis } from '../features/diagcheck'
import type { ReportData } from '../features/diagreport'
import type {
	ExitInfo,
	LogEntry,
	NativeLogs,
	SessionInfo,
	SessionMeta,
} from '../features/errlog'

const {
	ActionSheet,
	BottomSheetTitleHeader,
	Card,
	TableRow,
	TableRowGroup,
	TableRadioGroup,
	TableRadioRow,
	TableSwitchRow,
	Text,
	TextInput,
	Tabs,
	useSegmentedControlState,
} = Design
const { Pressable, ScrollView, Share, View, useWindowDimensions } = ReactNative

const SHEET_KEY = 'shin.devlab.plugin-details'
const TOAST_KEY = 'shin.devlab.errors'

function toast(text: string, variant?: 'success' | 'critical') {
	try {
		ToastActionCreators.open(TOAST_KEY, { text, variant })
	} catch {}
}

function HealthDot({ health }: { health: 'ok' | 'warning' | 'error' }) {
	const color =
		health === 'error'
			? '#DA373C'
			: health === 'warning'
				? '#F0B232'
				: '#23A55A'
	return (
		<View
			style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }}
		/>
	)
}

function pluginIcon(diagnosis: Diagnosis) {
	try {
		const Icon = lookupGeneratedIconComponent(diagnosis.icon ?? 'WrenchIcon')
		if (Icon) return <Icon />
	} catch {}
	return <View style={{ width: 22, height: 22 }} />
}

function healthNotes(diagnosis: Diagnosis) {
	if (!diagnosis.notes.length) return diagnosis.description ?? diagnosis.id
	return diagnosis.notes.slice(0, 2).join(' · ')
}

function PluginDetailsSheet({ id }: { id: string }) {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	React.useEffect(() => onCheckup(rerender), [])
	const sheetMax = Math.round(useWindowDimensions().height * 0.85)

	const checkup = lastCheckup()
	const diagnosis = checkup?.plugins.find(plugin => plugin.id === id)

	if (!checkup || !diagnosis) {
		return (
			<ActionSheet scrollable maxHeight={sheetMax}>
				<BottomSheetTitleHeader title={id} />
				<Text variant="text-sm/normal" color="text-muted">
					Not in the last checkup.
				</Text>
			</ActionSheet>
		)
	}

	const facts = [
		`Version ${formatVersion(diagnosis.version)}`,
		diagnosis.author ? `by ${diagnosis.author}` : null,
		diagnosis.repo
			? `${hostOf(diagnosis.repo)}, ${diagnosis.channel ?? 'latest'}`
			: diagnosis.origin,
		diagnosis.enabled === false ? 'off' : null,
		diagnosis.hasNative ? 'native' : null,
		diagnosis.isApi ? 'API plugin' : null,
	]
		.filter(Boolean)
		.join(' · ')

	const deps = diagnosis.dependencies.length
		? diagnosis.dependencies
				.map(dependency => {
					const mark =
						dependency.satisfied === true
							? 'ok'
							: dependency.satisfied === false
								? 'NO'
								: '?'
					return `${dependency.id} ${dependency.range}${dependency.optional ? ' (optional)' : ''} = ${formatVersion(dependency.installed)} ${mark}`
				})
				.join('\n')
		: ''

	return (
		<ActionSheet scrollable maxHeight={sheetMax}>
			<BottomSheetTitleHeader title={diagnosis.name} />
			<View style={{ paddingTop: 8 }}>
				<TableRowGroup title="Details">
					<TableRow label={facts} subLabelLineClamp={3} />
					{diagnosis.notes.map(note => (
						<TableRow key={note} label={note} subLabelLineClamp={3} />
					))}
				</TableRowGroup>
				{deps && (
					<TableRowGroup title={`Needs (${diagnosis.dependencies.length})`}>
						<TableRow label={deps} subLabelLineClamp={12} />
					</TableRowGroup>
				)}
				{diagnosis.dependents.length > 0 && (
					<TableRowGroup title={`Used by (${diagnosis.dependents.length})`}>
						<TableRow
							label={diagnosis.dependents
								.map(
									depId =>
										checkup.plugins.find(plugin => plugin.id === depId)?.name ??
										depId,
								)
								.join(', ')}
							subLabelLineClamp={6}
						/>
					</TableRowGroup>
				)}
				{diagnosis.errors.length > 0 && (
					<TableRowGroup title={`Errors (${diagnosis.errors.length})`}>
						{diagnosis.errors.map(error => (
							<TableRow
								key={`${error.code}:${error.message}`}
								label={`${error.code}: ${error.message}`}
								subLabel={error.stack ?? undefined}
								subLabelLineClamp={12}
							/>
						))}
					</TableRowGroup>
				)}
				{diagnosis.published.length > 0 && (
					<TableRowGroup title={`Published (${diagnosis.published.length})`}>
						<TableRow
							label={diagnosis.published
								.slice(0, 8)
								.map(published => published.version)
								.join(', ')}
							subLabelLineClamp={3}
						/>
					</TableRowGroup>
				)}
				<TableRowGroup title="Actions">
					<TableRow
						label="Copy plugin report"
						trailing={<TableRow.TrailingText text="Copy" />}
						onPress={() => {
							copyText(formatPluginReport(diagnosis, checkup))
							toast('Report copied.', 'success')
						}}
					/>
					<TableRow
						label="Copy plugin id"
						trailing={<TableRow.TrailingText text="Copy" />}
						onPress={() => {
							Clipboard.setString(diagnosis.id)
							toast('Id copied.', 'success')
						}}
					/>
				</TableRowGroup>
			</View>
		</ActionSheet>
	)
}

function openPluginDetails(id: string) {
	ActionSheetActionCreators.openLazy(
		Promise.resolve({ default: PluginDetailsSheet }),
		SHEET_KEY,
		{ id },
		'stack',
	)
}

function PluginRow({ diagnosis }: { diagnosis: Diagnosis }) {
	return (
		<TableRow
			icon={pluginIcon(diagnosis)}
			label={diagnosis.name}
			subLabel={`${formatVersion(diagnosis.version)} · ${healthNotes(diagnosis)}`}
			subLabelLineClamp={2}
			trailing={<HealthDot health={diagnosis.health} />}
			onPress={() => openPluginDetails(diagnosis.id)}
		/>
	)
}

function PluginsPage({ checkup }: { checkup: Checkup }) {
	const own = checkup.plugins.filter(plugin => !plugin.core)
	return (
		<View>
			<TableRowGroup title={`Installed (${own.length})`} hasIcons>
				{own.length === 0 ? (
					<TableRow label="No plugins reported." />
				) : (
					own.map(plugin => <PluginRow key={plugin.id} diagnosis={plugin} />)
				)}
			</TableRowGroup>
			<TableRowGroup
				title={`Built in (${checkup.plugins.length - own.length})`}
				hasIcons
			>
				{checkup.plugins
					.filter(plugin => plugin.core)
					.map(plugin => (
						<PluginRow key={plugin.id} diagnosis={plugin} />
					))}
			</TableRowGroup>
		</View>
	)
}

function IssuesPage({ checkup }: { checkup: Checkup }) {
	const own = checkup.plugins.filter(plugin => !plugin.core)
	const problems = own.filter(plugin => plugin.health === 'error')
	const warnings = own.filter(plugin => plugin.health === 'warning')
	return (
		<View>
			{problems.length === 0 && warnings.length === 0 ? (
				<TableRowGroup title="Issues">
					<TableRow label="No problems or warnings." />
				</TableRowGroup>
			) : (
				<>
					<TableRowGroup title={`Problems (${problems.length})`} hasIcons>
						{problems.map(plugin => (
							<PluginRow key={plugin.id} diagnosis={plugin} />
						))}
					</TableRowGroup>
					<TableRowGroup title={`Warnings (${warnings.length})`} hasIcons>
						{warnings.map(plugin => (
							<PluginRow key={plugin.id} diagnosis={plugin} />
						))}
					</TableRowGroup>
				</>
			)}
		</View>
	)
}

function ReportPage() {
	const [report, setReport] = React.useState<ReportData | undefined>(undefined)
	const [busy, setBusy] = React.useState(false)

	const load = async () => {
		setBusy(true)
		try {
			setReport(await gatherReport())
		} catch (error) {
			toast(`Could not build the report: ${String(error)}`, 'critical')
		} finally {
			setBusy(false)
		}
	}

	React.useEffect(() => {
		void load()
	}, [])

	const exits = report?.exits ?? []

	return (
		<View>
			<TableRowGroup
				title="Bug report"
				description="Build info, plugin health and every installed plugin, ready for a bug report."
			>
				<TableRow
					label={busy ? 'Building report…' : 'Copy full report'}
					trailing={<TableRow.TrailingText text="Copy" />}
					onPress={() => {
						if (!report) return void load()
						copyText(formatReportMessage(report, { core: true }))
						toast('Report copied.', 'success')
					}}
				/>
				<TableRow
					label="Copy without built-in plugins"
					trailing={<TableRow.TrailingText text="Copy" />}
					onPress={() => {
						if (!report) return void load()
						copyText(formatReportMessage(report, { core: false }))
						toast('Report copied.', 'success')
					}}
				/>
				<TableRow
					label="Save to Downloads"
					subLabel={`Writes ${EXPORT_FOLDER}/devlab-full-report.txt.`}
					arrow
					onPress={() => void exportFullReport(false)}
				/>
				<TableRow
					label="Save and share"
					subLabel="Saves it, then opens the share sheet."
					arrow
					onPress={() => void exportFullReport(true)}
				/>
			</TableRowGroup>
			<TableRowGroup title={`Why Discord closed (${exits.length})`}>
				{exits.length === 0 ? (
					<TableRow
						label="No exits recorded."
						subLabel="Needs the Android part and Android 11+."
					/>
				) : (
					exits
						.slice(0, 15)
						.map(exit => (
							<TableRow
								key={`${exit.pid}:${exit.timestamp}`}
								label={`${exit.reasonText}${exit.description ? ` (${exit.description})` : ''}`}
								subLabel={`${new Date(exit.timestamp).toLocaleString()} · pid ${exit.pid}${exit.processName ? ` · ${exit.processName}` : ''}`}
							/>
						))
				)}
			</TableRowGroup>
		</View>
	)
}

function OptionsPage() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	React.useEffect(() => subscribeIconCache(rerender), [])
	const cache = iconCacheState()
	const repair = cache.lastRepair

	return (
		<View>
			<TableRowGroup
				title="Icon cache"
				description="Keeps Discord's icon assets loaded so plugin rows always show their icons."
			>
				<TableSwitchRow
					label="Repair on start"
					subLabel="Loads missing icon modules when DevLab starts."
					value={cache.auto}
					onValueChange={setAutoRepair}
				/>
				<TableRow
					label="Run icon check now"
					arrow
					onPress={() => {
						const result = runCheck()
						toast(
							result.status === 'ok'
								? `Icon cache is fine (${result.cached} cached).`
								: result.status === 'repaired'
									? `Repaired: ${result.report?.cachedAfter ?? 0} cached.`
									: `Icon check failed: ${result.problem ?? 'unknown problem'}`,
							result.status === 'error' ? 'critical' : 'success',
						)
					}}
				/>
				{repair && (
					<TableRow
						label={`Last repair: ${repair.initialised} loaded, ${repair.failed} failed`}
						subLabel={`${repair.missingRequired.length ? `Missing: ${repair.missingRequired.join(', ')}` : 'All required icons present.'}`}
						subLabelLineClamp={3}
					/>
				)}
			</TableRowGroup>
			<TableRowGroup title="About">
				<TableRow
					label="DevLab diagnostics"
					subLabel="Plugin health, crash reports and bug-report exports."
				/>
			</TableRowGroup>
		</View>
	)
}

const SHOWN = 300
const ANDROID_READ_BYTES = 1_500_000
const LOGCAT_LEVEL = /^\S+\s+\S+\s+\d+\s+\d+\s+([VDIWEF])\s/

type LogSource = 'plugins' | 'android' | 'crash'
type Severity = 'all' | 'warn' | 'error'
type Picking = 'source' | 'level' | 'who'

const SEVERE: Record<Severity, (level: string) => boolean> = {
	all: () => true,
	warn: level => ['warn', 'error', 'fatal', 'W', 'E', 'F'].includes(level),
	error: level => ['error', 'fatal', 'E', 'F'].includes(level),
}

const SOURCE_LABEL: Record<LogSource, string> = {
	plugins: 'Plugins & Discord',
	android: 'Android log',
	crash: 'Java crash',
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

function nameOf(who: string) {
	if (who === DISCORD) return 'Discord and Valenced'
	return lastCheckup()?.plugins.find(plugin => plugin.id === who)?.name ?? who
}

function colourFor(level: string) {
	if (level === 'error' || level === 'fatal' || level === 'E' || level === 'F')
		return 'text-feedback-critical'
	if (level === 'warn' || level === 'W') return 'text-feedback-warning'
	if (level === 'debug' || level === 'V' || level === 'D') return 'text-muted'
	return 'text-default'
}

function exitLine(exit: ExitInfo) {
	return exit.description
		? `${exit.reasonText} (${exit.description})`
		: exit.reasonText
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

type ErrorRow = {
	key: string
	native: boolean
	startedAt: number
	current: boolean
	crashed: boolean
	exit: ExitInfo | null
	bytes: number
	meta?: SessionMeta
	session?: SessionInfo
}

function fallbackLine(row: ErrorRow) {
	const recorded = row.meta ? entriesFor(row.meta.id) : []
	let errors = 0
	let warnings = 0
	for (const entry of recorded) {
		if (entry.lvl === 'error' || entry.lvl === 'fatal') errors++
		else if (entry.lvl === 'warn') warnings++
	}
	const ending = row.meta?.clean
		? 'Ended normally'
		: row.crashed
			? 'Ended unexpectedly, crash recorded'
			: 'Ended unexpectedly'
	return [
		ending,
		errors ? `${errors} error${errors === 1 ? '' : 's'}` : null,
		warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : null,
	]
		.filter(Boolean)
		.join(' · ')
}

function ErrorsPage() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [nativeLogs, setNativeLogs] = React.useState<NativeLogs | undefined>(
		undefined,
	)
	const [source, setSource] = React.useState<LogSource>('plugins')
	const [severity, setSeverity] = React.useState<Severity>('warn')
	const [who, setWho] = React.useState('all')
	const [picking, setPicking] = React.useState<Picking | undefined>(undefined)
	const [query, setQuery] = React.useState('')
	const [selected, setSelected] = React.useState<string | null>(null)
	const [savedJs, setSavedJs] = React.useState<LogEntry[] | undefined>(
		undefined,
	)
	const [android, setAndroid] = React.useState<string | undefined>(undefined)
	const [crashText, setCrashText] = React.useState<string | undefined>(
		undefined,
	)
	const [loadProblem, setLoadProblem] = React.useState<string | undefined>(
		undefined,
	)

	React.useEffect(() => {
		void loadNativeLogs().then(setNativeLogs)
	}, [])

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

	const native = nativeLogs?.sessions !== undefined
	const current = currentSession()
	const rows: ErrorRow[] = native
		? (nativeLogs?.sessions ?? []).map(session => ({
				key: session.id,
				native: true,
				startedAt: session.startedAt,
				current: session.current,
				crashed: session.crash,
				exit: session.exit,
				bytes: session.jsBytes + session.logcatBytes,
				session,
			}))
		: [
				current,
				...jsSessions()
					.filter(session => session.id !== current.id)
					.slice()
					.reverse(),
			].map(meta => ({
				key: meta.id,
				native: false,
				startedAt: meta.startedAt,
				current: meta.id === current.id,
				crashed: meta.crashed,
				exit: null,
				bytes: 0,
				meta,
			}))

	const selectedRow =
		rows.find(row => row.key === selected) ??
		rows.find(row => row.current) ??
		rows[0]
	const currentRow = rows.find(row => row.current) ?? rows[0]
	const live = !!selectedRow?.current
	const past = rows.filter(row => !row.current)

	const load = React.useCallback(async () => {
		if (!selectedRow) return
		try {
			if (source === 'plugins') {
				setSavedJs(
					selectedRow.native && !selectedRow.current
						? parseEntries(
								await readNativeLog(selectedRow.key, 'js', 2_000_000),
							)
						: undefined,
				)
			}
			if (source === 'android') {
				setAndroid(
					(await readNativeLog(
						selectedRow.key,
						'logcat',
						ANDROID_READ_BYTES,
					)) ?? '',
				)
			}
			if (source === 'crash') {
				setCrashText(
					(await readNativeLog(selectedRow.key, 'crash', 200_000)) ?? '',
				)
			}
			setLoadProblem(undefined)
		} catch (error) {
			setLoadProblem(`Could not read the saved log: ${String(error)}`)
		}
	}, [selectedRow?.key, source])

	React.useEffect(() => {
		void load()
	}, [load])

	const sourceEntries: readonly LogEntry[] =
		source !== 'plugins'
			? []
			: selectedRow?.native
				? live
					? entries()
					: (savedJs ?? [])
				: selectedRow?.meta
					? entriesFor(selectedRow.meta.id)
					: []

	const writers = [...new Set(sourceEntries.map(whoWrote))].sort((a, b) =>
		nameOf(a).localeCompare(nameOf(b)),
	)
	const needle = query.trim().toLowerCase()
	const matching = sourceEntries.filter(
		entry =>
			SEVERE[severity](entry.lvl) &&
			(who === 'all' || whoWrote(entry) === who) &&
			(!needle ||
				`${entry.msg} ${entry.plugin ?? ''} ${entry.tag ?? ''}`
					.toLowerCase()
					.includes(needle)),
	)

	const androidLines =
		source === 'android' && android !== undefined
			? android.split('\n').filter(line => {
					if (!line) return false
					const level = LOGCAT_LEVEL.exec(line)?.[1]
					if (severity !== 'all' && (!level || !SEVERE[severity](level)))
						return false
					return !needle || line.toLowerCase().includes(needle)
				})
			: []

	const total =
		source === 'plugins'
			? matching.length
			: source === 'android'
				? androidLines.length
				: crashText
					? 1
					: 0

	const lines =
		source === 'plugins'
			? matching
					.slice(-SHOWN)
					.reverse()
					.map((entry, index) => ({
						key: `${entry.t}-${index}`,
						text: formatEntry(entry),
						level: entry.lvl,
					}))
			: source === 'android'
				? androidLines
						.slice(-SHOWN)
						.reverse()
						.map((text, index) => ({
							key: `a${index}`,
							text,
							level: LOGCAT_LEVEL.exec(text)?.[1] ?? 'I',
						}))
				: crashText
					? [{ key: 'crash', text: crashText, level: 'error' }]
					: []

	const shownText = () => {
		const text =
			source === 'plugins'
				? matching.map(formatEntry).join('\n')
				: source === 'android'
					? androidLines.join('\n')
					: (crashText ?? '')
		if (!text) return ''
		return `DevLab log · ${selectedRow ? formatWhen(selectedRow.startedAt) : 'this session'} · ${SOURCE_LABEL[source]}\n${text}`
	}

	const handleCopy = () => {
		const text = shownText()
		if (!text) return toast('Nothing to copy.')
		if (text.length > 200_000)
			return toast('Too big for the clipboard. Use Share instead.')
		try {
			Clipboard.setString(text)
			toast('Copied.', 'success')
		} catch {
			toast('Could not reach the clipboard.', 'critical')
		}
	}

	const handleShare = () => {
		const text = shownText()
		if (!text) return toast('Nothing to share.')
		try {
			void Share.share({ message: text })
		} catch {}
	}

	const statusLabel = !selectedRow
		? 'No session chosen'
		: live
			? 'Running now'
			: selectedRow.exit
				? selectedRow.exit.reasonText[0].toUpperCase() +
					selectedRow.exit.reasonText.slice(1)
				: selectedRow.native
					? 'How it ended was not recorded'
					: selectedRow.meta?.clean
						? 'Ended normally'
						: selectedRow.crashed
							? 'Crash recorded'
							: 'Ended unexpectedly'

	const wentWrong =
		!!selectedRow &&
		!live &&
		(selectedRow.crashed || exitWentWrong(selectedRow.exit))

	const logcatNote = nativeLogs?.status
		? `Android log ${
				nativeLogs.status.logcatRunning
					? `${nativeLogs.status.logcatLines} lines`
					: nativeLogs.status.logcatEnabled
						? 'not running'
						: 'off'
			}${nativeLogs.status.logcatError ? ` · ${nativeLogs.status.logcatError}` : ''}`
		: 'Plugins, Discord and Android logs since Discord started'

	const toggle = (which: Picking) =>
		setPicking(picking === which ? undefined : which)
	const logHeight = Math.max(
		280,
		Math.round(useWindowDimensions().height * 0.55),
	)

	return (
		<View>
			<TableRowGroup hasIcons>
				<TableRow
					icon={
						wentWrong ? rowIcon('CircleErrorIcon') : rowIcon('CircleCheckIcon')
					}
					label={statusLabel}
					subLabel={
						selectedRow
							? `Started ${formatWhen(selectedRow.startedAt)}${selectedRow.crashed ? ' · a Java crash was saved' : ''}`
							: undefined
					}
					subLabelLineClamp={2}
				/>
			</TableRowGroup>

			<TableRowGroup
				title="Sessions"
				description={
					native
						? `The last ${nativeLogs?.status?.maxSessions ?? 8} sessions are kept, counting this one.`
						: 'Kept across restarts. Tap to view a session.'
				}
			>
				<TableRow
					icon={rowIcon('ClockIcon', 'CircleInformationIcon')}
					label="This session"
					subLabel={
						native
							? logcatNote
							: currentRow
								? fallbackLine(currentRow)
								: 'Plugins and Discord logs since Discord started'
					}
					subLabelLineClamp={2}
					trailing={<TableRow.TrailingText text={live ? 'Viewing' : 'View'} />}
					onPress={() => {
						if (currentRow) setSelected(currentRow.key)
						setWho('all')
					}}
				/>
				{past.map(row => (
					<TableRow
						key={row.key}
						icon={
							exitWentWrong(row.exit) || row.crashed
								? rowIcon('CircleErrorIcon')
								: rowIcon('CircleCheckIcon')
						}
						label={formatWhen(row.startedAt)}
						subLabel={
							row.native
								? [
										row.exit
											? `Ended: ${exitLine(row.exit)}`
											: 'How it ended is not known',
										row.crashed ? 'Java crash saved' : null,
										formatBytes(row.bytes),
									]
										.filter(Boolean)
										.join(' · ')
								: fallbackLine(row)
						}
						subLabelLineClamp={2}
						trailing={
							<TableRow.TrailingText
								text={selectedRow?.key === row.key ? 'Viewing' : 'View'}
							/>
						}
						onPress={() => {
							setSelected(row.key)
							setWho('all')
						}}
					/>
				))}
			</TableRowGroup>

			<TableRowGroup title="Show">
				{native && selectedRow?.native && (
					<TableRow
						label="Source"
						subLabel={SOURCE_LABEL[source]}
						arrow
						onPress={() => toggle('source')}
					/>
				)}
				{source !== 'crash' && (
					<TableRow
						label="Level"
						subLabel={LEVEL_LABEL[severity]}
						arrow
						onPress={() => toggle('level')}
					/>
				)}
				{source === 'plugins' && writers.length > 1 && (
					<TableRow
						label="Written by"
						subLabel={who === 'all' ? 'Anyone' : nameOf(who)}
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

			{picking === 'source' && (
				<TableRadioGroup
					defaultValue={source}
					onChange={(value: string) => {
						setSource(value as LogSource)
						setPicking(undefined)
					}}
				>
					<TableRadioRow
						label="Plugins & Discord"
						subLabel="Each line with the plugin that wrote it"
						value="plugins"
					/>
					<TableRadioRow
						label="Android log"
						subLabel="Discord's logcat, from startup"
						value="android"
					/>
					{selectedRow?.crashed && (
						<TableRadioRow label="Java crash" value="crash" />
					)}
				</TableRadioGroup>
			)}

			{picking === 'level' && source !== 'crash' && (
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

			{picking === 'who' && source === 'plugins' && (
				<TableRadioGroup
					defaultValue={who}
					onChange={(value: string) => {
						setWho(value)
						setPicking(undefined)
					}}
				>
					<TableRadioRow label="Anyone" value="all" />
					{writers.map(writer => (
						<TableRadioRow
							key={writer}
							label={nameOf(writer)}
							subLabel={writer === DISCORD ? undefined : writer}
							value={writer}
						/>
					))}
				</TableRadioGroup>
			)}

			{source !== 'crash' && (
				<TextInput
					placeholder="Search"
					value={query}
					onChange={(value: string) => setQuery(value)}
					isClearable
					returnKeyType="search"
				/>
			)}

			{(nativeLogs?.problem || loadProblem) && (
				<Text color="text-feedback-critical" variant="text-sm/normal">
					{nativeLogs?.problem ?? loadProblem}
				</Text>
			)}

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
						{source === 'crash'
							? 'JAVA CRASH'
							: total > SHOWN
								? `NEWEST ${SHOWN} OF ${total}`
								: `${total} LINE${total === 1 ? '' : 'S'}`}
					</Text>
					<View style={{ flexDirection: 'row', gap: 16 }}>
						<Pressable
							onPress={() => {
								void load()
								rerender()
							}}
							hitSlop={8}
						>
							<Text color="text-link" variant="text-sm/semibold">
								Reload
							</Text>
						</Pressable>
						<Pressable onPress={handleCopy} hitSlop={8}>
							<Text color="text-link" variant="text-sm/semibold">
								Copy
							</Text>
						</Pressable>
						<Pressable onPress={handleShare} hitSlop={8}>
							<Text color="text-link" variant="text-sm/semibold">
								Share
							</Text>
						</Pressable>
					</View>
				</View>
				<ScrollView
					nestedScrollEnabled
					style={{ maxHeight: logHeight }}
					contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}
				>
					{lines.map(item => (
						<Pressable
							key={item.key}
							onLongPress={() => {
								try {
									Clipboard.setString(item.text)
									toast('Line copied.', 'success')
								} catch {}
							}}
							style={{ paddingVertical: 4 }}
						>
							<Text
								color={colourFor(item.level)}
								variant="text-xs/normal"
								style={{ fontFamily: 'monospace' }}
							>
								{item.text}
							</Text>
						</Pressable>
					))}
					{lines.length === 0 ? (
						<Text
							color="text-muted"
							variant="text-sm/normal"
							style={{ paddingVertical: 8 }}
						>
							{source === 'android' && android === undefined
								? 'Loading…'
								: 'Nothing here.'}
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
		</View>
	)
}

const PAGES = ['Plugins', 'Issues', 'Errors', 'Report', 'Options'] as const

export function DebuggingTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [checkup, setCheckup] = React.useState<Checkup | undefined>(undefined)
	const [running, setRunning] = React.useState(false)
	const [active, setActive] = React.useState(0)

	React.useEffect(() => onCheckup(rerender), [])

	const run = async () => {
		setRunning(true)
		try {
			setCheckup(await runCheckup())
		} finally {
			setRunning(false)
		}
	}

	React.useEffect(() => {
		void run()
	}, [])

	const data = checkup ?? lastCheckup()
	const own = data ? data.plugins.filter(plugin => !plugin.core) : []
	const problems = own.filter(plugin => plugin.health === 'error').length
	const warnings = own.filter(plugin => plugin.health === 'warning').length

	const items = React.useMemo(
		() =>
			PAGES.map((label, index) => ({
				id: label.toLowerCase(),
				label,
				count:
					index === 0
						? own.length
						: index === 1
							? problems + warnings
							: undefined,
			})),
		[own.length, problems, warnings],
	)

	const state = useSegmentedControlState({
		items,
		pageWidth: 1,
		onSetActiveIndex: setActive,
		onPageChange: setActive,
	})

	const summary = data ? (
		<TableRowGroup
			title="Checkup"
			description={
				data.problem
					? undefined
					: `${own.length} plugins · ${problems} problems · ${warnings} warnings`
			}
		>
			<TableRow
				label={running ? 'Running checkup…' : 'Run checkup again'}
				arrow
				onPress={() => void run()}
			/>
			<TableRow
				label="Checked"
				trailing={
					<TableRow.TrailingText
						text={new Date(data.at).toLocaleTimeString()}
					/>
				}
			/>
			<TableRow
				label="Discord"
				trailing={<TableRow.TrailingText text={formatVersion(data.discord)} />}
			/>
			<TableRow
				label="Valenced API"
				trailing={
					<TableRow.TrailingText text={formatVersion(data.valencedApi)} />
				}
			/>
			{data.problem && <TableRow label={data.problem} subLabelLineClamp={6} />}
			{!data.liveState && (
				<TableRow
					label="Live plugin states off"
					subLabel="Turn on Developer Mode under Valenced settings for enabled/status details."
				/>
			)}
		</TableRowGroup>
	) : (
		<TableRowGroup title="Checkup">
			<TableRow
				label={running ? 'Running checkup…' : 'Waiting for first checkup.'}
			/>
		</TableRowGroup>
	)

	return (
		<TabScreen>
			{summary}
			<View style={{ paddingHorizontal: 0 }}>
				<Tabs state={state} />
			</View>
			{data && active === 0 && <PluginsPage checkup={data} />}
			{data && active === 1 && <IssuesPage checkup={data} />}
			{active === 2 && <ErrorsPage />}
			{active === 3 && <ReportPage />}
			{active === 4 && <OptionsPage />}
			{!data && active < 2 && (
				<TableRowGroup title="Plugins">
					<TableRow label="Run a checkup to list plugins." />
				</TableRowGroup>
			)}
		</TabScreen>
	)
}
