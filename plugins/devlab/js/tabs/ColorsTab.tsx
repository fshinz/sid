import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import { forceRootUpdate } from '../components/FloatingPill'
import { SearchField } from '../components/SearchField'
import { TabScreen } from '../components/TabScreen'
import {
	getLastPickedRgb,
	openDiscordColorPicker,
	rgbIntToHex,
} from '../features/colorpicker'
import { hasFiberRoot, scanColoredElements } from '../features/elementscan'
import {
	getHighlights,
	highlightColor,
	highlightElement,
	stopHighlight,
} from '../features/highlight'
import {
	clearHistory,
	inspectState,
	reportSummary,
	reportToText,
	setCopyOnTap,
	setInspecting,
	setShowButton,
	startMode,
	subscribe,
} from '../features/inspect'
import { probeMounts } from '../features/probe'
import {
	analyzeColor,
	currentTheme,
	getMaps,
	rawEntries,
	semanticEntries,
	tokenLabel,
	tokensAvailable,
	tokensForValue,
} from '../features/tokens'
import type { ElementInfo, StyleColor } from '../features/elementscan'
import type { Report } from '../features/inspect'
import type { TokenEntry } from '../features/tokens'

const { Button, TableRow, TableRowGroup, TableSwitchRow, Text } = Design
const { View } = ReactNative

const MAX_ELEMENT_ROWS = 80
const PAGE = 30
const ELEMENT_PAGE = 20
const TOAST_KEY = 'shin.devlab.colors'

type ElementRow = ElementInfo & { key: string }

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

function colorDetails(colors: StyleColor[]) {
	return colors.map(color => {
		const analysis = analyzeColor(color.value)
		const names = [analysis.semantic, analysis.raw]
			.filter(Boolean)
			.concat(analysis.semanticMatches, analysis.rawMatches)
		return {
			key: color.key,
			value: analysis.value ?? String(color.value),
			label:
				tokenLabel(analysis) +
				(names.length > 1 ? ` (+${names.length - 1} more)` : ''),
		}
	})
}

function elementReport(element: { chain: string[]; colors: StyleColor[] }) {
	return `Element: ${element.chain.join(' > ')}\n\n${element.colors
		.map(color => {
			const a = analyzeColor(color.value)
			return `${color.key}: ${a.value ?? String(color.value)}\n  semantic: ${[a.semantic, ...a.semanticMatches].filter(Boolean).join(', ') || 'none'}\n  raw: ${[a.raw, ...a.rawMatches].filter(Boolean).join(', ') || 'none'}`
		})
		.join('\n')}`
}

