import type { JsonStorage } from '@valenced/json-storage'
import type { LogEntry, SessionMeta } from './features/errlog'
import type { InspectPrefs } from './features/inspect'

type IconCacheState = {
	auto?: boolean
	lastRepair?: {
		at: string
		assetModules: number
		cachedBefore: number
		cachedAfter: number
		missingRequired: string[]
		initialised: number
		failed: number
		errors: string[]
	}
}

export type DevLabState = {
	enabled: boolean
	inspect?: InspectPrefs
	logs?: LogEntry[]
	sessions?: SessionMeta[]
	fluxEnabled?: boolean
	iconCache?: IconCacheState
}

let storage: JsonStorage<DevLabState> | undefined
let writeQueue: Promise<unknown> = Promise.resolve()

const MAX_LOGS = 300
const MAX_SESSIONS = 6

export function bindStorage(next: JsonStorage<DevLabState>) {
	storage = next
}

const LEVELS = new Set(['debug', 'log', 'info', 'warn', 'error', 'fatal'])
const SOURCES = new Set(['console', 'discord', 'uncaught'])

function isLogEntry(value: unknown): value is LogEntry {
	if (!value || typeof value !== 'object') return false
	const entry = value as Partial<LogEntry>
	return (
		typeof entry.t === 'number' &&
		typeof entry.msg === 'string' &&
		LEVELS.has(entry.lvl as string) &&
		SOURCES.has(entry.src as string)
	)
}

function normalizeInspect(value: unknown): InspectPrefs | undefined {
	if (!value || typeof value !== 'object') return undefined
	const raw = value as Partial<InspectPrefs>
	return {
		enabled: raw.enabled === true,
		mode: raw.mode === 'token' ? 'token' : 'element',
		copyOnTap: raw.copyOnTap === true,
		showButton: raw.showButton === true,
	}
}

function isSession(value: unknown): value is SessionMeta {
	if (!value || typeof value !== 'object') return false
	const session = value as Partial<SessionMeta>
	return typeof session.id === 'string' && typeof session.startedAt === 'number'
}

function normalizeState(value: unknown): DevLabState {
	if (!value || typeof value !== 'object') return { enabled: true }
	const raw = value as Partial<DevLabState>
	return {
		enabled: raw.enabled !== false,
		inspect: normalizeInspect(raw.inspect),
		logs: Array.isArray(raw.logs)
			? raw.logs.filter(isLogEntry).slice(-MAX_LOGS)
			: undefined,
		sessions: Array.isArray(raw.sessions)
			? raw.sessions.filter(isSession).slice(-MAX_SESSIONS)
			: undefined,
		fluxEnabled: raw.fluxEnabled === true,
		iconCache:
			raw.iconCache && typeof raw.iconCache === 'object'
				? raw.iconCache
				: undefined,
	}
}

export function readState(): DevLabState {
	return normalizeState(storage?.use())
}

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

export function saveLogs(logs: LogEntry[], sessions: SessionMeta[]) {
	const current = readCachedState()
	return saveState({
		...current,
		logs: logs.slice(-MAX_LOGS),
		sessions: sessions.slice(-MAX_SESSIONS),
	})
}

export function saveFluxEnabled(fluxEnabled: boolean) {
	const current = readCachedState()
	return saveState({ ...current, fluxEnabled })
}

export function saveIconCache(iconCache: IconCacheState) {
	const current = readCachedState()
	return saveState({ ...current, iconCache })
}
