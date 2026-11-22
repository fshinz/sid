import type { JsonStorage } from '@valenced/json-storage'
import type { GlassState } from './native'

export type StorageState = {
	glass?: GlassState
}

let storage: JsonStorage<StorageState> | undefined
let writeQueue: Promise<unknown> = Promise.resolve()

export function bindStorage(next: JsonStorage<StorageState>) {
	storage = next
}

export const PRESETS: Record<
	string,
	Pick<
		GlassState,
		| 'blurDp'
		| 'bevelDp'
		| 'refractDp'
		| 'falloff'
		| 'dispersion'
		| 'rim'
		| 'dim'
		| 'sat'
		| 'tint'
	>
> = {
	subtle: {
		blurDp: 12,
		bevelDp: 16,
		refractDp: 22,
		falloff: 2,
		dispersion: 0.06,
		rim: 0.7,
		dim: 0.22,
		sat: 1.08,
		tint: 0.12,
	},
	balanced: {
		blurDp: 18,
		bevelDp: 26,
		refractDp: 46,
		falloff: 2,
		dispersion: 0.1,
		rim: 1,
		dim: 0.18,
		sat: 1.15,
		tint: 0.1,
	},
	bold: {
		blurDp: 26,
		bevelDp: 36,
		refractDp: 76,
		falloff: 2.6,
		dispersion: 0.16,
		rim: 1.4,
		dim: 0.12,
		sat: 1.25,
		tint: 0.08,
	},
}

export function defaultGlass(): GlassState {
	return {
		enabled: true,
		top: true,
		bottom: true,
		input: true,
		floating: true,
		material: 'regular',
		preset: 'balanced',
		...PRESETS.balanced,
		sensor: false,
	}
}

function number(value: unknown, def: number, lo: number, hi: number): number {
	const parsed =
		typeof value === 'number' && Number.isFinite(value) ? value : def
	return Math.min(hi, Math.max(lo, parsed))
}

export function normalizeGlass(value: unknown): GlassState {
	if (!value || typeof value !== 'object') return defaultGlass()
	const raw = value as Partial<GlassState>
	const preset =
		typeof raw.preset === 'string' && PRESETS[raw.preset]
			? raw.preset
			: 'balanced'
	return {
		enabled: raw.enabled !== false,
		top: raw.top !== false,
		bottom: raw.bottom !== false,
		input: raw.input !== false,
		floating: raw.floating !== false,
		material: raw.material === 'clear' ? 'clear' : 'regular',
		preset,
		blurDp: number(raw.blurDp, PRESETS.balanced.blurDp, 0, 40),
		bevelDp: number(raw.bevelDp, PRESETS.balanced.bevelDp, 4, 60),
		refractDp: number(raw.refractDp, PRESETS.balanced.refractDp, 0, 130),
		falloff: number(raw.falloff, PRESETS.balanced.falloff, 0, 4),
		dispersion: number(raw.dispersion, PRESETS.balanced.dispersion, 0, 0.3),
		rim: number(raw.rim, PRESETS.balanced.rim, 0, 2),
		dim: number(raw.dim, PRESETS.balanced.dim, 0, 0.5),
		sat: number(raw.sat, PRESETS.balanced.sat, 0.6, 1.5),
		tint: number(raw.tint, PRESETS.balanced.tint, 0, 0.4),
		sensor: raw.sensor === true,
	}
}

export function readGlass(): GlassState {
	return normalizeGlass(storage?.use()?.glass)
}

async function waitUntilLoaded() {
	if (!storage) return
	for (
		let waited = 0;
		storage.loaded === false && waited < 5000;
		waited += 25
	) {
		await new Promise(resolve => setTimeout(resolve, 25))
	}
	if (storage.loaded === false) await storage.get?.()
}

export async function readGlassWhenLoaded(): Promise<GlassState> {
	await waitUntilLoaded()
	return normalizeGlass(storage?.use()?.glass)
}

export function saveGlass(next: GlassState): Promise<unknown> {
	const job = writeQueue.then(async () => {
		if (!storage) return
		await waitUntilLoaded()
		const normalized = normalizeGlass(next)
		const root: StorageState = { ...(storage.cache ?? {}), glass: normalized }
		storage.cache = root
		await storage.set(root, true)
	})
	writeQueue = job.catch(() => {})
	return job
}
