import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React, ReactNative } from '@valenced/react'
import {
	captureFromInstance,
	registerSkipRootOf,
	unregisterSkipRoot,
} from '../features/elementscan'
import {
	cancelPick,
	clearPickResult,
	describeMatches,
	getHighlight,
	getPick,
	highlightElement,
	pickAt,
	setPickMinimized,
	stopHighlight,
	subscribe,
} from '../features/highlight'
import type { PickMatch } from '../features/highlight'

const { Pressable, StyleSheet, Text, View } = ReactNative

const ACCENT = '#FF2D9A'
const INK = '#FFFFFF'
const PANEL = 'rgba(17, 17, 17, 0.95)'

// Only the first mounted host renders the overlay layer, so the window never
// shows duplicate rectangles.
const hosts = new Set<HighlightHost>()
let layerHost: HighlightHost | null = null

function claimLayer(host: HighlightHost) {
	hosts.add(host)
	if (!layerHost) layerHost = host
}

function releaseLayer(host: HighlightHost) {
	hosts.delete(host)
	if (layerHost === host) {
		layerHost = null
		for (const candidate of hosts) {
			layerHost = candidate
			candidate.forceUpdate()
			break
		}
	}
}

/** Wraps DevLab's screens so their UI is skipped while scanning. */
export class DevLabMarker extends React.Component<{
	children?: React.ReactNode
}> {
	private skipFiber: unknown = null

	componentDidMount() {
		this.skipFiber = registerSkipRootOf(this)
	}

	componentWillUnmount() {
		if (this.skipFiber) unregisterSkipRoot(this.skipFiber)
	}

	render() {
		return this.props.children ?? null
	}
}

function MatchLines({ matches }: { matches: PickMatch[] }) {
	return (
		<>
			{matches.map(({ color, semantic, raw }) => (
				<View key={color.key} style={styles.matchBlock}>
					<View style={styles.matchRow}>
						<View
							style={[
								styles.swatch,
								{
									backgroundColor: color.canonical ?? 'transparent',
								},
							]}
						/>
						<Text style={styles.matchKey}>
							{color.key} · {color.canonical ?? 'unknown'}
						</Text>
					</View>
					{semantic.length > 0 && (
						<Text style={styles.matchTokens}>
							semantic: {semantic.map(token => token.name).join(', ')}
						</Text>
					)}
					{raw.length > 0 && (
						<Text style={styles.matchTokens}>
							raw: {raw.map(token => token.name).join(', ')}
						</Text>
					)}
					{semantic.length === 0 && raw.length === 0 && (
						<Text style={styles.matchTokens}>
							no matching token names for this value
						</Text>
					)}
				</View>
			))}
		</>
	)
}

function HighlightLayer() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const highlight = getHighlight()
	const pick = getPick()

	React.useEffect(() => subscribe(rerender), [])

	const handlePickRelease = (event: any) => {
		const { pageX, pageY } = event.nativeEvent ?? {}
		if (typeof pageX === 'number' && typeof pageY === 'number') {
			pickAt(pageX, pageY)
		}
	}

	const handleCopyReport = () => {
		if (!pick?.result) return
		Clipboard.setString(
			`Element: ${pick.result.chain.join(' > ')}\n\n${describeMatches(pick.result.matches)}`,
		)
	}

	const handleHighlightElement = () => {
		if (!pick?.result) return
		const canonical = pick.result.matches.find(match => match.color.canonical)
			?.color.canonical
		if (canonical) highlightElement(pick.result.chain, canonical)
	}

	const pickActive = !!pick?.active && !pick.result && !pick.minimized
	const pickPill = !!pick?.active && !pick.result && pick.minimized

	return (
		<View
			style={StyleSheet.absoluteFill}
			pointerEvents={pickActive ? 'auto' : 'box-none'}
			{...(pickActive
				? {
						onStartShouldSetResponder: () => true,
						onResponderRelease: handlePickRelease,
					}
				: {})}
		>
			{highlight?.rects.map((rect, index) => (
				<View
					key={`${rect.x}-${rect.y}-${index}`}
					pointerEvents="none"
					style={[
						styles.rect,
						{
							left: rect.x,
							top: rect.y,
							width: rect.width,
							height: rect.height,
						},
					]}
				/>
			))}

			{highlight && (
				<View style={styles.badge} pointerEvents="box-none">
					<Text style={styles.badgeText} numberOfLines={1}>
						{highlight.scanning
							? `Scanning for ${highlight.label}… (${highlight.matched})`
							: `${highlight.label} — ${highlight.matched} element${highlight.matched === 1 ? '' : 's'}`}
					</Text>
					<Pressable style={styles.badgeButton} onPress={stopHighlight}>
						<Text style={styles.buttonText}>Stop</Text>
					</Pressable>
				</View>
			)}

			{pickActive && (
				<View style={styles.pickBar} pointerEvents="box-none">
					<Text style={styles.pickText} numberOfLines={2}>
						{pick?.scanning
							? `Reading UI tree… (${pick.scanned} views)`
							: 'Tap any visible element to see its semantic and raw colors.'}
					</Text>
					<Pressable
						style={styles.badgeButton}
						onPress={() => setPickMinimized(true)}
					>
						<Text style={styles.buttonText}>Navigate</Text>
					</Pressable>
					<Pressable style={styles.badgeButton} onPress={cancelPick}>
						<Text style={styles.buttonText}>Cancel</Text>
					</Pressable>
				</View>
			)}

			{pickPill && (
				<View style={styles.pillWrap} pointerEvents="box-none">
					<Pressable
						style={styles.pill}
						onPress={() => setPickMinimized(false)}
					>
						<Text style={styles.buttonText}>DevLab · tap to pick</Text>
					</Pressable>
				</View>
			)}

			{pick?.result && (
				<View style={styles.sheet} pointerEvents="auto">
					<Text style={styles.sheetTitle} numberOfLines={2}>
						{pick.result.chain.join(' › ')}
					</Text>
					{pick.result.matches.length === 0 ? (
						<Text style={styles.matchTokens}>
							This element does not use any colors.
						</Text>
					) : (
						<MatchLines matches={pick.result.matches} />
					)}
					<View style={styles.buttonRow}>
						<Pressable style={styles.primaryButton} onPress={handleCopyReport}>
							<Text style={styles.buttonText}>Copy report</Text>
						</Pressable>
						<Pressable
							style={styles.primaryButton}
							onPress={handleHighlightElement}
						>
							<Text style={styles.buttonText}>Highlight</Text>
						</Pressable>
						<Pressable
							style={styles.badgeButton}
							onPress={() => {
								clearPickResult()
								cancelPick()
							}}
						>
							<Text style={styles.buttonText}>Done</Text>
						</Pressable>
					</View>
				</View>
			)}
		</View>
	)
}

