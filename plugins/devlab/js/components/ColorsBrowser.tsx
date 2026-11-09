import {
	ActionSheetActionCreators,
	ToastActionCreators,
} from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import {
	getLastPickedRgb,
	openDiscordColorPicker,
	rgbIntToHex,
} from '../features/colorpicker'
import { hasFiberRoot, scanColoredElements } from '../features/elementscan'
import { highlightColor, highlightElement } from '../features/highlight'
import {
	analyzeColor,
	currentTheme,
	definitionOf,
	rawEntries,
	semanticEntries,
	tokenLabel,
	tokensForValue,
} from '../features/tokens'
import { SearchField } from './SearchField'
import type { ElementInfo, StyleColor } from '../features/elementscan'
import type { TokenEntry } from '../features/tokens'

const {
	ActionSheet,
	BottomSheetTitleHeader,
	SegmentedControlPages,
	Tabs,
	TableRow,
	TableRowGroup,
	useSegmentedControlState,
} = Design
const { View } = ReactNative

const SHEET_KEY = 'shin.devlab.colors-browser'
const TOAST_KEY = 'shin.devlab.colors'
const PAGE = 30
const ELEMENT_PAGE = 20
const MAX_ELEMENT_ROWS = 80

type ElementRow = ElementInfo & { key: string }

let cachedElements: ElementRow[] = []

export function browserElements(): ElementRow[] {
	return cachedElements
}

function toast(text: string, variant?: 'success' | 'critical') {
	try {
		ToastActionCreators.open(TOAST_KEY, { text, variant })
	} catch {}
}

function Swatch({ value }: { value?: string | null }) {
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
	kind,
	expanded,
	onPress,
}: {
	entry: TokenEntry
	kind: 'semantic' | 'raw'
	expanded: boolean
	onPress: () => void
}) {
	const matches = tokensForValue(entry.value)
	const others = [...matches.semantic, ...matches.raw].filter(
		name => name !== entry.name,
	)
	const definition = kind === 'semantic' ? definitionOf(entry.name) : undefined

	return (
		<TableRow
			icon={<Swatch value={entry.value} />}
			label={entry.name}
			subLabel={
				expanded
					? [
							`Value: ${entry.value}`,
							others.length > 0
								? `Shares value: ${others.slice(0, 6).join(', ')}${others.length > 6 ? ` +${others.length - 6}` : ''}`
								: 'Unique value.',
							definition ? `Defined: ${definition}` : null,
							`Theme: ${kind === 'semantic' ? `semantic.${currentTheme()} (per base)` : 'raw map'}.`,
							'Tap Tint to pick a color.',
						]
							.filter(Boolean)
							.join('\n')
					: `${entry.value} · tap to tint`
			}
			subLabelLineClamp={expanded ? 7 : 1}
			trailing={expanded ? <TableRow.TrailingText text="Tint" /> : null}
			onPress={onPress}
		/>
	)
}

function TokenPage({ kind }: { kind: 'semantic' | 'raw' }) {
	const [filter, setFilter] = React.useState('')
	const [expanded, setExpanded] = React.useState<string | null>(null)
	const [shown, setShown] = React.useState(PAGE)

	React.useEffect(() => setShown(PAGE), [filter])

	const needle = filter.toLowerCase()
	const all = kind === 'semantic' ? semanticEntries() : rawEntries()
	const entries = all.filter(
		entry => needle === '' || entry.name.toLowerCase().includes(needle),
	)

	const handlePress = (entry: TokenEntry) => {
		setExpanded(current => (current === entry.name ? null : entry.name))
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
				ActionSheetActionCreators.hideActionSheet(SHEET_KEY)
			},
		})
	}

	return (
		<View>
			<SearchField
				value={filter}
				onChange={setFilter}
				placeholder={`Filter ${kind} tokens by name`}
			/>
			<TableRowGroup
				title={`${kind === 'semantic' ? 'Semantic' : 'Raw'} (${entries.length})`}
				description="Tap a token, pick a color. Elements are matched by color value."
				hasIcons
			>
				{entries.length === 0 ? (
					<TableRow label="No tokens matched." />
				) : (
					entries
						.slice(0, shown)
						.map(entry => (
							<TokenRow
								key={entry.name}
								entry={entry}
								kind={kind}
								expanded={expanded === entry.name}
								onPress={() => handlePress(entry)}
							/>
						))
				)}
				{entries.length > shown && (
					<TableRow
						label={`Show ${Math.min(PAGE, entries.length - shown)} more (${entries.length - shown} left)`}
						arrow
						onPress={() => setShown(value => value + PAGE)}
					/>
				)}
			</TableRowGroup>
		</View>
	)
}

