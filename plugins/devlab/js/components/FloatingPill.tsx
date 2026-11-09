import { AlertActionCreators } from '@valenced/discord/actions'
import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { React, ReactNative } from '@valenced/react'
import {
	getHighlights,
	setHighlightNudge,
	stopHighlight,
} from '../features/highlight'
import {
	inspectState,
	markMenuClosed,
	markMenuOpen,
	reportSummary,
	reportToText,
	setInspecting,
	setShowButton,
	startMode,
	subscribe,
	suppressBatch,
} from '../features/inspect'
import { DevLabMarker, HighlightLayer } from './HighlightHost'

const h = (...args: any[]) => (React.createElement as any)(...args)

const SIZE = 46
const fabPos = { x: -1, y: 140 }

const clamp = (n: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, n))

function truncate(s: string, n: number) {
	return s.length > n
		? `${s.slice(0, n)}\n…(use Copy last result for the rest)`
		: s
}

export function openMenu() {
	const { AlertModal, AlertActionButton, Text } = Design
	const last = inspectState.history[0]
	const highlights = getHighlights()
	const on = inspectState.enabled
	const mode = inspectState.mode

	const status = on
		? `Logging: ${mode === 'element' ? 'Element mode' : 'Token mode'}. Tap an element to log its colors.`
		: 'Logging is off. Pick a mode, then tap any element.'

	const body = [
		status,
		'',
		last
			? `Last: ${reportSummary(last)}\n\n${truncate(reportToText(last), 600)}`
			: 'Nothing logged yet.',
	].join('\n')

	const done = (fn?: () => void) => () => {
		markMenuClosed()
		fn?.()
	}

	markMenuOpen()

	try {
		AlertActionCreators.openAlert(
			'shin.devlab-menu',
			h(AlertModal, {
				title: 'DevLab',
				content: h(Text, { variant: 'text-md/normal', selectable: true }, body),
				actions: h(
					React.Fragment,
					null,
					h(AlertActionButton, {
						text: `Element mode${on && mode === 'element' ? '  ✓' : ''}`,
						variant: 'primary',
						onPress: done(() => startMode('element')),
					}),
					h(AlertActionButton, {
						text: `Token mode${on && mode === 'token' ? '  ✓' : ''}`,
						variant: 'primary',
						onPress: done(() => startMode('token')),
					}),
					on
						? h(AlertActionButton, {
								text: 'Turn logging off',
								variant: 'secondary',
								onPress: done(() => setInspecting(false)),
							})
						: null,
					highlights.length
						? h(AlertActionButton, {
								text: `Stop all highlights (${highlights.length})`,
								variant: 'secondary',
								onPress: done(() => stopHighlight()),
							})
						: null,
					last
						? h(AlertActionButton, {
								text: 'Copy last result',
								variant: 'secondary',
								onPress: done(() => Clipboard.setString(reportToText(last))),
							})
						: null,
					h(AlertActionButton, {
						text: 'Hide button',
						variant: 'secondary',
						onPress: done(() => setShowButton(false)),
					}),
					h(AlertActionButton, {
						text: 'Close',
						variant: 'secondary',
						onPress: done(),
					}),
				),
			}),
		)
	} catch (e) {
		markMenuClosed()
		inspectState.status.menu = `failed: ${String(e)}`
	}
}

function FloatingButton() {
	const { Dimensions, PanResponder, Pressable, View } = ReactNative
	const { Text } = Design

	const [, rerender] = React.useReducer((n: number) => n + 1, 0)
	const start = React.useRef({ x: 0, y: 0 })
	const boxRef = React.useRef<any>(null)

	React.useEffect(() => subscribe(rerender), [])

	const pan = React.useMemo(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => false,
				onMoveShouldSetPanResponder: (_: any, g: any) =>
					Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
				onPanResponderGrant: () => {
					start.current = { x: fabPos.x, y: fabPos.y }
				},
				onPanResponderMove: (_: any, g: any) => {
					const { width, height } = Dimensions.get('window')
					fabPos.x = clamp(start.current.x + g.dx, 0, width - SIZE)
					fabPos.y = clamp(start.current.y + g.dy, 0, height - SIZE)
					boxRef.current?.setNativeProps?.({
						style: { left: fabPos.x, top: fabPos.y },
					})
				},
			}),
		[],
	)

	if (fabPos.x < 0) fabPos.x = Dimensions.get('window').width - SIZE - 12

	const color = !inspectState.enabled
		? '#4e5058'
		: inspectState.mode === 'token'
			? '#5865F2'
			: '#23a55a'

	return h(
		View,
		{
			...pan.panHandlers,
			ref: boxRef,

			onTouchStart: suppressBatch,
			style: {
				position: 'absolute',
				left: fabPos.x,
				top: fabPos.y,
				width: SIZE,
				height: SIZE,
				borderRadius: SIZE / 2,
				zIndex: 9999,
				elevation: 12,
				backgroundColor: color,
				borderWidth: 2,
				borderColor: '#ffffff55',
			},
		},
		h(
			Pressable,
			{
				onPress: openMenu,
				style: {
					width: SIZE - 4,
					height: SIZE - 4,
					alignItems: 'center',
					justifyContent: 'center',
				},
			},
			h(
				Text,
				{ variant: 'text-sm/semibold', style: { color: '#ffffff' } },
				'DL',
			),
		),
	)
}

