import { findElementsWithColor, markNative, unmarkNative } from './elementscan'
import type { NativeMark } from './elementscan'

export type ActiveHighlight = {
	/** Token name or element chain head — one highlight per id. */
	id: string
	label: string
	/** Tint color, `#RRGGBB`. */
	color: string
	matched: number
	marks: NativeMark[]
}

let active: ActiveHighlight[] = []
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

export function getHighlights(): readonly ActiveHighlight[] {
	return active
}

function tint(targets: { fiber: any }[], color: string) {
	const marks: NativeMark[] = []
	for (const target of targets) {
		const mark = markNative(target.fiber, color)
		if (mark) marks.push(mark)
	}
	return marks
}

/** Removes one highlight by id (or all of them) and restores the elements. */
export function stopHighlight(id?: string) {
	const keep: ActiveHighlight[] = []
	for (const item of active) {
		if (id === undefined || item.id === id) unmarkNative(item.marks)
		else keep.push(item)
	}
	active = keep
	notify()
}

/**
 * Colors every live element that uses the given normalized color, in the
 * chosen tint color. One highlight per id — picking again replaces it.
 */
export function highlightColor(
	id: string,
	label: string,
	value: string | null | undefined,
	color: string,
): number {
	stopHighlight(id)

	if (!value) {
		notify()
		return 0
	}

	const elements = findElementsWithColor(value)
	active = [
		...active,
		{
			id,
			label,
			color,
			matched: elements.length,
			marks: tint(elements, color),
		},
	]
	notify()
	return elements.length
}

/** Colors one element by name, preferring the exact chain match. */
export function highlightElement(
	chain: string[],
	value: string | null | undefined,
	color: string,
): number {
	const id = chain[0] ?? 'element'
	stopHighlight(id)

	if (!value) {
		notify()
		return 0
	}

	const elements = findElementsWithColor(value)
	const match = elements.find(
		element => element.chain.join('>') === chain.join('>'),
	)
	const targets = match ? [match] : elements.slice(0, 1)

	active = [
		...active,
		{
			id,
			label: id,
			color,
			matched: targets.length,
			marks: tint(targets, color),
		},
	]
	notify()
	return targets.length
}
