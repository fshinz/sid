import type { JsonStorage } from '@valenced/json-storage'
import type { InspectPrefs } from './features/inspect'

export type DiagnosticEntry = {
	id: string
	title: string
	message: string
	stack?: string
	context?: string
	timestamp: number
	level: 'error' | 'warning' | 'info'
}

export type DevLabState = {
	entries: DiagnosticEntry[]
	enabled: boolean
	inspect?: InspectPrefs
}

let storage: JsonStorage<DevLabState> | undefined
let writeQueue: Promise<unknown> = Promise.resolve()

const MAX_ENTRIES = 100

export function bindStorage(next: JsonStorage<DevLabState>) {
	storage = next
}

function isEntry(value: unknown): value is DiagnosticEntry {
	if (!value || typeof value !== 'object') return false
	const entry = value as Partial<DiagnosticEntry>
	return (
		typeof entry.id === 'string' &&
		typeof entry.title === 'string' &&
		typeof entry.message === 'string' &&
		typeof entry.timestamp === 'number'
	)
}

function normalizeInspect(value: unknown): InspectPrefs | undefined {
	if (!value || typeof value !== 'object') return undefined
	const raw = value as Partial<InspectPrefs>
	return {
		enabled: raw.enabled === true,
		mode: raw.mode === 'token' ? 'token' : 'element',
		copyOnTap: raw.copyOnTap === true,
		showButton: raw.showButton !== false,
	}
}

function normalizeState(value: unknown): DevLabState {
	if (!value || typeof value !== 'object') return { entries: [], enabled: true }
	const raw = value as Partial<DevLabState>
	return {
		entries: Array.isArray(raw.entries)
			? raw.entries.filter(isEntry).slice(0, MAX_ENTRIES)
			: [],
		enabled: raw.enabled !== false,
		inspect: normalizeInspect(raw.inspect),
	}
}

export function readState(): DevLabState {
	return normalizeState(storage?.use())
}

/** Waits for the async load, then reads — for restoring prefs at startup. */
export async function readStateWhenLoaded(): Promise<DevLabState> {
	await waitUntilLoaded()
	return normalizeState(storage?.use())
}

function readCachedState(): DevLabState {
	return normalizeState(storage?.cache)
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

export function saveState(next: DevLabState) {
	const job = writeQueue.then(async () => {
		if (!storage) return
		await waitUntilLoaded()
		const normalized = normalizeState(next)
		storage.cache = normalized
		await storage.set(normalized, true)
	})
	writeQueue = job.catch(() => {})
	return job
}

export function saveInspectPrefs(prefs: InspectPrefs) {
	const current = readCachedState()
	return saveState({ ...current, inspect: prefs })
}

export async function recordError(error: unknown, context = 'DevLab') {
	const current = readCachedState()
	const actualError = error instanceof Error ? error : new Error(String(error))
	const entry: DiagnosticEntry = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
		title: context,
		message: actualError.message,
		stack: actualError.stack,
		context,
		timestamp: Date.now(),
		level: 'error',
	}
	await saveState({
		...current,
		entries: [entry, ...current.entries].slice(0, MAX_ENTRIES),
	})
}

export async function clearErrors() {
	const current = readCachedState()
	await saveState({ ...current, entries: [] })
}
