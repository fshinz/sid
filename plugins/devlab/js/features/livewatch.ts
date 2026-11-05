import { SENSITIVE_KEY, safeJsonStringify, safely, sanitize } from './sanitize'

export type WatchEntry = {
	id: string
	storeName: string
	timestamp: number
	snapshot: string
}

type WatchLogListener = (entry: WatchEntry) => void

type Watch = {
	interval: ReturnType<typeof setInterval>
	lastSnapshot: string
	removeChangeListener?: () => void
}

export const MAX_LOG = 100
const MAX_OBJECT_KEYS = 80
const WATCH_INTERVAL = 1000

// Cheap getters worth reading so changes show up even when the backing fields are private.
const STATE_GETTERS = [
	'getCurrentUserId',
	'getChannelId',
	'getGuildId',
	'getSelectedChannelId',
	'getSelectedGuildId',
]

const watches = new Map<string, Watch>()
const listeners = new Set<WatchLogListener>()
const eventLog: WatchEntry[] = []

function getStores(): Record<string, any> {
	const stores = (globalThis as any).valenced?.discord?.flux?.Stores
	return stores && typeof stores === 'object' ? stores : {}
}

export function getAllStoreNames() {
	return Object.keys(getStores()).sort((a, b) => a.localeCompare(b))
}

function snapshotStore(storeName: string): unknown {
	const store = getStores()[storeName]
	if (!store) return { error: `Store "${storeName}" was not found.` }

	if (SENSITIVE_KEY.test(storeName)) {
		return {
			name: storeName,
			redacted: true,
			message:
				'This store is hidden because its name suggests sensitive authentication data.',
		}
	}

	const keys = safely(() => Object.keys(store)) ?? []
	const properties: Record<string, any> = {}
	for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
		if (SENSITIVE_KEY.test(key)) {
			properties[key] = '[REDACTED]'
			continue
		}
		const value = safely(() => store[key])
		properties[key] =
			typeof value === 'function'
				? `[Function ${value.name || key}]`
				: sanitize(value)
	}
	if (keys.length > MAX_OBJECT_KEYS) {
		properties['…'] = '[Additional properties omitted]'
	}

	const getters: Record<string, unknown> = {}
	for (const name of STATE_GETTERS) {
		if (typeof safely(() => store[name]) === 'function') {
			getters[name] = sanitize(safely(() => store[name]()))
		}
	}

	return {
		name: storeName,
		type: typeof store,
		properties,
		methods: keys.filter(key => typeof safely(() => store[key]) === 'function'),
		getters,
	}
}

function emit(storeName: string, snapshot: unknown) {
	const entry: WatchEntry = {
		id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		storeName,
		timestamp: Date.now(),
		snapshot: safeJsonStringify(snapshot),
	}

	eventLog.unshift(entry)
	if (eventLog.length > MAX_LOG) eventLog.length = MAX_LOG

	for (const listener of [...listeners]) {
		try {
			listener(entry)
		} catch (error) {
			console.error('[DevLab] Watch listener failed:', error)
		}
	}
}

// The log outlives the screen, so reopening the tab shows earlier events.
export function addWatchListener(listener: WatchLogListener) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getWatchLog() {
	return eventLog.slice()
}

export function clearWatchLog() {
	eventLog.length = 0
}

export function watchStore(storeName: string) {
	const store = getStores()[storeName]
	if (!store || watches.has(storeName)) return !!store

	const initial = snapshotStore(storeName)

	// Polling catches stores that don't expose change listeners.
	const watch: Watch = {
		lastSnapshot: safeJsonStringify(initial),
		interval: setInterval(() => {
			const snapshot = snapshotStore(storeName)
			const serialized = safeJsonStringify(snapshot)
			if (serialized === watch.lastSnapshot) return
			watch.lastSnapshot = serialized
			emit(storeName, snapshot)
		}, WATCH_INTERVAL),
	}
	watches.set(storeName, watch)

	if (typeof store.addChangeListener === 'function') {
		// A store-signalled change is logged even if the visible snapshot looks identical.
		const onChange = () => {
			const snapshot = snapshotStore(storeName)
			watch.lastSnapshot = safeJsonStringify(snapshot)
			emit(storeName, snapshot)
		}
		safely(() => store.addChangeListener(onChange))
		watch.removeChangeListener = () => {
			safely(() => store.removeChangeListener?.(onChange))
		}
	}

	emit(storeName, { event: 'watch-started', storeName, snapshot: initial })
	return true
}

function stopWatch(watch: Watch) {
	clearInterval(watch.interval)
	safely(() => watch.removeChangeListener?.())
}

export function unwatchStore(storeName: string) {
	const watch = watches.get(storeName)
	if (!watch) return false

	stopWatch(watch)
	watches.delete(storeName)
	emit(storeName, { event: 'watch-stopped', storeName })
	return true
}

export function getWatchedStores() {
	return [...watches.keys()].sort((a, b) => a.localeCompare(b))
}

export function clearAllWatches() {
	const names = getWatchedStores()
	for (const watch of watches.values()) stopWatch(watch)
	watches.clear()
	for (const storeName of names) {
		emit(storeName, { event: 'watch-stopped', storeName })
	}
}
