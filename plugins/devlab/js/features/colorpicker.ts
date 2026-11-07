import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { lookupModule, lookupModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { ReactNative } from '@valenced/react'

type ShowPicker = (options: {
	color: number
	onSelect: (rgb: number) => void
}) => void

let cached: ShowPicker | undefined

function fromExports(exports: any): ShowPicker | undefined {
	if (!exports) return
	if (typeof exports === 'function') return exports
	const fn = exports.showCustomColorPickerActionSheet ?? exports.default
	return typeof fn === 'function' ? fn : undefined
}

function fromLookup(res: any): ShowPicker | undefined {
	if (!res) return
	return fromExports(Array.isArray(res) ? res[0] : res)
}

function scan(matches: any): ShowPicker | undefined {
	if (!matches) return
	// lookupModules returns [exports, id] tuples; a single tuple when it's
	// the plain lookupModule result.
	const list = Array.isArray(matches[0]) ? matches : [matches]
	for (const tuple of list) {
		const fn = fromExports(Array.isArray(tuple) ? tuple[0] : tuple)
		if (fn) return fn
	}
	return undefined
}

// Ported from the hex-color plugin's proven resolver: locate Discord's
// color chooser via its dependency signature (survives minified names).
function resolveViaRuntimeGlobal(): ShowPicker | undefined {
	try {
		const rev = (globalThis as any).valenced ?? (globalThis as any).revenge
		const finders = rev?.modules?.finders
		const filters = finders?.filters
		if (!finders || !filters) return undefined

		const actionSheetCreator = finders.lookupModule(
			filters.withProps('openLazy', 'hideActionSheet'),
		)
		const actionSheetCreatorId = actionSheetCreator?.[1]
		const actionSheetCreatorDep =
			typeof actionSheetCreatorId === 'number' ? actionSheetCreatorId : null

		if (
			actionSheetCreatorDep !== null &&
			typeof filters.withDependencies === 'function'
		) {
			const wd = filters.withDependencies
			const loose = wd.loose ?? wd.partial ?? wd.unordered
			const found = finders.lookupModule(
				filters
					.withName('showCustomColorPickerActionSheet')
					.and(wd(loose([actionSheetCreatorDep, wd.relative(1)]))),
				{ initialize: true },
			)
			const fn = fromLookup(found)
			if (fn) return fn
		}

		const res =
			finders.lookupModule(
				filters.withProps('showCustomColorPickerActionSheet'),
				{
					initialize: true,
				},
			) ??
			finders.lookupModule(
				filters.withName('showCustomColorPickerActionSheet'),
				{
					initialize: true,
				},
			)
		return fromLookup(res)
	} catch {
		return undefined
	}
}

/**
 * Finds Discord's own color chooser action sheet
 * (`showCustomColorPickerActionSheet`). Returns undefined when the client
 * doesn't expose it.
 */
export function resolveShowCustomColorPicker(): ShowPicker | undefined {
	if (cached) return cached

	const tries: Array<() => ShowPicker | undefined> = [
		// 1. Dependency-signature lookup, exactly like hex-color.
		resolveViaRuntimeGlobal,
		// 2. Name scan across all matching modules.
		() =>
			scan(
				lookupModules(withName<any>('showCustomColorPickerActionSheet'), {
					initialize: true,
				}),
			),
		// 3. Export-prop scan (export keys survive minification).
		() =>
			scan(
				lookupModules(withProps<any>('showCustomColorPickerActionSheet'), {
					initialize: true,
				}),
			),
		// 4. Single-module lookups as a last resort.
		() =>
			fromLookup(
				lookupModule(withProps<any>('showCustomColorPickerActionSheet'), {
					initialize: true,
				}),
			),
	]

	for (const attempt of tries) {
		try {
			const fn = attempt()
			if (fn) {
				cached = fn
				return fn
			}
		} catch {
			// Try the next lookup.
		}
	}
	return undefined
}

export function hexToRgbInt(
	hex: string | undefined,
	fallback = 0x5865f2,
): number {
	if (!hex) return fallback
	const m = hex.replace('#', '').match(/^([0-9a-f]{6}|[0-9a-f]{8})$/i)
	if (!m) return fallback
	return Number.parseInt(m[1].slice(0, 6), 16)
}

export function rgbIntToHex(rgb: number): string {
	const n = (rgb >>> 0) & 0xffffff
	return `#${n.toString(16).padStart(6, '0').toUpperCase()}`
}

let lastPickedRgb = 0x5865f2

export function getLastPickedRgb() {
	return lastPickedRgb
}

export type ColorPick = {
	/** Starting color as `#rrggbb`. */
	color: string
	onSelect: (hex: string) => void
}

/**
 * Opens Discord's built-in color chooser. The chosen color comes back as
 * `#RRGGBB`. Falls back to copying the current value when the client
 * doesn't expose the chooser.
 */
export function openDiscordColorPicker(options: ColorPick) {
	try {
		ReactNative.Keyboard?.dismiss?.()
	} catch {
		// Ignore.
	}

	const showPicker = resolveShowCustomColorPicker()
	const initialRgb = hexToRgbInt(options.color, lastPickedRgb)

	if (!showPicker) {
		try {
			Clipboard.setString(options.color)
			ToastActionCreators.open('shin.devlab.picker', {
				text: `Color chooser not available in this build — copied ${options.color} instead.`,
			})
		} catch {
			// Ignore.
		}
		return
	}

	showPicker({
		color: initialRgb,
		onSelect: (selectedRgb: number) => {
			if (typeof selectedRgb !== 'number') return
			lastPickedRgb = selectedRgb & 0xffffff
			options.onSelect(rgbIntToHex(selectedRgb))
		},
	})
}
