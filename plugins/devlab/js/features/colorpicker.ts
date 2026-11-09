import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { lookupModule, lookupModules } from '@valenced/modules/finders'
import { withName, withProps } from '@valenced/modules/finders/filters'
import { React, ReactNative } from '@valenced/react'

type ShowPicker = (options: {
	color: number
	onSelect: (rgb: number) => void
}) => void

const CANDIDATE_NAMES = [
	'showCustomColorPickerActionSheet',
	'showColorPickerActionSheet',
	'openColorPickerActionSheet',
	'showCustomColorPicker',
]

let cached: ShowPicker | undefined

function fromExports(exports: any): ShowPicker | undefined {
	if (!exports) return
	if (typeof exports === 'function') return exports
	for (const name of CANDIDATE_NAMES) {
		const fn = exports[name]
		if (typeof fn === 'function') return fn
	}
	const fallback = exports.default
	return typeof fallback === 'function' ? fallback : undefined
}

function fromResult(res: any): ShowPicker | undefined {
	if (!res) return
	return fromExports(Array.isArray(res) ? res[0] : res)
}

function scan(matches: any): ShowPicker | undefined {
	if (!matches) return
	const list: any[] =
		typeof matches[Symbol.iterator] === 'function' && !Array.isArray(matches)
			? Array.from(matches)
			: [matches]
	for (const item of list) {
		const fn = fromExports(Array.isArray(item) ? item[0] : item)
		if (fn) return fn
	}
	return undefined
}

function resolveViaRuntimeGlobal(): ShowPicker | undefined {
	try {
		const rev = (globalThis as any).valenced ?? (globalThis as any).revenge
		const finders = rev?.modules?.finders
		const filters = finders?.filters
		if (!finders || !filters) return undefined

		const creator = finders.lookupModule(
			filters.withProps('openLazy', 'hideActionSheet'),
		)
		const creatorId = creator?.[1]
		const wd = filters.withDependencies

		if (typeof creatorId === 'number' && typeof wd === 'function') {
			const loose = wd.loose ?? wd.partial ?? wd.unordered
			if (typeof loose === 'function' && typeof wd.relative === 'function') {
				const dep = loose([creatorId, wd.relative(1)])
				for (const name of CANDIDATE_NAMES) {
					const found = finders.lookupModule(
						filters.withName(name).and(wd(dep)),
						{ initialize: true },
					)
					const fn = fromResult(found)
					if (fn) return fn
				}
			}
		}

		for (const name of CANDIDATE_NAMES) {
			const res =
				finders.lookupModule(filters.withProps(name), { initialize: true }) ??
				finders.lookupModule(filters.withName(name), { initialize: true })
			const fn = fromResult(res)
			if (fn) return fn
		}
	} catch {}
	return undefined
}

export function resolveShowCustomColorPicker(): ShowPicker | undefined {
	if (cached) return cached

	const tries: Array<() => ShowPicker | undefined> = [resolveViaRuntimeGlobal]

	for (const name of CANDIDATE_NAMES) {
		tries.push(() =>
			scan(lookupModules(withName<any>(name), { initialize: true })),
		)
		tries.push(() =>
			scan(lookupModules(withProps<any>(name), { initialize: true })),
		)
		tries.push(() =>
			fromResult(lookupModule(withProps<any>(name), { initialize: true })),
		)
	}

	for (const attempt of tries) {
		try {
			const fn = attempt()
			if (fn) {
				cached = fn
				return fn
			}
		} catch {}
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
	color: string
	onSelect: (hex: string) => void
}

function openManualEntry(options: ColorPick) {
	const { AlertModal, AlertActionButton, Text, TextInput } = Design
	let value = options.color

	const ModalInput = () => {
		const [text, setText] = React.useState(options.color)
		return React.createElement(TextInput, {
			placeholder: '#RRGGBB',
			value: text,
			isClearable: true,
			onChange: (next: string) => {
				value = next.trim()
				setText(next)
			},
		})
	}

	const submit = () => {
		const hex = value.startsWith('#') ? value : `#${value}`
		if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return
		options.onSelect(hex.toUpperCase())
	}

	AlertActionCreators.openAlert(
		'shin.devlab-picker',
		React.createElement(AlertModal, {
			title: 'Tint color',
			content: React.createElement(
				React.Fragment,
				null,
				React.createElement(
					Text,
					{ variant: 'text-md/normal' },
					'Enter a hex color, like #FF2D9A.',
				),
				React.createElement(ModalInput, null),
			),
			actions: React.createElement(
				React.Fragment,
				null,
				React.createElement(AlertActionButton, {
					text: 'Use color',
					variant: 'primary',
					onPress: submit,
				}),
				React.createElement(AlertActionButton, {
					text: 'Cancel',
					variant: 'secondary',
				}),
			),
		}),
	)
}

export function openDiscordColorPicker(options: ColorPick) {
	try {
		ReactNative.Keyboard?.dismiss?.()
	} catch {}

	const showPicker = resolveShowCustomColorPicker()
	const initialRgb = hexToRgbInt(options.color, lastPickedRgb)

	if (!showPicker) {
		openManualEntry(options)
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