let activeMount: string | undefined

export function OverlayWidgets({ mount }: { mount: string }) {
	const [, rerender] = React.useReducer((n: number) => n + 1, 0)
	React.useEffect(() => subscribe(rerender), [])

	if (activeMount && activeMount !== mount) return null
	activeMount = mount

	return h(
		React.Fragment,
		null,
		inspectState.showButton ? h(FloatingButton) : null,
		h(HighlightLayer),
	)
}

const undo: (() => void)[] = []
let rootInstance: any
let rootAttached = false

export function forceRootUpdate() {
	try {
		rootInstance?.forceUpdate?.()
	} catch {}
}

function wrapOutput(ret: any, mount: string) {
	try {
		return h(
			React.Fragment,
			null,
			ret,
			h(
				DevLabMarker,
				{ key: `shin.devlab-overlay-${mount}` },
				h(OverlayWidgets, { mount }),
			),
		)
	} catch {
		return ret
	}
}

function attachRoot() {
	undo.push(
		getModules(
			withName<any>('AppContainer'),
			(ns: any) => {
				const Cmp = ns?.default ?? ns
				try {
					if (Cmp?.prototype && typeof Cmp.prototype.render === 'function') {
						undo.push(
							instead(Cmp.prototype, 'render', function (
								this: any,
								args: any[],
								original: any,
								self?: any,
							) {
								const ctx = self ?? this
								rootInstance = ctx
								return wrapOutput(original.apply(ctx, args), 'root')
							} as any),
						)
						rootAttached = true
						inspectState.status.overlay_root = 'attached (class render)'
					} else if (typeof ns?.default === 'function') {
						undo.push(
							instead(ns, 'default', (args: any, original: any) =>
								wrapOutput(original.apply(null, args), 'root'),
							) as any,
						)
						rootAttached = true
						inspectState.status.overlay_root = 'attached (function)'
					} else {
						inspectState.status.overlay_root =
							'AppContainer has nothing to patch'
					}
				} catch (e) {
					inspectState.status.overlay_root = `failed: ${String(e)}`
				}
			},
			{ returnNamespace: true },
		),
	)
}

function attachToast() {
	undo.push(
		getModules(
			withName<any>('ToastContainer'),
			(ns: any) => {
				const key =
					typeof ns?.default === 'function'
						? 'default'
						: typeof ns?.ToastContainer === 'function'
							? 'ToastContainer'
							: undefined

				if (!key) {
					inspectState.status.overlay_toast = 'no patchable export'
					return
				}

				try {
					undo.push(
						instead(ns, key, (args: any, original: any) =>
							wrapOutput(original.apply(null, args), 'toast'),
						) as any,
					)
					inspectState.status.overlay_toast = 'attached (fallback)'
				} catch (e) {
					inspectState.status.overlay_toast = `failed: ${String(e)}`
				}
			},
			{ returnNamespace: true },
		),
	)
}

export function attachOverlay(cleanup: (fn: () => void) => void) {
	inspectState.status.overlay_root = 'waiting for AppContainer'

	setHighlightNudge(forceRootUpdate)
	cleanup(() => setHighlightNudge(() => {}))

	attachRoot()

	const timer = setTimeout(() => {
		if (!rootAttached) attachToast()
	}, 3000)
	undo.push(() => clearTimeout(timer))

	const nudge = setTimeout(forceRootUpdate, 600)
	undo.push(() => clearTimeout(nudge))

	cleanup(() => {
		for (const u of undo.splice(0)) {
			try {
				u()
			} catch {}
		}
		activeMount = undefined
		rootInstance = undefined
		rootAttached = false
	})
}
