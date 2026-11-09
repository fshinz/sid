import {
	findElementsWithColor,
	markNative,
	propsColorValues,
	unmarkNative,
} from './elementscan'
import { addElementTransform } from './inspect'
import type { NativeMark } from './elementscan'

export type ActiveHighlight = {
	id: string
	label: string
	color: string
	value: string
	only?: string
	matched: number
	marks: NativeMark[]
}

let active: ActiveHighlight[] = []
const listeners = new Set<() => void>()
let transformOff: (() => void) | undefined
let nudge: (() => void) | undefined

export function setHighlightNudge(fn: () => void) {
	nudge = fn
}

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

function nameOf(type: any): string | undefined {
	if (typeof type === 'string') return type
	if (typeof type === 'function')
		return type.displayName || type.name || undefined
	if (type && typeof type === 'object') {
		return (
			type.displayName ||
			type.render?.displayName ||
			type.render?.name ||
			type.type?.displayName ||
			type.type?.name
		)
	}
}

function tintTransform(type: any, props: any) {
	if (!active.length || !props || typeof props !== 'object') return
	const values = propsColorValues(props)
	if (!values.length) return

	for (const item of active) {
		if (!values.includes(item.value)) continue
		if (item.only && nameOf(type) !== item.only) continue
		return {
			...props,
			style: [
				props.style,
				{
					backgroundColor: `${item.color}66`,
					borderColor: item.color,
					borderWidth: 2,
					borderStyle: 'solid',
				},
			],
		}
	}
}

function syncTransform() {
	if (active.length && !transformOff) {
		transformOff = addElementTransform(tintTransform)
	} else if (!active.length && transformOff) {
		transformOff()
		transformOff = undefined
	}
}

function tint(targets: { fiber: any }[], color: string) {
	const marks: NativeMark[] = []
	for (const target of targets) {
		const mark = markNative(target.fiber, color)
		if (mark) marks.push(mark)
	}
	return marks
}

export function stopHighlight(id?: string) {
	const keep: ActiveHighlight[] = []
	for (const item of active) {
		if (id === undefined || item.id === id) unmarkNative(item.marks)
		else keep.push(item)
	}
	active = keep
	syncTransform()
	nudge?.()
	notify()
}

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
			value,
			matched: elements.length,
			marks: tint(elements, color),
		},
	]
	syncTransform()

	nudge?.()
	notify()
	return elements.length
}

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
	const only = nameOf(targets[0]?.fiber?.type) ?? id

	active = [
		...active,
		{
			id,
			label: id,
			color,
			value,
			only,
			matched: targets.length,
			marks: tint(targets, color),
		},
	]
	syncTransform()
	nudge?.()
	notify()
	return targets.length
}
