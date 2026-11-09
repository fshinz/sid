import * as assets from '@valenced/assets'
import { getAssetByName } from '@valenced/assets'
import * as modulesMetro from '@valenced/modules/metro'
import { callNativeMethodSync } from '@valenced/modules/native'
import { saveIconCache } from '../storage'

export interface IconCacheStorage {
	auto?: boolean
	lastRepair?: RepairReport
}

export interface RepairReport {
	at: string
	assetModules: number
	cachedBefore: number
	cachedAfter: number
	missingRequired: string[]
	initialised: number
	failed: number
	errors: string[]
}

export interface CheckResult {
	at: string
	status: 'ok' | 'repaired' | 'error'
	assetModules: number
	cached: number
	report?: RepairReport
	problem?: string
}

export const REQUIRED = ['WrenchIcon', 'ShieldIcon', 'TrashIcon', 'CloudIcon']

const SLACK = 0.97
const MAX_MODULE_ID = 1 << 17

declare const __r: (id: number) => unknown

function cachedModuleIds(): Set<number> | undefined {
	const data = callNativeMethodSync(
		'valenced.caches.assets.read' as any,
		[] as any,
	) as { data?: Record<string, Record<string, number>> } | null
	if (!data?.data) return undefined
	const ids = new Set<number>()
	for (const name in data.data)
		for (const type in data.data[name]) ids.add(data.data[name][type])
	return ids
}

function findAssetModules(): number[] {
	const metro = modulesMetro as any
	const deps = (id: number): number[] | undefined => {
		try {
			return metro.getModuleDependencies(id)
		} catch {
			return undefined
		}
	}

	let registry: number | undefined = (assets as any).AssetsRegistryModuleId
	const singles: Array<[number, number]> = []
	const tally = new Map<number, number>()
	for (let id = 0; id < MAX_MODULE_ID; id++) {
		const d = deps(id)
		if (d?.length !== 1) continue
		singles.push([id, d[0]])
		tally.set(d[0], (tally.get(d[0]) ?? 0) + 1)
	}

	if (registry === undefined || !tally.has(registry)) {
		let best = -1
		for (const [dep, n] of tally) if (n > best) [best, registry] = [n, dep]
	}
	return singles.filter(([, dep]) => dep === registry).map(([id]) => id)
}

function missingRequired(): string[] {
	return REQUIRED.filter(name => {
		try {
			return !getAssetByName(name)
		} catch {
			return true
		}
	})
}

function checkAndRepair(): CheckResult {
	const at = new Date().toISOString()
	const assetModules = findAssetModules()
	const before = cachedModuleIds()
	const cachedBefore = before?.size ?? 0
	const missing = missingRequired()
	if (assetModules.length === 0) {
		return {
			at,
			status: 'error',
			assetModules: 0,
			cached: cachedBefore,
			problem: "Couldn't find Discord's icon modules.",
		}
	}
	if (!missing.length && cachedBefore >= assetModules.length * SLACK) {
		return {
			at,
			status: 'ok',
			assetModules: assetModules.length,
			cached: cachedBefore,
		}
	}

	const metro = modulesMetro as any
	let initialised = 0
	let failed = 0
	let added = 0
	const errors: string[] = []
	for (const id of assetModules) {
		if (metro.isModuleInitialized(id)) continue
		try {
			__r(id)
			initialised++
			if (!before?.has(id)) added++
		} catch (e) {
			failed++
			if (errors.length < 5) errors.push(`${id}: ${(e as Error)?.message ?? e}`)
		}
	}

	const report: RepairReport = {
		at,
		assetModules: assetModules.length,
		cachedBefore,
		cachedAfter: cachedBefore + added,
		missingRequired: missing,
		initialised,
		failed,
		errors,
	}
	return {
		at,
		status: 'repaired',
		assetModules: assetModules.length,
		cached: report.cachedAfter,
		report,
	}
}

let saved: IconCacheStorage = {}
let lastCheck: CheckResult | undefined
const listeners = new Set<() => void>()

function emit() {
	for (const fn of listeners) fn()
}

function save(patch: Partial<IconCacheStorage>) {
	saved = { ...saved, ...patch }
	void saveIconCache(saved)
	emit()
}

export function runCheck(): CheckResult {
	let result: CheckResult
	try {
		result = checkAndRepair()
	} catch (error) {
		result = {
			at: new Date().toISOString(),
			status: 'error',
			assetModules: 0,
			cached: 0,
			problem: String((error as Error)?.message ?? error),
		}
	}
	lastCheck = result
	if (result.report) save({ lastRepair: result.report })
	else emit()
	return result
}

export function startIconCache(
	initial?: IconCacheStorage,
): CheckResult | undefined {
	saved = { ...(initial ?? {}) }
	if (saved.auto === false) return undefined
	return runCheck()
}

export function iconCacheState() {
	return { auto: saved.auto !== false, lastRepair: saved.lastRepair, lastCheck }
}

export function setAutoRepair(auto: boolean) {
	save({ auto })
}

export function subscribeIconCache(fn: () => void): () => void {
	listeners.add(fn)
	return () => listeners.delete(fn)
}
