import { onAnyFluxEventDispatched } from '@valenced/discord/flux'
import { SENSITIVE_KEY, safeJsonStringify, sanitize } from './sanitize'

export type FluxLogEntry = {
	id: string
	type: string
	timestamp: number
	summary: string
	payload: unknown
}

export const MAX_FLUX_LOG = 200

const log: FluxLogEntry[] = []
const typeCounts = new Map<string, number>()
const listeners = new Set<() => void>()
let unpatch: (() => void) | undefined
let paused = false

function notify() {
	for (const listener of [...listeners]) {
		try {
			listener()
		} catch (error) {
			console.error('[DevLab] Flux log listener failed:', error)
		}
	}
}

function summarize(payload: any): string {
	if (!payload || typeof payload !== 'object') return String(payload)

	const parts: string[] = []
	for (const key of Object.keys(payload)) {
		if (key === 'type') continue
		if (SENSITIVE_KEY.test(key)) {
			parts.push(`${key}=[REDACTED]`)
			continue
		}

		const value = payload[key]
		if (value === null || value === undefined) parts.push(`${key}=${value}`)
		else if (typeof value === 'string') {
			parts.push(
				`${key}=${value.length > 24 ? `${value.slice(0, 24)}…` : value}`,
			)
		} else if (typeof value === 'number' || typeof value === 'boolean') {
			parts.push(`${key}=${String(value)}`)
		} else {
			parts.push(
				`${key}:${Array.isArray(value) ? `Array(${value.length})` : typeof value}`,
			)
		}

		if (parts.length >= 6) break
	}
	return parts.join(' ')
}

export function addFluxLogListener(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function getFluxLog() {
	return log.slice()
}

export function getFluxTypeCounts() {
	return [...typeCounts.entries()].sort((a, b) => b[1] - a[1])
}

export function isFluxLogging() {
	return !!unpatch
}

export function isFluxPaused() {
	return paused
}

export function setFluxPaused(value: boolean) {
	paused = value
}

export function clearFluxLog() {
	log.length = 0
	typeCounts.clear()
	notify()
}

export function serializeFluxEntry(entry: FluxLogEntry) {
	return safeJsonStringify(sanitize(entry.payload))
}

export function startFluxLog() {
	if (unpatch) return

	unpatch = onAnyFluxEventDispatched(payload => {
		if (paused) return payload

		const type = String((payload as any)?.type ?? 'UNKNOWN')
		const entry: FluxLogEntry = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			type,
			timestamp: Date.now(),
			summary: summarize(payload),
			payload,
		}

		log.unshift(entry)
		if (log.length > MAX_FLUX_LOG) log.length = MAX_FLUX_LOG
		typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
		notify()
		return payload
	})
}

export function stopFluxLog() {
	unpatch?.()
	unpatch = undefined
}
