import { ToastActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import { SearchField } from '../components/SearchField'
import { TabScreen } from '../components/TabScreen'
import {
	displayColor,
	getCatalog,
	refreshCatalog,
	tokensForColor,
} from '../features/colors'
import { hasFiberRoot, scanColoredElements } from '../features/elementscan'
import {
	cancelPick,
	getHighlight,
	getPick,
	highlightElement,
	highlightToken,
	setPickMinimized,
	startPick,
	stopHighlight,
	subscribe,
} from '../features/highlight'
import type { ColorToken } from '../features/colors'
import type { ElementInfo, StyleColor } from '../features/elementscan'
import type { PickResult } from '../features/highlight'

const { Button, Stack, TableRow, TableRowGroup, Text } = Design
const { View } = ReactNative

const MAX_TOKEN_ROWS = 150
const MAX_ELEMENT_ROWS = 80
const TOAST_KEY = 'shin.devlab.colors'

type ElementRow = ElementInfo & { key: string }

function Swatch({ canonical }: { canonical: string | null }) {
	return (
		<View
			style={{
				width: 24,
				height: 24,
				borderRadius: 6,
				borderWidth: 1,
				borderColor: '#00000040',
				backgroundColor: canonical ?? 'transparent',
			}}
		/>
	)
}

function matchText(color: StyleColor) {
	const { semantic, raw } = tokensForColor(color.canonical)
	const names = [...semantic, ...raw].map(token => token.name)
	const line =
		names.length > 0 ? names.slice(0, 3).join(', ') : 'no token match'
	return `${line}${names.length > 3 ? ` +${names.length - 3}` : ''}`
}

function elementReport(element: { chain: string[]; colors: StyleColor[] }) {
	return `Element: ${element.chain.join(' > ')}\n\n${element.colors
		.map(color => {
			const { semantic, raw } = tokensForColor(color.canonical)
			return `${color.key}: ${displayColor(color.canonical)}\n  semantic: ${semantic.map(token => token.name).join(', ') || '—'}\n  raw: ${raw.map(token => token.name).join(', ') || '—'}`
		})
		.join('\n')}`
}

function TokenRow({
	token,
	expanded,
	onPress,
	onHighlight,
}: {
	token: ColorToken
	expanded: boolean
	onPress: () => void
	onHighlight: () => void
}) {
	return (
		<TableRow
			icon={<Swatch canonical={token.canonical} />}
			label={token.name}
			subLabel={
				expanded
					? [
							`Value: ${displayColor(token.canonical)}`,
							`Source: ${token.path}`,
							'Tap Highlight to outline every element using this color.',
						].join('\n')
					: `${displayColor(token.canonical)} · tap to highlight`
			}
			subLabelLineClamp={expanded ? 6 : 1}
			trailing={expanded ? <TableRow.TrailingText text="Highlight" /> : null}
			onPress={() => {
				onPress()
				onHighlight()
			}}
		/>
	)
}

function PickedReport({ result }: { result: PickResult }) {
	return (
		<TableRow
			label={result.chain.join(' › ')}
			subLabel={result.matches
				.map(
					match =>
						`${match.color.key}: ${displayColor(match.color.canonical)}\n  semantic: ${match.semantic.map(token => token.name).join(', ') || '—'}\n  raw: ${match.raw.map(token => token.name).join(', ') || '—'}`,
				)
				.join('\n')}
			subLabelLineClamp={24}
			trailing={<TableRow.TrailingText text="Copy" />}
			onPress={() =>
				Clipboard.setString(
					`Element: ${result.chain.join(' > ')}\n\n${result.matches
						.map(
							match =>
								`${match.color.key}: ${displayColor(match.color.canonical)}\n  semantic: ${match.semantic.map(token => token.name).join(', ') || '—'}\n  raw: ${match.raw.map(token => token.name).join(', ') || '—'}`,
						)
						.join('\n')}`,
				)
			}
		/>
	)
}

export function ColorsTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const [filter, setFilter] = React.useState('')
	const [cataloged, setCataloged] = React.useState(() => getCatalog())
	const [expandedToken, setExpandedToken] = React.useState<string | null>(null)
	const [expandedElement, setExpandedElement] = React.useState<string | null>(
		null,
	)
	const [elements, setElements] = React.useState<ElementRow[]>([])
	const [scanning, setScanning] = React.useState(false)

	React.useEffect(() => subscribe(rerender), [])

	const highlight = getHighlight()
	const pick = getPick()

	const handleRefresh = () => {
		setCataloged(refreshCatalog())
		setExpandedToken(null)
	}

	const handleTokenPress = (token: ColorToken) => {
		highlightToken(token).then(found => {
			if (found === 0) {
				ToastActionCreators.open(TOAST_KEY, {
					text: `No visible elements use ${token.name}.`,
				})
			} else if (found > 0) {
				ToastActionCreators.open(TOAST_KEY, {
					text: `Highlighting ${token.name} — ${found} element${found === 1 ? '' : 's'}.`,
					variant: 'success',
				})
			}
		})
	}

	const handleScanElements = () => {
		if (!hasFiberRoot()) {
			ToastActionCreators.open(TOAST_KEY, {
				text: 'UI tree unavailable. Reload the plugin and try again.',
				variant: 'critical',
			})
			return
		}

		setScanning(true)
		try {
			const found = scanColoredElements(MAX_ELEMENT_ROWS).map(element => ({
				...element,
				key: `${element.chain.join('>')}#${element.fiber?.index ?? Math.random().toString(36).slice(2, 7)}`,
			}))
			setElements(found)
		} finally {
			setScanning(false)
		}
	}

	const handleHighlightElement = (element: ElementRow) => {
		const canonical = element.colors.find(color => color.canonical)?.canonical
		if (!canonical) return
		highlightElement(element.chain, canonical).then(found => {
			ToastActionCreators.open(TOAST_KEY, {
				text: `Highlighting ${element.chain[0] ?? 'element'} — ${found} element${found === 1 ? '' : 's'}.`,
				variant: found > 0 ? 'success' : 'default',
			})
		})
	}

	const handleCopyElement = (element: ElementRow) => {
		Clipboard.setString(elementReport(element))
	}

	const needle = filter.toLowerCase()
	const semantic = cataloged.semantic.filter(
		token => needle === '' || token.name.toLowerCase().includes(needle),
	)
	const raw = cataloged.raw.filter(
		token => needle === '' || token.name.toLowerCase().includes(needle),
	)

	const renderToken = (token: ColorToken) => (
		<TokenRow
			key={`${token.kind}:${token.name}`}
			token={token}
			expanded={expandedToken === token.path}
			onPress={() =>
				setExpandedToken(current =>
					current === token.path ? null : token.path,
				)
			}
			onHighlight={() => handleTokenPress(token)}
		/>
	)

	return (
		<TabScreen>
			<TableRowGroup
				title="Theme colors"
				description="Semantic and raw color tokens with their current values. Tap a token to outline every element using it — the name is what you put in the theme."
			>
				<TableRow
					label="Semantic tokens"
					trailing={
						<TableRow.TrailingText text={String(cataloged.semantic.length)} />
					}
				/>
				<TableRow
					label="Raw tokens"
					trailing={
						<TableRow.TrailingText text={String(cataloged.raw.length)} />
					}
				/>
			</TableRowGroup>

			<Stack direction="horizontal" spacing={8}>
				<Button
					text="Refresh values"
					variant="secondary"
					grow
					onPress={handleRefresh}
				/>
				<Button
					text="Inspect element"
					variant="primary"
					grow
					onPress={startPick}
				/>
			</Stack>

			{pick?.active && (
				<TableRowGroup title="Pick mode">
					<TableRow
						label="Tap an element to read its colors."
						subLabel={
							pick.result
								? `Selected: ${pick.result.chain.join(' › ')}`
								: pick.scanning
									? `Reading UI tree… (${pick.scanned} views)`
									: pick.minimized
										? 'Overlay is minimized — navigate around, then tap the DevLab pill to pick.'
										: 'The overlay is waiting for a tap.'
						}
						trailing={<TableRow.TrailingText text="Cancel" />}
						onPress={cancelPick}
					/>
					<TableRow
						label={pick.minimized ? 'Show capture overlay' : 'Minimize overlay'}
						subLabel="Minimize to navigate to another screen before picking."
						arrow
						onPress={() => setPickMinimized(!pick.minimized)}
					/>
				</TableRowGroup>
			)}

			{highlight && (
				<TableRowGroup title="Highlighting">
					<TableRow
						label={highlight.label}
						subLabel={
							highlight.scanning
								? `Scanning… ${highlight.matched} matches so far`
								: `${highlight.matched} element${highlight.matched === 1 ? '' : 's'} outlined. Navigate around — marks stay until you stop.`
						}
						trailing={<TableRow.TrailingText text="Stop" />}
						onPress={stopHighlight}
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
					semantic.slice(0, MAX_TOKEN_ROWS).map(token => renderToken(token))
				)}
				{semantic.length > MAX_TOKEN_ROWS && (
					<TableRow
						label={`${semantic.length - MAX_TOKEN_ROWS} more. Narrow the filter to see them.`}
					/>
				)}
			</TableRowGroup>

			<TableRowGroup title={`Raw (${raw.length})`} hasIcons>
				{raw.length === 0 ? (
					<TableRow label="No raw tokens matched." />
				) : (
					raw.slice(0, MAX_TOKEN_ROWS).map(token => renderToken(token))
				)}
				{raw.length > MAX_TOKEN_ROWS && (
					<TableRow
						label={`${raw.length - MAX_TOKEN_ROWS} more. Narrow the filter to see them.`}
					/>
				)}
			</TableRowGroup>

			<TableRowGroup
				title="UI elements"
				description="Scan the live UI tree to see which semantic and raw colors each visible element uses."
			>
				<TableRow
					label={scanning ? 'Scanning…' : 'Scan visible UI'}
					subLabel="Lists elements currently rendered, with the tokens behind their colors."
					arrow
					onPress={handleScanElements}
				/>
			</TableRowGroup>

			{elements.length > 0 && (
				<TableRowGroup title={`Elements (${elements.length})`}>
					{elements.map(element => {
						const expanded = expandedElement === element.key
						return (
							<React.Fragment key={element.key}>
								<TableRow
									label={element.chain.join(' › ')}
									subLabel={
										expanded
											? element.colors
													.map(
														color =>
															`${color.key}: ${displayColor(color.canonical)}\n  ${matchText(color)}`,
													)
													.join('\n')
											: element.colors
													.map(
														color =>
															`${color.key}: ${displayColor(color.canonical)}`,
													)
													.join(' · ')
									}
									subLabelLineClamp={expanded ? 20 : 2}
									trailing={
										expanded ? <TableRow.TrailingText text="Highlight" /> : null
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
										onPress={() => handleCopyElement(element)}
									/>
								)}
							</React.Fragment>
						)
					})}
				</TableRowGroup>
			)}

			{pick?.result && (
				<TableRowGroup title="Picked element">
					<PickedReport result={pick.result} />
				</TableRowGroup>
			)}

			<Text variant="text-sm/normal" color="text-muted">
				Tip: long-press an element row to copy its full report.
			</Text>
		</TabScreen>
	)
}
