import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { lookupModule } from '@valenced/modules/finders'
import {
	withDependencies,
	withName,
	withProps,
} from '@valenced/modules/finders/filters'
import { ReactNative } from '@valenced/react'

type ShowPicker = (options: {
	color: number
	onSelect: (rgb: number) => void
}) => void

let cached: ShowPicker | undefined

function fromLookup(res: any): ShowPicker | undefined {
	if (!res) return
	const exports = Array.isArray(res) ? res[0] : res
	if (typeof exports === 'function') return exports
	const fn = exports?.showCustomColorPickerActionSheet ?? exports?.default
	return typeof fn === 'function' ? fn : undefined
}

/**
 * Finds Discord's own color chooser action sheet
 * (`showCustomColorPickerActionSheet`). Returns undefined when the client
 * doesn't expose it.
 */
export function resolveShowCustomColorPicker(): ShowPicker | undefined {
	if (cached) return cached

	const attempts: Array<() => any> = [
		() =>
			lookupModule(withName<any>('showCustomColorPickerActionSheet'), {
				initialize: true,
			}),
		() =>
			lookupModule(withProps<any>('showCustomColorPickerActionSheet'), {
				initialize: true,
			}),
	]

	// Last resort (same as hex-color): locate the action-sheet creator and
	// match the picker by its dependency signature.
	attempts.push(() => {
		const creator = lookupModule(withProps<any>('openLazy', 'hideActionSheet'))
		const creatorId = Array.isArray(creator) ? creator[1] : undefined
		if (
			typeof creatorId !== 'number' ||
			typeof (withDependencies as any).loose !== 'function'
		) {
			return undefined
		}
		const dep = (withDependencies as any).loose([
			creatorId,
			(withDependencies as any).relative(1),
		])
		return lookupModule(
			withName<any>('showCustomColorPickerActionSheet').and(dep),
			{
				initialize: true,
			},
		)
	})

	for (const attempt of attempts) {
		try {
			const fn = fromLookup(attempt())
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
				text: `Color chooser unavailable — copied ${options.color}.`,
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
