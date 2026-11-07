import { ToastActionCreators } from '@valenced/discord/actions'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { before } from '@valenced/patcher'
import { React } from '@valenced/react'
import { analyzeColor, currentTheme, tokenLabel } from './tokens'
import type { Analysis } from './tokens'

export type ColorHit = { prop: string } & Analysis
export type Layer = { component: string; hint?: string; colors: ColorHit[] }
export type Report = {
	id: number
	ts: number
	theme: string
	layers: Layer[]
}
export type InspectMode = 'element' | 'token'

export type InspectPrefs = {
	enabled: boolean
	mode: InspectMode
	copyOnTap: boolean
	showButton: boolean
}

export const inspectState: InspectPrefs & {
	menuUntil: number
	history: Report[]
	status: Record<string, string>
} = {
	enabled: false,
	mode: 'element',
	copyOnTap: false,
	showButton: true,
	/** Taps are ignored until this timestamp (set while the floating menu is open). */
	menuUntil: 0,
	history: [],
	status: {},
}

const listeners = new Set<() => void>()
export function subscribe(fn: () => void) {
	listeners.add(fn)
	return () => {
		listeners.delete(fn)
	}
}

function emit() {
	for (const fn of [...listeners]) {
		try {
			fn()
		} catch {
			// Ignore.
		}
	}
}

/** Re-renders DevLab screens without persisting anything. */
export const notifyChange = emit

const STYLE_KEYS = [
	'backgroundColor',
	'color',
	'borderColor',
	'borderTopColor',
	'borderBottomColor',
	'borderLeftColor',
	'borderRightColor',
	'borderStartColor',
	'borderEndColor',
	'tintColor',
	'shadowColor',
	'textDecorationColor',
	'overlayColor',
	'textShadowColor',
]
const PROP_KEYS = ['color', 'fill', 'stroke', 'tintColor', 'backgroundColor']

function typeName(type: any): string | undefined {
	if (typeof type === 'string') return type
	if (typeof type === 'function')
		return type.displayName || type.name || 'Anonymous'
	if (type && typeof type === 'object') {
		return (
			type.displayName ||
			type.render?.displayName ||
			type.render?.name ||
			type.type?.displayName ||
			type.type?.name ||
			'Component'
		)
	}
}

// Style objects are usually static (StyleSheet.create), so cache their color
// entries by identity instead of flattening on every render.
const styleEntriesCache = new WeakMap<object, [string, unknown][]>()

function styleEntries(style: any): [string, unknown][] {
	if (!style || typeof style !== 'object') return []

	const cached = styleEntriesCache.get(style)
	if (cached) return cached

	const collected = new Map<string, unknown>()
	const grab = (part: any) => {
		if (!part || typeof part !== 'object') return
		for (const k of STYLE_KEYS) {
			const v = part[k]
			if (v != null && v !== 'transparent') collected.set(k, v)
		}
	}

	if (Array.isArray(style)) {
		for (const part of style) grab(part)
	} else {
		grab(style)
	}

	const out: [string, unknown][] = [...collected.entries()].map(([k, v]) => [
		`style.${k}`,
		v,
	])
	styleEntriesCache.set(style, out)
	return out
}

function readColors(props: any): [string, unknown][] {
	const out: [string, unknown][] = []

	if (props.style) out.push(...styleEntries(props.style))

	for (const k of PROP_KEYS) {
		const v = props[k]
		if (typeof v === 'string' && v !== 'transparent') out.push([k, v])
	}

	return out
}

// ── tap handling ────────────────────────────────────────────────────────────

type RawLayer = { name: string; entries: [string, unknown][]; hint?: string }
let batch: RawLayer[] | null = null
let reportId = 0

function onTap(name: string, entries: [string, unknown][], props: any) {
	if (Date.now() < inspectState.menuUntil) return

	const hint = props.testID || props.nativeID || props.accessibilityLabel
	if (!batch) {
		batch = []
		// Touch events bubble synchronously, so everything under the finger
		// lands in one batch before the timeout flushes it.
		setTimeout(flush, 0)
	}
	batch.push({
		name,
		entries,
		hint: typeof hint === 'string' ? hint : undefined,
	})
}

/** Drops the current tap. Called by the floating button so it never inspects itself. */
export function suppressBatch() {
	batch = null
}

export function markMenuOpen() {
	inspectState.menuUntil = Date.now() + 8000
}

export function markMenuClosed() {
	inspectState.menuUntil = 0
}

