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
import type { Checkup, Diagnosis } from '../features/diagcheck'
import type { ReportData } from '../features/diagreport'

const {
	ActionSheet,
	BottomSheetTitleHeader,
	TableRow,
	TableRowGroup,
	TableSwitchRow,
	Text,
	Tabs,
	useSegmentedControlState,
} = Design
const { View } = ReactNative

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

	const checkup = lastCheckup()
	const diagnosis = checkup?.plugins.find(plugin => plugin.id === id)

	if (!checkup || !diagnosis) {
		return (
			<ActionSheet scrollable>
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
		<ActionSheet scrollable>
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
				<TableRow
					label="/plugins command"
					subLabel="Post the same report in a channel from the chat input."
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

const PAGES = ['Plugins', 'Issues', 'Report', 'Options'] as const

export function DiagnosticsTab() {
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
			{active === 2 && <ReportPage />}
			{active === 3 && <OptionsPage />}
			{!data && active < 2 && (
				<TableRowGroup title="Plugins">
					<TableRow label="Run a checkup to list plugins." />
				</TableRowGroup>
			)}
		</TabScreen>
	)
}
