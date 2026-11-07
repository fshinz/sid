import { React, ReactNative } from '@valenced/react'
import { registerSkipRootOf, unregisterSkipRoot } from '../features/elementscan'
import { getHighlights, stopHighlight, subscribe } from '../features/highlight'

const { Pressable, StyleSheet, Text, View } = ReactNative

const ACCENT = '#FF2D9A'
const INK = '#FFFFFF'
const PANEL = 'rgba(17, 17, 17, 0.95)'

/** Wraps DevLab's screens and overlay widgets so their UI is skipped while scanning. */
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

/** Small status badge with the stop button while elements are tinted. */
export function HighlightLayer() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const highlights = getHighlights()

	React.useEffect(() => subscribe(rerender), [])
	if (!highlights.length) return null

	const total = highlights.reduce((sum, item) => sum + item.matched, 0)
	const labels = highlights.map(item => item.label).join(' · ')

	return (
		<View style={styles.badge} pointerEvents="box-none">
			<Text style={styles.badgeText} numberOfLines={1}>
				{`${labels} — ${total} element${total === 1 ? '' : 's'} tinted`}
			</Text>
			<Pressable style={styles.badgeButton} onPress={() => stopHighlight()}>
				<Text style={styles.buttonText}>Stop</Text>
			</Pressable>
		</View>
	)
}

const styles = StyleSheet.create({
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
		zIndex: 9998,
		elevation: 10,
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
})