type HighlightHostProps = {
	children?: React.ReactNode
}

export class HighlightHost extends React.Component<HighlightHostProps> {
	constructor(props: HighlightHostProps) {
		super(props)
		claimLayer(this)
	}

	componentDidMount() {
		captureFromInstance(this)
	}

	componentWillUnmount() {
		releaseLayer(this)
	}

	render() {
		return (
			<>
				{this.props.children ?? null}
				{layerHost === this ? (
					<DevLabMarker>
						<HighlightLayer />
					</DevLabMarker>
				) : null}
			</>
		)
	}
}

const styles = StyleSheet.create({
	rect: {
		position: 'absolute',
		borderWidth: 2,
		borderColor: ACCENT,
		backgroundColor: 'rgba(255, 45, 154, 0.16)',
		borderRadius: 4,
	},
	badge: {
		position: 'absolute',
		top: 52,
		left: 16,
		right: 16,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: PANEL,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: ACCENT,
		padding: 10,
	},
	badgeText: {
		flex: 1,
		color: INK,
		fontSize: 12,
		fontWeight: '600',
	},
	badgeButton: {
		backgroundColor: '#3A3A3A',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 6,
	},
	buttonText: {
		color: INK,
		fontSize: 12,
		fontWeight: '600',
	},
	pickBar: {
		position: 'absolute',
		top: 52,
		left: 16,
		right: 16,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		backgroundColor: PANEL,
		borderRadius: 10,
		borderWidth: 1,
		borderColor: ACCENT,
		padding: 10,
	},
	pickText: {
		flex: 1,
		color: INK,
		fontSize: 12,
	},
	pillWrap: {
		position: 'absolute',
		left: 0,
		right: 0,
		bottom: 96,
		alignItems: 'center',
	},
	pill: {
		backgroundColor: PANEL,
		borderColor: ACCENT,
		borderWidth: 1,
		borderRadius: 16,
		paddingHorizontal: 14,
		paddingVertical: 8,
	},
	sheet: {
		position: 'absolute',
		left: 12,
		right: 12,
		bottom: 24,
		backgroundColor: PANEL,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: ACCENT,
		padding: 12,
		gap: 6,
		maxHeight: 380,
	},
	sheetTitle: {
		color: INK,
		fontSize: 13,
		fontWeight: '700',
	},
	matchBlock: {
		gap: 2,
		marginBottom: 4,
	},
	matchRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	swatch: {
		width: 12,
		height: 12,
		borderRadius: 3,
		borderWidth: 1,
		borderColor: '#00000066',
	},
	matchKey: {
		color: INK,
		fontSize: 12,
		fontFamily: 'monospace',
	},
	matchTokens: {
		color: '#C9C9C9',
		fontSize: 11,
		fontFamily: 'monospace',
	},
	buttonRow: {
		flexDirection: 'row',
		gap: 8,
		marginTop: 4,
	},
	primaryButton: {
		backgroundColor: ACCENT,
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 6,
	},
})
