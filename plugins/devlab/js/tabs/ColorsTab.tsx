import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import { openColorsBrowser } from '../components/ColorsBrowser'
import { TabScreen } from '../components/TabScreen'
import { getHighlights, stopHighlight } from '../features/highlight'
import {
	clearHistory,
	inspectState,
	reportSummary,
	reportToText,
	setCopyOnTap,
	setInspecting,
	setShowButton,
	subscribe,
} from '../features/inspect'
import {
	currentTheme,
	rawEntries,
	semanticEntries,
	tokensAvailable,
} from '../features/tokens'
import type { Report } from '../features/inspect'

const { Button, TableRow, TableRowGroup, TableSwitchRow, Text } = Design
const { View } = ReactNative

function Swatch({ value }: { value?: string }) {
	return (
		<View
			style={{
				width: 24,
				height: 24,
				borderRadius: 6,
				borderWidth: 1,
				borderColor: '#00000040',
				backgroundColor: value ?? 'transparent',
			}}
		/>
	)
}

function ReportRow({
	report,
	expanded,
	onPress,
}: {
	report: Report
	expanded: boolean
	onPress: () => void
}) {
	return (
		<TableRow
			label={reportSummary(report)}
			subLabel={
				expanded
					? reportToText(report, inspectState.mode)
					: `${new Date(report.ts).toLocaleTimeString()} · ${report.theme} theme · ${report.layers.length} layer${report.layers.length === 1 ? '' : 's'}`
			}
			subLabelLineClamp={expanded ? 30 : 1}
			trailing={<TableRow.TrailingText text={expanded ? 'Copy' : 'Details'} />}
			onPress={onPress}
		/>
	)
}

export function ColorsTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [expandedReport, setExpandedReport] = React.useState<number | null>(
		null,
	)

	React.useEffect(() => subscribe(rerender), [])

	const highlights = getHighlights()

	const handleReportPress = (report: Report) => {
		if (expandedReport !== report.id) return setExpandedReport(report.id)
		Clipboard.setString(reportToText(report, 'token'))
		setExpandedReport(null)
	}

	return (
		<TabScreen>
			<TableRowGroup
				title="Element inspector"
				description="Turn on logging, then tap elements to record their colors."
			>
				<TableSwitchRow
					label="Inspect mode"
					subLabel="Tap elements to log their colors. Newly rendered elements only."
					value={inspectState.enabled}
					onValueChange={setInspecting}
				/>
				<TableSwitchRow
					label="Copy report on tap"
					subLabel="Copies the report to the clipboard whenever you log an element."
					value={inspectState.copyOnTap}
					onValueChange={setCopyOnTap}
				/>
				<TableSwitchRow
					label="Floating button"
					subLabel="Show the draggable DL pill for quick access from any screen."
					value={inspectState.showButton}
					onValueChange={setShowButton}
				/>
			</TableRowGroup>

			{inspectState.history.length > 0 && (
				<TableRowGroup
					title={`Inspection log (${inspectState.history.length})`}
				>
					{inspectState.history.map(report => (
						<ReportRow
							key={report.id}
							report={report}
							expanded={expandedReport === report.id}
							onPress={() => handleReportPress(report)}
						/>
					))}
				</TableRowGroup>
			)}

			{inspectState.history.length > 0 && (
				<Button text="Clear log" variant="destructive" onPress={clearHistory} />
			)}

			<TableRowGroup
				title="Color browser"
				description="Semantic and raw tokens with their values, and the elements on screen."
			>
				<TableRow
					label="Current theme"
					trailing={<TableRow.TrailingText text={currentTheme()} />}
				/>
				<TableRow
					label="Semantic tokens"
					subLabel="Tint any token and see which elements carry its color."
					trailing={
						<TableRow.TrailingText text={String(semanticEntries().length)} />
					}
					arrow
					onPress={() => openColorsBrowser(0)}
				/>
				<TableRow
					label="Raw tokens"
					subLabel="The raw palette behind the semantic tokens."
					trailing={
						<TableRow.TrailingText text={String(rawEntries().length)} />
					}
					arrow
					onPress={() => openColorsBrowser(1)}
				/>
				<TableRow
					label="Elements"
					subLabel="Scan the live UI tree and tint elements in place."
					arrow
					onPress={() => openColorsBrowser(2)}
				/>
				{!tokensAvailable() && (
					<TableRow
						label="Token module not found yet."
						subLabel="Values appear once Discord's color tokens load."
					/>
				)}
			</TableRowGroup>

			{highlights.length > 0 && (
				<TableRowGroup title={`Active highlights (${highlights.length})`}>
					{highlights.map(item => (
						<TableRow
							key={item.id}
							icon={<Swatch value={item.color} />}
							label={item.label}
							subLabel={`${item.color} · ${item.matched} element${item.matched === 1 ? '' : 's'} tinted in place. Tap to remove.`}
							subLabelLineClamp={1}
							trailing={<TableRow.TrailingText text="Remove" />}
							onPress={() => stopHighlight(item.id)}
						/>
					))}
					<TableRow
						label="Stop all highlights"
						subLabel="Restores every tinted element to its original colors."
						trailing={<TableRow.TrailingText text="Restore" />}
						onPress={() => stopHighlight()}
					/>
				</TableRowGroup>
			)}

			<Text variant="text-sm/normal" color="text-muted">
				Tip: drag the DL pill anywhere. Tap it for modes and to stop highlights.
			</Text>
		</TabScreen>
	)
}
