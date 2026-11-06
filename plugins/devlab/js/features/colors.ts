import { Tokens } from '@valenced/discord/common/tokens'
import { safely } from './sanitize'

export type ColorToken = {
	kind: 'semantic' | 'raw'
	name: string
	/** Where the token was found, such as `Tokens.RawColor.NEUTRAL_1`. */
	path: string
	/** Canonical `#RRGGBBAA` value, or null when it could not be resolved. */
	canonical: string | null
}

export type ColorCatalog = {
	semantic: ColorToken[]
	raw: ColorToken[]
	scannedAt: number
}

const NAMED_COLORS: Record<string, string> = {
	transparent: '#00000000',
	white: '#FFFFFFFF',
	black: '#000000FF',
	red: '#FF0000FF',
	green: '#008000FF',
	blue: '#0000FFFF',
	gray: '#808080FF',
	grey: '#808080FF',
}

// Token names like NEUTRAL_16, OPACITY_8, RED_NEW_45 or BLURPLE_14 are raw
// palette entries; everything else (BACKGROUND_BASE_LOW, CARD_BACKGROUND_DEFAULT…)
// is a semantic token.
const RAW_NAME =
	/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:\d+)$|^WHITE(?:_\d+)?$|^BLACK(?:_\d+)?$|^FOCUS_(?:PRIMARY|SECONDARY)$/

let catalog: ColorCatalog | null = null

export function canonicalColor(input: unknown, depth = 0): string | null {
	if (input === null || input === undefined) return null
	if (depth > 3) return null

	try {
		if (typeof input === 'string') return parseColorString(input)
		if (typeof input === 'number') return parseColorNumber(input)
		if (typeof input === 'bigint') return parseColorNumber(Number(input))
		if (typeof input === 'function') return canonicalColor(input(), depth + 1)

		if (typeof input === 'object') {
			const record = input as Record<string, unknown>
			for (const key of [
				'value',
				'hex',
				'css',
				'color',
				'resolvedColor',
				'resolved',
				'current',
			]) {
				if (key in record) {
					const result = canonicalColor(record[key], depth + 1)
					if (result) return result
				}
			}

			const text = safely(() => String(input))
			if (text && text !== '[object Object]') {
				const result = parseColorString(text)
				if (result) return result
			}

			const primitiveValue = safely(() => record.valueOf?.())
			if (primitiveValue !== input) {
				const result = canonicalColor(primitiveValue, depth + 1)
				if (result) return result
			}

			for (const key of ['resolve', 'getResolvableValue', 'getValue']) {
				const fn = record[key]
				if (typeof fn === 'function') {
					const result = canonicalColor(
						safely(() => (fn as () => unknown).call(input)),
						depth + 1,
					)
					if (result) return result
				}
			}
		}
	} catch {
		// Unresolvable color reference.
	}
	return null
}

function parseColorString(input: string): string | null {
	const text = input.trim().toLowerCase()

	const named = NAMED_COLORS[text]
	if (named) return named

	if (text.startsWith('#')) {
		const hex = text.slice(1)
		if (/^[0-9a-f]{3}$/.test(hex)) {
			const [r, g, b] = hex
			return `#${r}${r}${g}${g}${b}${b}FF`.toUpperCase()
		}
		if (/^[0-9a-f]{4}$/.test(hex)) {
			const [r, g, b, a] = hex
			return `#${r}${r}${g}${g}${b}${b}${a}${a}`.toUpperCase()
		}
		if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex.toUpperCase()}FF`
		if (/^[0-9a-f]{8}$/.test(hex)) return `#${hex.toUpperCase()}`
		return null
	}

	const rgb = text.match(/^rgba?\(([^)]+)\)$/)
	if (rgb) {
		const parts = rgb[1].split(',').map(part => Number(part.trim()))
		if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
			const alpha =
				parts.length >= 4 && Number.isFinite(parts[3])
					? Math.round(Math.min(Math.max(parts[3], 0), 1) * 255)
					: 255
			return (
				'#' +
				parts
					.slice(0, 3)
					.map(channel =>
						Math.min(Math.max(Math.round(channel), 0), 255)
							.toString(16)
							.padStart(2, '0'),
					)
					.join('') +
				alpha.toString(16).padStart(2, '0')
			).toUpperCase()
		}
	}

	// Bare hex without '#', only when it clearly looks like one.
	if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(text)) {
		return parseColorString(`#${text}`)
	}
	return null
}

