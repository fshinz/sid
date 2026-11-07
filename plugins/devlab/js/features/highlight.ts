import { findElementsWithColor, markNative, unmarkNative } from './elementscan'
import type { NativeMark } from './elementscan'

export type HighlightState = {
	label: string
	matched: number
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

function tint(targets: { fiber: any }[]) {
	for (const target of targets) {
		const mark = markNative(target.fiber)
		if (mark) nativeMarks.push(mark)
	}
}

/**
 * Colors every live element that uses the given normalized color, in place.
 * Pass a token's current value to see where it lands in the UI.
 */
export function highlightColor(
	label: string,
	value: string | null | undefined,
): number {
	stopHighlight()

	if (!value) {
		setHighlight({ label, matched: 0 })
		return 0
	}

	const elements = findElementsWithColor(value)
	tint(elements)
	setHighlight({ label, matched: elements.length })
	return elements.length
}

/** Colors one element by name, preferring the exact chain match. */
export function highlightElement(
	chain: string[],
	value: string | null | undefined,
): number {
	stopHighlight()

	if (!value) {
		setHighlight({ label: chain[0] ?? 'element', matched: 0 })
		return 0
	}

	const elements = findElementsWithColor(value)
	const match = elements.find(
		element => element.chain.join('>') === chain.join('>'),
	)
	const targets = match ? [match] : elements.slice(0, 1)

	tint(targets)
	setHighlight({ label: chain[0] ?? 'element', matched: targets.length })
	return targets.length
}
