import { findElementsWithColor, markNative, unmarkNative } from './elementscan'
import type { NativeMark, Rect } from './elementscan'

export type HighlightRect = Rect & { color: string }

export type HighlightState = {
	label: string
	rects: HighlightRect[]
	matched: number
	scanning: boolean
} | null

let highlight: HighlightState = null
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

function setHighlight(state: HighlightState) {
	highlight = state
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

/**
 * Highlights every visible element whose style uses the given normalized
 * color. The value is what theme tokens resolve to, so pass a token's
 * current value to see where it lands in the UI.
 */
export async function highlightColor(
	label: string,
	value: string | null | undefined,
): Promise<number> {
	stopHighlight()

	if (!value) {
		setHighlight({ label, rects: [], matched: 0, scanning: false })
		return 0
	}

	setHighlight({ label, rects: [], matched: 0, scanning: true })

	const elements = await findElementsWithColor(value, found =>
		setHighlight({ label, rects: [], matched: found, scanning: true }),
	)

	for (const element of elements) {
		const mark = markNative(element.fiber)
		if (mark) nativeMarks.push(mark)
	}

	const rects: HighlightRect[] = []
	for (const element of elements) {
		if (element.rect) rects.push({ ...element.rect, color: value })
	}

	setHighlight({ label, rects, matched: elements.length, scanning: false })
	return elements.length
}

/** Highlights one element by name, preferring the exact chain match. */
export async function highlightElement(
	chain: string[],
	value: string | null | undefined,
): Promise<number> {
	if (!value) return 0
	stopHighlight()
	setHighlight({
		label: chain[0] ?? 'element',
		rects: [],
		matched: 0,
		scanning: true,
	})

	const elements = await findElementsWithColor(value)
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
		if (element.rect) rects.push({ ...element.rect, color: value })
	}

	setHighlight({
		label: chain[0] ?? 'element',
		rects,
		matched: targets.length,
		scanning: false,
	})
	return targets.length
}
