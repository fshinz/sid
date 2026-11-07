import { Stores } from '@valenced/discord/flux'
import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'

type TokenModule = {
	colors?: Record<string, any>
	unsafe_rawColors?: Record<string, any>
	internal?: { resolveSemanticColor?: (theme: string, ref: any) => any }
	meta?: { resolveSemanticColor?: (theme: string, ref: any) => any }
}

let tokenModule: TokenModule | undefined

/** Finds Discord's color token module. Returns an unsubscribe function. */
export function findTokens() {
	return getModules(withProps<any>('unsafe_rawColors', 'colors'), (m: any) => {
		tokenModule = m?.default?.colors ? m.default : m
	})
}

export function tokensAvailable() {
	return !!tokenModule?.colors
}

export function currentTheme(): string {
	try {
		return (Stores as any).ThemeStore?.theme ?? 'dark'
	} catch {
		return 'dark'
	}
}

function hex(r: number, g: number, b: number, a: number) {
	const t = (n: number) =>
		Math.max(0, Math.min(255, Math.round(n)))
			.toString(16)
			.padStart(2, '0')
	return `#${t(r)}${t(g)}${t(b)}${a === 255 ? '' : t(a)}`
}

/** Turns hex / rgb() / rgba() / ARGB ints into lowercase `#rrggbb` (or `#rrggbbaa`). */
export function normalizeColor(v: unknown): string | undefined {
	if (typeof v === 'number') {
		return hex((v >>> 16) & 255, (v >>> 8) & 255, v & 255, (v >>> 24) & 255)
	}
	if (typeof v !== 'string') return

	const s = v.trim().toLowerCase()

	let m = s.match(/^#([0-9a-f]{3,8})$/)
	if (m) {
		let h = m[1]
		if (h.length === 3 || h.length === 4) {
			h = h
				.split('')
				.map(c => c + c)
				.join('')
		}
		if (h.length === 6) return `#${h}`
		if (h.length === 8)
			return h.slice(6) === 'ff' ? `#${h.slice(0, 6)}` : `#${h}`
		return
	}

	m = s.match(/^rgba?\(([^)]+)\)/)
	if (m) {
		const p = m[1].split(',').map(x => Number.parseFloat(x))
		if (p.length >= 3 && p.every(n => !Number.isNaN(n))) {
			return hex(p[0], p[1], p[2], p[3] === undefined ? 255 : p[3] * 255)
		}
	}
}

export type Maps = {
	theme: string
	semantic: Map<string, string>
	raw: Map<string, string>
	refToName: Map<any, string>
	byValue: Map<string, { semantic: string[]; raw: string[] }>
}

let cache: Maps | undefined

function resolve(theme: string, ref: any): unknown {
	const fn =
		tokenModule?.internal?.resolveSemanticColor ??
		tokenModule?.meta?.resolveSemanticColor
	if (!fn) return
	try {
		return fn(theme, ref)
	} catch {
		return
	}
}

export function getMaps(): Maps {
	const theme = currentTheme()
	if (cache && cache.theme === theme) return cache

	const semantic = new Map<string, string>()
	const raw = new Map<string, string>()
	const refToName = new Map<any, string>()
	const byValue = new Map<string, { semantic: string[]; raw: string[] }>()

	const bucket = (value: string) => {
		let b = byValue.get(value)
		if (!b) byValue.set(value, (b = { semantic: [], raw: [] }))
		return b
	}

	const colors = tokenModule?.colors ?? {}
	for (const name of Object.keys(colors)) {
		try {
			const ref = colors[name]
			const value = normalizeColor(resolve(theme, ref))
			if (!value) continue
			semantic.set(name, value)
			if (ref && typeof ref === 'object') refToName.set(ref, name)
			bucket(value).semantic.push(name)
		} catch {
			// Skip tokens that fail to resolve.
		}
	}

	const rawColors = tokenModule?.unsafe_rawColors ?? {}
	for (const name of Object.keys(rawColors)) {
		try {
			const value = normalizeColor(rawColors[name])
			if (!value) continue
			raw.set(name, value)
			bucket(value).raw.push(name)
		} catch {
			// Skip.
		}
	}

	cache = { theme, semantic, raw, refToName, byValue }
	return cache
}

export type Analysis = {
	input: string
	value?: string
	semantic?: string
	raw?: string
	/** True when the token name is known exactly, false when it is only a same-value match. */
	exact: boolean
	semanticMatches: string[]
	rawMatches: string[]
}

export function analyzeColor(input: unknown): Analysis {
	const maps = getMaps()
	const out: Analysis = {
		input: typeof input === 'object' ? '[token ref]' : String(input),
		exact: false,
		semanticMatches: [],
		rawMatches: [],
	}

	if (input && typeof input === 'object') {
		const name = maps.refToName.get(input)
		if (name) {
			out.semantic = name
			out.exact = true
		}
		out.value =
			normalizeColor(resolve(maps.theme, input)) ??
			maps.semantic.get(name ?? '')
	} else if (typeof input === 'string') {
		const n = normalizeColor(input)
		if (n) {
			out.value = n
		} else {
			// e.g. Design <Text color="text-muted"> -> TEXT_MUTED
			const candidate = input.trim().toUpperCase().replace(/-/g, '_')
			if (maps.semantic.has(candidate)) {
				out.semantic = candidate
				out.exact = true
				out.value = maps.semantic.get(candidate)
			} else if (maps.raw.has(candidate)) {
				out.raw = candidate
				out.exact = true
				out.value = maps.raw.get(candidate)
			}
		}
	} else if (typeof input === 'number') {
		out.value = normalizeColor(input)
	}

	if (out.value) {
		const b = maps.byValue.get(out.value)
		if (b) {
			out.semanticMatches = b.semantic
				.filter(n => n !== out.semantic)
				.slice(0, 6)
			out.rawMatches = b.raw.filter(n => n !== out.raw).slice(0, 4)
		}
	}

	return out
}

/** Best name for a color: the exact token, then same-value matches. */
export function tokenLabel(c: Analysis) {
	if (c.semantic) return c.semantic
	if (c.raw) return c.raw
	if (c.semanticMatches.length) return `≈ ${c.semanticMatches[0]}`
	if (c.rawMatches.length) return `≈ ${c.rawMatches[0]}`
	return 'no token match'
}

export type TokenEntry = { name: string; value: string }

export function semanticEntries(): TokenEntry[] {
	return [...getMaps().semantic.entries()]
		.map(([name, value]) => ({ name, value }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

export function rawEntries(): TokenEntry[] {
	return [...getMaps().raw.entries()]
		.map(([name, value]) => ({ name, value }))
		.sort((a, b) => a.name.localeCompare(b.name))
}

/** Every token name whose current value equals the given normalized color. */
export function tokensForValue(value: string | null | undefined) {
	if (!value) return { semantic: [], raw: [] }
	const bucket = getMaps().byValue.get(value)
	return {
		semantic: bucket?.semantic.slice() ?? [],
		raw: bucket?.raw.slice() ?? [],
	}
}