function ElementsPage() {
	const [filter, setFilter] = React.useState('')
	const [expanded, setExpanded] = React.useState<string | null>(null)
	const [shown, setShown] = React.useState(ELEMENT_PAGE)
	const [scanning, setScanning] = React.useState(false)
	const [, setTick] = React.useState(0)

	const needle = filter.toLowerCase()
	const elements = cachedElements.filter(
		element =>
			needle === '' || element.chain.join('>').toLowerCase().includes(needle),
	)

	const handleScan = () => {
		if (!hasFiberRoot()) {
			toast('UI tree unavailable. Reload the plugin and try again.', 'critical')
			return
		}
		setScanning(true)
		try {
			cachedElements = scanColoredElements(MAX_ELEMENT_ROWS).map(element => ({
				...element,
				key: `${element.chain.join('>')}#${Math.random().toString(36).slice(2, 7)}`,
			}))
			setShown(ELEMENT_PAGE)
			setExpanded(null)
			setTick(value => value + 1)
		} finally {
			setScanning(false)
		}
	}

	const handleHighlightElement = (element: ElementRow) => {
		const first = element.colors.find(color => color.normalized)
		if (!first) return
		openDiscordColorPicker({
			color: rgbIntToHex(getLastPickedRgb()),
			onSelect: hex => {
				const found = highlightElement(element.chain, first.normalized, hex)
				toast(
					`Tinting ${element.chain[0] ?? 'element'} in ${hex}: ${found} element${found === 1 ? '' : 's'} colored in place.`,
					found > 0 ? 'success' : undefined,
				)
				ActionSheetActionCreators.hideActionSheet(SHEET_KEY)
			},
		})
	}

	return (
		<View>
			<SearchField
				value={filter}
				onChange={setFilter}
				placeholder="Filter elements by name"
			/>
			<TableRowGroup
				title="UI elements"
				description="Scan the live UI tree to see the tokens behind each element's colors."
			>
				<TableRow
					label={scanning ? 'Scanning…' : 'Scan visible UI'}
					arrow
					onPress={handleScan}
				/>
			</TableRowGroup>
			{cachedElements.length > 0 && (
				<TableRowGroup title={`Elements (${elements.length})`} hasIcons>
					{elements.slice(0, shown).map(element => {
						const isExpanded = expanded === element.key
						const details = colorDetails(element.colors)
						return (
							<React.Fragment key={element.key}>
								<TableRow
									icon={<Swatch value={element.colors[0]?.normalized} />}
									label={element.chain.join(' › ')}
									subLabel={
										isExpanded
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
									subLabelLineClamp={isExpanded ? 20 : 2}
									trailing={
										isExpanded ? <TableRow.TrailingText text="Tint" /> : null
									}
									onPress={() => {
										if (!isExpanded) {
											setExpanded(element.key)
											return
										}
										handleHighlightElement(element)
										setExpanded(null)
									}}
								/>
								{isExpanded && (
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
					{elements.length > shown && (
						<TableRow
							label={`Show ${Math.min(ELEMENT_PAGE, elements.length - shown)} more (${elements.length - shown} left)`}
							arrow
							onPress={() => setShown(value => value + ELEMENT_PAGE)}
						/>
					)}
				</TableRowGroup>
			)}
		</View>
	)
}

function ColorsBrowserSheet({ initial = 0 }: { initial?: number }) {
	const [pageWidth, setPageWidth] = React.useState(0)

	const items = React.useMemo(
		() => [
			{
				id: 'semantic',
				label: 'Semantic',
				count: semanticEntries().length,
				page: <TokenPage kind="semantic" />,
			},
			{
				id: 'raw',
				label: 'Raw',
				count: rawEntries().length,
				page: <TokenPage kind="raw" />,
			},
			{
				id: 'elements',
				label: 'Elements',
				count: browserElements().length,
				page: <ElementsPage />,
			},
		],
		[],
	)

	const state = useSegmentedControlState({
		items,
		pageWidth,
		defaultIndex: initial,
	})

	return (
		<ActionSheet scrollable>
			<BottomSheetTitleHeader title="Color browser" />
			<View
				style={{ flex: 1, gap: 20, paddingTop: 8 }}
				onLayout={event => setPageWidth(event.nativeEvent.layout.width)}
			>
				<View>
					<Tabs state={state} />
				</View>
				<SegmentedControlPages state={state} />
			</View>
		</ActionSheet>
	)
}

export function openColorsBrowser(initial: 0 | 1 | 2) {
	ActionSheetActionCreators.openLazy(
		Promise.resolve({ default: ColorsBrowserSheet }),
		SHEET_KEY,
		{ initial },
		'stack',
	)
}