function flush() {
	const raw = batch
	batch = null
	if (!raw?.length) return

	const seen = new Set<string>()
	const layers: Layer[] = []

	for (const l of raw) {
		const colors = l.entries.map(([prop, value]) => ({
			prop,
			...analyzeColor(value),
		}))
		const sig = `${l.name}|${colors.map(c => `${c.prop}:${c.input}`).join(',')}`
		if (seen.has(sig)) continue
		seen.add(sig)
		layers.push({ component: l.name, hint: l.hint, colors })
		if (layers.length >= 4) break
	}

	const report: Report = {
		id: reportId++,
		ts: Date.now(),
		theme: currentTheme(),
		layers,
	}
	inspectState.history = [report, ...inspectState.history].slice(0, 50)

	if (inspectState.copyOnTap) Clipboard.setString(reportToText(report))

	try {
		ToastActionCreators.open('shin.devlab.inspect', {
			text: reportSummary(report),
		})
	} catch {
		// Toast is best-effort.
	}

	emit()
}

// ── formatting ──────────────────────────────────────────────────────────────

function propLabel(prop: string) {
	const k = prop.replace('style.', '')
	if (k === 'backgroundColor') return 'background'
	if (k === 'color') return 'text'
	if (/^border.*Color$/.test(k)) return 'border'
	if (k === 'tintColor' || k === 'fill' || k === 'stroke') return 'icon'
	if (k === 'shadowColor' || k === 'textShadowColor') return 'shadow'
	return k
}

export function reportSummary(r: Report) {
	const l = r.layers[0]
	const c = l?.colors[0]
	if (!l || !c) return 'No colors found'
	return `${l.component} · ${propLabel(c.prop)} → ${tokenLabel(c)}${c.value ? ` (${c.value})` : ''}`
}

