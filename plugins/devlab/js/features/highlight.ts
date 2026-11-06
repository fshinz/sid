import { tokensForColor } from './colors'
import {
	buildLayoutIndex,
	findElementsWithColor,
	hasFiberRoot,
	hitTestLayout,
	markNative,
	styleColors,
	unmarkNative,
} from './elementscan'
import type { ColorToken } from './colors'
import type { NativeMark, Rect, StyleColor } from './elementscan'

export type HighlightRect = Rect & { color: string }

export type HighlightState = {
	label: string
	rects: HighlightRect[]
	matched: number
	scanning: boolean
} | null

export type PickMatch = {
	color: StyleColor
	semantic: ColorToken[]
	raw: ColorToken[]
}

export type PickResult = {
	chain: string[]
	rect: Rect | null
	matches: PickMatch[]
}

export type PickState = {
	active: boolean
	/** When true, the capture overlay is hidden behind a pill so the app can be navigated. */
	minimized: boolean
	scanning: boolean
	scanned: number
	result: PickResult | null
} | null

export type StoreSnapshot = {
	highlight: HighlightState
	pick: PickState
}

let highlight: HighlightState = null
let pick: PickState = null
let nativeMarks: NativeMark[] = []
const listeners = new Set<() => void>()

function notify() {
	for (const listener of [...listeners]) {
		try {
			listener()
		} catch (error) {
			console.error('[DevLab] Highlight listener failed:', error)
		}
	}
}

export function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getHighlight(): HighlightState {
	return highlight
}

export function getPick(): PickState {
	return pick
}

function setHighlight(state: HighlightState) {
	highlight = state
	notify()
}

function setPick(state: PickState) {
	pick = state
	notify()
}

function restoreNativeMarks() {
	unmarkNative(nativeMarks)
	nativeMarks = []
}

export function stopHighlight() {
	restoreNativeMarks()
	setHighlight(null)
}

export function cancelPick() {
	setPick(null)
}

export function clearPickResult() {
	if (pick) setPick({ ...pick, result: null })
}

export function describeMatches(matches: PickMatch[]) {
	const lines: string[] = []
	for (const { color, semantic, raw } of matches) {
		lines.push(`${color.key}: ${color.canonical ?? String(color.value)}`)
		if (semantic.length > 0) {
			lines.push(`  semantic: ${semantic.map(token => token.name).join(', ')}`)
		}
		if (raw.length > 0) {
			lines.push(`  raw: ${raw.map(token => token.name).join(', ')}`)
		}
	}
	return lines.join('\n')
}

function matchColors(colors: StyleColor[]): PickMatch[] {
	return colors
		.filter(color => color.canonical)
		.map(color => {
			const matches = tokensForColor(color.canonical)
			return { color, semantic: matches.semantic, raw: matches.raw }
		})
}

/** Highlights every visible element using the token's current color. */
export async function highlightToken(token: ColorToken): Promise<number> {
	stopHighlight()
	clearPickResult()

	if (!token.canonical) {
		setHighlight({
			label: token.name,
			rects: [],
			matched: 0,
			scanning: false,
		})
		return 0
	}

	setHighlight({
		label: token.name,
		rects: [],
		matched: 0,
		scanning: true,
	})

	if (!hasFiberRoot()) {
		setHighlight({
			label: token.name,
			rects: [],
			matched: 0,
			scanning: false,
		})
		return -1
	}

	const elements = await findElementsWithColor(token.canonical, found =>
		setHighlight({
			label: token.name,
			rects: [],
			matched: found,
			scanning: true,
		}),
	)

	for (const element of elements) {
		const mark = markNative(element.fiber)
		if (mark) nativeMarks.push(mark)
	}

	const rects: HighlightRect[] = []
	for (const element of elements) {
		if (element.rect) {
			rects.push({ ...element.rect, color: token.canonical })
		}
	}

	setHighlight({
		label: token.name,
		rects,
		matched: elements.length,
		scanning: false,
	})
	return elements.length
}

/** Starts pick mode; taps are captured by the overlay host. */
export function startPick() {
	stopHighlight()
	setPick({
		active: true,
		minimized: false,
		scanning: false,
		scanned: 0,
		result: null,
	})
}

export function setPickMinimized(value: boolean) {
	if (pick) setPick({ ...pick, minimized: value })
}

/** Resolves the tapped point into an element with its color tokens. */
export async function pickAt(x: number, y: number) {
	if (!pick?.active) return
	const { minimized } = pick

	setPick({ ...pick, scanning: true, scanned: 0 })
	const layout = await buildLayoutIndex(done =>
		setPick({
			active: true,
			minimized,
			scanning: true,
			scanned: done,
			result: null,
		}),
	)
	const entry = hitTestLayout(layout, x, y)

	if (!entry) {
		setPick({
			active: true,
			minimized,
			scanning: false,
			scanned: layout.length,
			result: null,
		})
		return
	}

	const colors = styleColors(entry.fiber)
	setPick({
		active: true,
		minimized,
		scanning: false,
		scanned: layout.length,
		result: {
			chain: entry.chain,
			rect: entry.rect,
			matches: matchColors(colors),
		},
	})
}

/** Builds a result for an element from the tree list. */
export function inspectElement(
	chain: string[],
	rect: Rect | null,
	colors: StyleColor[],
) {
	stopHighlight()
	setPick({
		active: true,
		minimized: false,
		scanning: false,
		scanned: 0,
		result: { chain, rect, matches: matchColors(colors) },
	})
}

/** Highlights one element from the tree list or pick result. */
export async function highlightElement(
	chain: string[],
	canonical: string | null,
): Promise<number> {
	if (!canonical) return 0
	stopHighlight()
	setHighlight({
		label: chain[0] ?? 'element',
		rects: [],
		matched: 0,
		scanning: true,
	})

	const elements = await findElementsWithColor(canonical)
	const match = elements.find(
		element => element.chain.join('>') === chain.join('>'),
	)
	const targets = match ? [match] : elements.slice(0, 1)

	for (const element of targets) {
		const mark = markNative(element.fiber)
		if (mark) nativeMarks.push(mark)
	}

	const rects: HighlightRect[] = []
	for (const element of targets) {
		if (element.rect) rects.push({ ...element.rect, color: canonical })
	}

	setHighlight({
		label: chain[0] ?? 'element',
		rects,
		matched: targets.length,
		scanning: false,
	})
	return targets.length
}