function TokenRow({
	entry,
	expanded,
	onPress,
}: {
	entry: TokenEntry
	expanded: boolean
	onPress: () => void
}) {
	const matches = tokensForValue(entry.value)
	const others = [...matches.semantic, ...matches.raw].filter(
		name => name !== entry.name,
	)

	return (
		<TableRow
			icon={<Swatch value={entry.value} />}
			label={entry.name}
			subLabel={
				expanded
					? [
							`Value: ${entry.value}`,
							others.length > 0
								? `Same value: ${others.slice(0, 6).join(', ')}${others.length > 6 ? ` +${others.length - 6}` : ''}`
								: 'Unique value.',
							getMaps().semantic.has(entry.name)
								? `Theme: semantic.${currentTheme()} (per base).`
								: 'Theme: raw map.',
							'Tap Tint to pick a color.',
						].join('\n')
					: `${entry.value} · tap to tint`
			}
			subLabelLineClamp={expanded ? 6 : 1}
			trailing={expanded ? <TableRow.TrailingText text="Tint" /> : null}
			onPress={onPress}
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
	const [filter, setFilter] = React.useState('')
	const [expandedToken, setExpandedToken] = React.useState<string | null>(null)
	const [expandedReport, setExpandedReport] = React.useState<number | null>(
		null,
	)
	const [expandedElement, setExpandedElement] = React.useState<string | null>(
		null,
	)
	const [elements, setElements] = React.useState<ElementRow[]>([])
	const [scanning, setScanning] = React.useState(false)

	const [shown, setShown] = React.useState(PAGE)
	const [elemShown, setElemShown] = React.useState(ELEMENT_PAGE)

	React.useEffect(() => setShown(PAGE), [filter])

	React.useEffect(() => subscribe(rerender), [])

	const highlights = getHighlights()
	const status = Object.entries(inspectState.status)
		.filter(([, v]) => v)
		.map(([k, v]) => `${k}: ${v}`)
		.join('\n')

	const toast = (text: string, variant?: 'success' | 'critical') => {
		try {
			ToastActionCreators.open(TOAST_KEY, { text, variant })
		} catch {}
	}

	const handleTokenPress = (entry: TokenEntry) => {
		setExpandedToken(current => (current === entry.name ? null : entry.name))
		openDiscordColorPicker({
			color: rgbIntToHex(getLastPickedRgb()),
			onSelect: hex => {
				const found = highlightColor(entry.name, entry.name, entry.value, hex)
				if (found <= 0) {
					toast(`No visible elements use ${entry.name}.`)
				} else {
					toast(
						`Tinting ${entry.name} in ${hex}: ${found} element${found === 1 ? '' : 's'} colored in place.`,
						'success',
					)
				}
			},
		})
	}

	const handleReportPress = (report: Report) => {
		if (expandedReport !== report.id) return setExpandedReport(report.id)
		Clipboard.setString(reportToText(report, 'token'))
		setExpandedReport(null)
	}

	const handleRefreshPill = () => {
		forceRootUpdate()
		toast('Refreshing the floating button…')
	}

	const handleScanElements = () => {
		if (!hasFiberRoot()) {
			toast('UI tree unavailable. Reload the plugin and try again.', 'critical')
			return
		}

		setScanning(true)
		try {
			const found = scanColoredElements(MAX_ELEMENT_ROWS).map(element => ({
				...element,
				key: `${element.chain.join('>')}#${Math.random().toString(36).slice(2, 7)}`,
			}))
			setElements(found)
		} finally {
			setScanning(false)
		}
	}

	const handleHighlightElement = (element: ElementRow) => {
		const first = element.colors.find(color => color.normalized)
		if (!first) return
		const id = element.chain[0] ?? 'element'
		openDiscordColorPicker({
			color: rgbIntToHex(getLastPickedRgb()),
			onSelect: hex => {
				const found = highlightElement(element.chain, first.normalized, hex)
				toast(
					`Tinting ${id} in ${hex}: ${found} element${found === 1 ? '' : 's'} colored in place.`,
					found > 0 ? 'success' : undefined,
				)
			},
		})
	}

	const needle = filter.toLowerCase()
	const semantic = semanticEntries().filter(
		entry => needle === '' || entry.name.toLowerCase().includes(needle),
	)
	const raw = rawEntries().filter(
		entry => needle === '' || entry.name.toLowerCase().includes(needle),
	)

	const renderToken = (entry: TokenEntry, kind: string) => (
		<TokenRow
			key={`${kind}:${entry.name}`}
			entry={entry}
			expanded={expandedToken === entry.name}
			onPress={() => handleTokenPress(entry)}
		/>
	)

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
				<TableRow
					label="Element mode / Token mode"
					subLabel="Element mode lists components. Token mode groups by color token."
					trailing={
						<TableRow.TrailingText
							text={inspectState.mode === 'token' ? 'Token' : 'Element'}
						/>
					}
					onPress={() =>
						startMode(inspectState.mode === 'token' ? 'element' : 'token')
					}
				/>
				<TableRow
					label="Refresh floating button"
					subLabel="Forces a root re-render so the pill appears."
					arrow
					onPress={handleRefreshPill}
				/>
				<TableRow
					label="Probe mount points"
					subLabel="Checks known app components. Status updates after 4 seconds."
					arrow
					onPress={probeMounts}
				/>
				<TableRow
					label="Status"
					subLabel={status || 'No status yet.'}
					subLabelLineClamp={10}
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
				title="Theme colors"
				description="Tap a token, pick a color, and every element using it is tinted."
			>
				<TableRow
					label="Current theme"
					trailing={<TableRow.TrailingText text={currentTheme()} />}
				/>
				<TableRow
					label="Semantic tokens"
					trailing={
						<TableRow.TrailingText text={String(semanticEntries().length)} />
					}
				/>
				<TableRow
					label="Raw tokens"
					trailing={
						<TableRow.TrailingText text={String(rawEntries().length)} />
					}
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

			<SearchField
				value={filter}
				onChange={setFilter}
				placeholder="Filter tokens by name"
			/>

			<TableRowGroup title={`Semantic (${semantic.length})`} hasIcons>
				{semantic.length === 0 ? (
					<TableRow label="No semantic tokens matched." />
				) : (
					semantic.slice(0, shown).map(entry => renderToken(entry, 'semantic'))
				)}
				{semantic.length > shown && (
					<TableRow
						label={`Show ${Math.min(30, semantic.length - shown)} more (${semantic.length - shown} left)`}
						arrow
						onPress={() => setShown(value => value + 30)}
					/>
				)}
			</TableRowGroup>

			<TableRowGroup title={`Raw (${raw.length})`} hasIcons>
				{raw.length === 0 ? (
					<TableRow label="No raw tokens matched." />
				) : (
					raw.slice(0, shown).map(entry => renderToken(entry, 'raw'))
				)}
				{raw.length > shown && (
					<TableRow
						label={`Show ${Math.min(30, raw.length - shown)} more (${raw.length - shown} left)`}
						arrow
						onPress={() => setShown(value => value + 30)}
					/>
				)}
			</TableRowGroup>

			<TableRowGroup
				title="UI elements"
				description="Scan the live UI tree to see which semantic and raw colors each visible element uses."
			>
				<TableRow
					label={scanning ? 'Scanning…' : 'Scan visible UI'}
					subLabel="Elements on screen and the tokens behind their colors."
					arrow
					onPress={handleScanElements}
				/>
			</TableRowGroup>

			{elements.length > 0 && (
				<TableRowGroup title={`Elements (${elements.length})`}>
					{elements.slice(0, elemShown).map(element => {
						const expanded = expandedElement === element.key
						const details = colorDetails(element.colors)
						return (
							<React.Fragment key={element.key}>
								<TableRow
									label={element.chain.join(' › ')}
									subLabel={
										expanded
											? details
													.map(
														detail =>
															`${detail.key}: ${detail.value}\n  ${detail.label}`,
													)
													.join('\n')
											: details
													.map(detail => `${detail.key}: ${detail.value}`)
													.join(' · ')
									}
									subLabelLineClamp={expanded ? 20 : 2}
									trailing={
										expanded ? <TableRow.TrailingText text="Tint" /> : null
									}
									onPress={() => {
										if (!expanded) {
											setExpandedElement(element.key)
											return
										}
										handleHighlightElement(element)
										setExpandedElement(null)
									}}
								/>
								{expanded && (
									<TableRow
										label="Copy full report"
										trailing={<TableRow.TrailingText text="Copy" />}
										onPress={() => {
											Clipboard.setString(elementReport(element))
											toast('Report copied.', 'success')
										}}
									/>
								)}
							</React.Fragment>
						)
					})}
					{elements.length > elemShown && (
						<TableRow
							label={`Show ${Math.min(ELEMENT_PAGE, elements.length - elemShown)} more (${elements.length - elemShown} left)`}
							arrow
							onPress={() => setElemShown(value => value + ELEMENT_PAGE)}
						/>
					)}
				</TableRowGroup>
			)}

			<Text variant="text-sm/normal" color="text-muted">
				Tip: drag the DL pill anywhere. Tap it for modes and to stop highlights.
			</Text>
		</TabScreen>
	)
}