function elementText(r: Report) {
	const lines = [`${r.theme} theme`]
	for (const l of r.layers) {
		lines.push('', `${l.component}${l.hint ? ` #${l.hint}` : ''}`)
		const seen = new Set<string>()
		for (const c of l.colors) {
			const label = propLabel(c.prop)
			const key = `${label}|${c.value ?? c.input}`
			if (seen.has(key)) continue
			seen.add(key)
			lines.push(`  ${label}: ${c.value ?? c.input}  ${tokenLabel(c)}`)
		}
	}
	return lines.join('\n')
}

function tokenText(r: Report) {
	type Group = {
		labels: Set<string>
		semantic: Set<string>
		semanticMatches: Set<string>
		raw: Set<string>
		rawMatches: Set<string>
	}
	const groups = new Map<string, Group>()

	for (const l of r.layers) {
		for (const c of l.colors) {
			const key = c.value ?? c.input
			let g = groups.get(key)
			if (!g) {
				g = {
					labels: new Set(),
					semantic: new Set(),
					semanticMatches: new Set(),
					raw: new Set(),
					rawMatches: new Set(),
				}
				groups.set(key, g)
			}
			g.labels.add(propLabel(c.prop))
			if (c.semantic) g.semantic.add(c.semantic)
			if (c.raw) g.raw.add(c.raw)
			for (const n of c.semanticMatches) g.semanticMatches.add(n)
			for (const n of c.rawMatches) g.rawMatches.add(n)
		}
	}

	const lines = [`${r.theme} theme`]
	for (const [value, g] of groups) {
		const semantic = [
			...Array.from(g.semantic).map(n => `${n} (exact)`),
			...Array.from(g.semanticMatches).map(n => `≈ ${n}`),
		]
		const raw = [
			...Array.from(g.raw).map(n => `${n} (exact)`),
			...Array.from(g.rawMatches).map(n => `≈ ${n}`),
		]
		lines.push('', `${value}  (${Array.from(g.labels).join(', ')})`)
		lines.push(`  semantic: ${semantic.join(', ') || 'none'}`)
		lines.push(`  raw: ${raw.join(', ') || 'none'}`)
	}
	return lines.join('\n')
}

export function reportToText(r: Report, mode: InspectMode = inspectState.mode) {
	return mode === 'token' ? tokenText(r) : elementText(r)
}

// ── patching ────────────────────────────────────────────────────────────────

export type ElementTransform = (type: any, props: any) => any | undefined

const transforms = new Set<ElementTransform>()

/**
 * Registers a props transformer that runs for every element created while
 * at least one transform is registered — used for render-time highlight
 * tinting. Returns an unregister function.
 */
export function addElementTransform(fn: ElementTransform) {
	transforms.add(fn)
	syncPatches()
	return () => {
		transforms.delete(fn)
		syncPatches()
	}
}

function augment(type: any, props: any) {
	if (!props || typeof props !== 'object' || typeof type === 'symbol') return
	let out = props

	for (const fn of transforms) {
		try {
			const next = fn(type, out)
			if (next && next !== out) out = next
		} catch {
			// Never break rendering.
		}
	}

	if (!inspectState.enabled) return out === props ? undefined : out

	const entries = readColors(out)
	if (!entries.length) return out === props ? undefined : out

	const name = typeName(type) ?? 'Unknown'
	const prev = out.onTouchStart

	return {
		...out,
		onTouchStart(e: any) {
			try {
				onTap(name, entries, props)
			} catch {
				// Never break the app's own touch handling.
			}
			return typeof prev === 'function' ? prev(e) : undefined
		},
	}
}

// Used for both createElement(type, props, ...children) and jsx(type, props, key).
function rewrite(args: any) {
	try {
		const next = augment(args[0], args[1])
		if (!next) return args
		return [args[0], next].concat(Array.prototype.slice.call(args, 2))
	} catch {
		return args
	}
}

const jsxModules: any[] = []
const unpatches: (() => void)[] = []
let patched = false

function patchModuleKeys(m: any) {
	for (const key of ['jsx', 'jsxs', 'jsxDEV']) {
		if (typeof m?.[key] !== 'function') continue
		try {
			unpatches.push(before(m, key, rewrite as any))
		} catch {
			// Namespace may be frozen.
		}
	}
}

function patchJsxModule(m: any) {
	jsxModules.push(m)
	if (patched) patchModuleKeys(m)
}

export function findJsxRuntime() {
	return getModules(withProps<any>('jsx', 'jsxs'), (m: any) => {
		patchJsxModule(m)
	})
}

function install() {
	inspectState.status.createElement = ''
	inspectState.status.jsx = ''

	try {
		unpatches.push(before(React as any, 'createElement', rewrite as any))
		inspectState.status.createElement = 'patched'
	} catch (e) {
		inspectState.status.createElement = `failed: ${String(e)}`
	}

	let n = 0
	for (const m of jsxModules) {
		const countFrom = unpatches.length
		patchModuleKeys(m)
		n += unpatches.length - countFrom
	}
	inspectState.status.jsx = n ? `${n} patched` : 'not patched'
}

function uninstall() {
	for (const u of unpatches.splice(0)) {
		try {
			u()
		} catch {
			// Ignore.
		}
	}
}

/** The element-creation patch stays up while inspecting OR tinting is active. */
function syncPatches() {
	const want = inspectState.enabled || transforms.size > 0
	if (want && !patched) {
		patched = true
		install()
	} else if (!want && patched) {
		patched = false
		uninstall()
	}
}

// ── persistence ─────────────────────────────────────────────────────────────

type PrefsSaver = (prefs: InspectPrefs) => void
let prefsSaver: PrefsSaver | undefined

export function setInspectSaver(saver: PrefsSaver) {
	prefsSaver = saver
}

function persist() {
	try {
		prefsSaver?.({
			enabled: inspectState.enabled,
			mode: inspectState.mode,
			copyOnTap: inspectState.copyOnTap,
			showButton: inspectState.showButton,
		})
	} catch {
		// Ignore.
	}
}

export function applyInspectPrefs(prefs: Partial<InspectPrefs> | undefined) {
	if (!prefs) return
	if (prefs.mode === 'element' || prefs.mode === 'token') {
		inspectState.mode = prefs.mode
	}
	if (typeof prefs.copyOnTap === 'boolean') {
		inspectState.copyOnTap = prefs.copyOnTap
	}
	if (typeof prefs.showButton === 'boolean') {
		inspectState.showButton = prefs.showButton
	}
	if (prefs.enabled) {
		setInspecting(true)
	} else {
		emit()
	}
}

// ── controls ────────────────────────────────────────────────────────────────

export function setInspecting(on: boolean) {
	inspectState.enabled = on
	syncPatches()
	persist()
	emit()
}

/** Picks how taps are reported and turns inspecting on. */
export function startMode(mode: InspectMode) {
	inspectState.mode = mode
	if (!inspectState.enabled) setInspecting(true)
	else {
		persist()
		emit()
	}
}

export function setCopyOnTap(on: boolean) {
	inspectState.copyOnTap = on
	persist()
	emit()
}

export function setShowButton(on: boolean) {
	inspectState.showButton = on
	persist()
	emit()
}

export function clearHistory() {
	inspectState.history = []
	emit()
}

export function shutdown() {
	inspectState.enabled = false
	transforms.clear()
	patched = false
	uninstall()
}