function parseColorNumber(input: number): string | null {
	if (!Number.isFinite(input)) return null
	const value = Math.round(input)
	if (value < 0) return parseColorNumber(value >>> 0)
	if (value <= 0xffffff) {
		return `#${value.toString(16).padStart(6, '0').toUpperCase()}FF`
	}
	// Processed colors are 0xAARRGGBB integers.
	const argb = value >>> 0
	return `#${(argb & 0xffffff).toString(16).padStart(6, '0').toUpperCase()}${((argb >>> 24) & 0xff).toString(16).padStart(2, '0')}`.toUpperCase()
}

function looksLikeTokenName(name: string) {
	return /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(name)
}

function classify(
	name: string,
	path: string,
	container: 'semantic' | 'raw' | null,
): 'semantic' | 'raw' {
	if (container) return container
	if (path.toLowerCase().includes('raw')) return 'raw'
	if (path.toLowerCase().includes('semantic')) return 'semantic'
	return RAW_NAME.test(name) ? 'raw' : 'semantic'
}

function collect(
	map: unknown,
	path: string,
	container: 'semantic' | 'raw' | null,
	out: Map<string, ColorToken>,
	depth = 0,
) {
	if (!map || typeof map !== 'object' || depth > 3) return

	for (const key of safely(() => Object.keys(map as object)) ?? []) {
		const value = safely(() => (map as Record<string, unknown>)[key])
		const canonical = canonicalColor(value)

		if (canonical === null && value && typeof value === 'object' && depth < 3) {
			collect(value, `${path}.${key}`, container, out, depth + 1)
			continue
		}

		if (canonical === null && !looksLikeTokenName(key)) continue

		const kind = classify(key, path, container)
		const token: ColorToken = {
			kind,
			name: key,
			path: `${path}.${key}`,
			canonical,
		}

		// Prefer entries found in dedicated containers over heuristic duplicates.
		const existing = out.get(`${kind}:${key}`)
		if (!existing || (!existing.canonical && token.canonical)) {
			out.set(`${kind}:${key}`, token)
		}
	}
}

export function refreshCatalog(): ColorCatalog {
	const out = new Map<string, ColorToken>()
	const tokens = Tokens as Record<string, unknown> | undefined

	const rawContainers = ['RawColor', 'RawColors', 'rawColor', 'raw']
	const semanticContainers = [
		'SemanticColor',
		'SemanticColors',
		'semanticColor',
		'semantic',
		'ThemeColor',
		'ThemeColors',
	]

	for (const name of rawContainers) {
		const container = safely(() => tokens?.[name])
		if (container && typeof container === 'object') {
			collect(container, `Tokens.${name}`, 'raw', out)
		}
	}
	for (const name of semanticContainers) {
		const container = safely(() => tokens?.[name])
		if (container && typeof container === 'object') {
			collect(container, `Tokens.${name}`, 'semantic', out)
		}
	}

	// Fall back to scanning the whole tokens object when the known
	// containers are missing, letting the name heuristic sort them.
	if (out.size === 0 && tokens && typeof tokens === 'object') {
		collect(tokens, 'Tokens', null, out)
	}

	catalog = {
		semantic: [...out.values()]
			.filter(token => token.kind === 'semantic')
			.sort((a, b) => a.name.localeCompare(b.name)),
		raw: [...out.values()]
			.filter(token => token.kind === 'raw')
			.sort((a, b) => a.name.localeCompare(b.name)),
		scannedAt: Date.now(),
	}
	return catalog
}

export function getCatalog(): ColorCatalog {
	return catalog ?? refreshCatalog()
}

export function findToken(kind: 'semantic' | 'raw', name: string) {
	return getCatalog()[kind].find(token => token.name === name)
}

/** Every token whose current value equals the given canonical color. */
export function tokensForColor(canonical: string | null): {
	semantic: ColorToken[]
	raw: ColorToken[]
} {
	if (!canonical) return { semantic: [], raw: [] }
	const { semantic, raw } = getCatalog()
	return {
		semantic: semantic.filter(token => token.canonical === canonical),
		raw: raw.filter(token => token.canonical === canonical),
	}
}

/** Formats a canonical color as `#RRGGBB` when fully opaque, else `#RRGGBBAA`. */
export function displayColor(canonical: string | null) {
	if (!canonical) return 'unknown'
	return canonical.endsWith('FF') ? canonical.slice(0, 7) : canonical
}
