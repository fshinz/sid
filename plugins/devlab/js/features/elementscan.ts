import { ReactNative } from '@valenced/react'
import { safely } from './sanitize'
import { normalizeColor } from './tokens'

export type StyleColor = {
	key: string
	/** Normalized lowercase `#rrggbb` or `#rrggbbaa`, or null. */
	normalized: string | null
	value: unknown
}

export type ElementInfo = {
	chain: string[]
	colors: StyleColor[]
}

type Fiber = any

const STYLE_COLOR_KEYS = [
	'color',
	'backgroundColor',
	'borderColor',
	'borderTopColor',
	'borderRightColor',
	'borderBottomColor',
	'borderLeftColor',
	'borderStartColor',
	'borderEndColor',
	'tintColor',
	'shadowColor',
	'textDecorationColor',
	'overlayColor',
]

// Subtrees that belong to DevLab's own UI are skipped while scanning.
const skipRoots = new Set<Fiber>()
let fiberRoot: any = null

export function registerSkipRoot(fiber: Fiber) {
	skipRoots.add(fiber)
}

/** Registers the subtree of a mounted class instance as DevLab-internal UI. */
export function registerSkipRootOf(instance: unknown) {
	const fiber = fiberOf(instance)
	if (fiber) {
		skipRoots.add(fiber)
		captureFromInstance(instance)
	}
	return fiber ?? null
}

export function unregisterSkipRoot(fiber: Fiber) {
	skipRoots.delete(fiber)
}

function fiberOf(instance: unknown): Fiber | null {
	if (!instance || typeof instance !== 'object') return null
	const any = instance as Record<string, unknown>
	if (any._reactInternals) return any._reactInternals
	if (any._reactInternalFiber) return any._reactInternalFiber
	for (const key of Object.keys(any)) {
		if (
			key.startsWith('__reactFiber$') ||
			key.startsWith('__reactInternalInstance$')
		) {
			return any[key]
		}
	}
	return null
}

/** Remembers the React fiber root from any mounted class or host instance. */
export function captureFromInstance(instance: unknown) {
	const fiber = fiberOf(instance)
	if (!fiber) return

	let root = fiber
	while (root.return) root = root.return

	const candidate = root.stateNode
	if (candidate?.current) fiberRoot = candidate
	else fiberRoot = root
}

export function hasFiberRoot() {
	return !!fiberRoot
}

function rootChild(): Fiber | null {
	if (!fiberRoot) return null
	return fiberRoot.current?.child ?? fiberRoot.child ?? null
}

/** Yields every host (native view) fiber in the live tree, skipping DevLab's UI. */
export function* walkHostFibers(): Generator<Fiber> {
	const first = rootChild()
	if (!first) return

	const stack: Fiber[] = [first]
	while (stack.length > 0) {
		const fiber = stack.pop()
		if (!fiber) continue
		if (skipRoots.has(fiber)) continue

		if (typeof fiber.type === 'string') yield fiber
		if (fiber.child) stack.push(fiber.child)
		if (fiber.sibling) stack.push(fiber.sibling)
	}
}

export function nameOfFiber(fiber: Fiber): string | null {
	const type = fiber?.type
	if (typeof type === 'string') return type
	if (typeof type === 'function') return type.displayName || type.name || null
	if (type && typeof type === 'object') {
		if (type.displayName) return type.displayName
		const inner = type.render || type.type
		if (typeof inner === 'function') {
			return inner.displayName || inner.name || null
		}
	}
	return null
}

/** Nearest component names from the element outward, such as `['ChatInput', 'View']`. */
export function componentChain(fiber: Fiber, limit = 8): string[] {
	const names: string[] = []
	let current = fiber
	while (current && names.length < limit) {
		const name = nameOfFiber(current)
		if (name && names[names.length - 1] !== name) names.push(name)
		current = current.return
	}
	return names
}

export function styleColors(fiber: Fiber): StyleColor[] {
	const props = fiber?.memoizedProps
	if (!props) return []

	const out: StyleColor[] = []
	const seen = new Set<string>()

	const push = (key: string, value: unknown) => {
		if (value === null || value === undefined || seen.has(key)) return
		seen.add(key)
		out.push({ key, normalized: normalizeColor(value) ?? null, value })
	}

	let flat: any = props.style
	try {
		flat = ReactNative.StyleSheet.flatten(props.style) ?? flat
	} catch {
		// Keep the raw style value.
	}

	if (flat && typeof flat === 'object') {
		for (const key of STYLE_COLOR_KEYS) push(key, flat[key])
	}

	// <Text color="#fff"> style props outside of styles.
	if (typeof props.color === 'string' || typeof props.color === 'number') {
		push('color', props.color)
	}

	return out
}

/** Live elements whose style uses the given normalized color. */
export function findElementsWithColor(
	normalized: string,
	limit = 120,
): { fiber: Fiber; chain: string[] }[] {
	const out: { fiber: Fiber; chain: string[] }[] = []
	for (const fiber of walkHostFibers()) {
		const colors = styleColors(fiber)
		if (colors.some(color => color.normalized === normalized)) {
			out.push({ fiber, chain: componentChain(fiber) })
			if (out.length >= limit) break
		}
	}
	return out
}

/** Visible elements that use at least one color, for the element list. */
export function scanColoredElements(limit = 200): {
	fiber: Fiber
	chain: string[]
	colors: StyleColor[]
}[] {
	const out: { fiber: Fiber; chain: string[]; colors: StyleColor[] }[] = []
	for (const fiber of walkHostFibers()) {
		const colors = styleColors(fiber).filter(color => color.normalized)
		if (colors.length === 0) continue
		out.push({ fiber, chain: componentChain(fiber), colors })
		if (out.length >= limit) break
	}
	return out
}

export type NativeMark = {
	instance: any
	backgroundColor?: any
	borderWidth?: any
	borderColor?: any
	borderStyle?: any
}

const TINT_ALPHA = '66'

/**
 * Colors the element itself (translucent fill + border) in the given
 * `#rrggbb` color so it is obvious which element it is. The original styles
 * are saved on the mark.
 */
export function markNative(fiber: Fiber, color: string): NativeMark | null {
	const instance = fiber?.stateNode
	if (!instance || typeof instance.setNativeProps !== 'function') return null

	try {
		let flat: any = {}
		try {
			flat = ReactNative.StyleSheet.flatten(fiber.memoizedProps?.style) ?? {}
		} catch {
			// Use empty defaults.
		}

		const mark: NativeMark = {
			instance,
			backgroundColor: flat.backgroundColor,
			borderWidth: flat.borderWidth,
			borderColor: flat.borderColor,
			borderStyle: flat.borderStyle,
		}

		instance.setNativeProps({
			style: {
				backgroundColor: `${color}${TINT_ALPHA}`,
				borderWidth: 2,
				borderColor: color,
				borderStyle: 'solid',
			},
		})
		return mark
	} catch {
		return null
	}
}

export function unmarkNative(marks: NativeMark[]) {
	for (const mark of marks) {
		safely(() =>
			mark.instance?.setNativeProps?.({
				style: {
					backgroundColor: mark.backgroundColor ?? 'transparent',
					borderWidth: mark.borderWidth ?? 0,
					borderColor: mark.borderColor ?? 'transparent',
					borderStyle: mark.borderStyle ?? 'solid',
				},
			}),
		)
	}
}
