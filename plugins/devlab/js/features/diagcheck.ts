import * as clipboardModule from '@valenced/externals/react-native-clipboard'
import * as modulesNative from '@valenced/modules/native'
import * as hiddenPlugins from '@valenced/plugins/_'
import * as pluginConstants from '@valenced/plugins/constants'

const OWN_ID = 'shin.dev-lab'
const MY_PREFIX = 'shin.'

function internals(): any {
	try {
		const mod: any = hiddenPlugins
		return mod?.pList instanceof Map ? mod : (mod?.default ?? mod)
	} catch {
		return undefined
	}
}

export type Health = 'error' | 'warning' | 'ok'

export interface Version {
	nums: number[]
	label: string | null
}

export interface PluginError {
	code: string
	message: string
	stack: string | null
}

export interface Dependency {
	id: string
	range: string
	optional: boolean
	installed: Version | null
	satisfied: boolean | null
}

export interface Published {
	version: string
	size: number | null
}

export interface LiveState {
	enabled: boolean | null
	status: string | null
	startedLate: boolean
	pendingReload: boolean
	pendingUpdate: boolean
	errored: boolean
}

export type Origin = 'core' | 'mine' | 'third-party' | 'side-loaded'

export interface Diagnosis {
	id: string
	name: string
	author: string | null
	description: string | null
	icon: string | null
	version: Version | null
	origin: Origin
	core: boolean
	failed: boolean
	errors: PluginError[]
	missingOptional: string[]
	dependencies: Dependency[]
	dependents: string[]
	hasNative: boolean | null
	isApi: boolean
	enabledByDefault: boolean | null
	enabled: boolean | null
	scriptBytes: number | null
	repo: string | null
	repoName?: string | null
	repoAuthor?: string | null
	channel: string | null
	latest: Version | null
	latestSize: number | null
	published: Published[]
	indexProblem?: string
	live: LiveState | null
	health: Health
	notes: string[]
}

export interface Checkup {
	at: number
	discord: Version | null
	valencedApi: Version | null
	liveState: boolean
	plugins: Diagnosis[]
	repoMeta?: Map<string, { name?: string; author?: string; problem?: string }>
	problem?: string
}

export function formatVersion(version: Version | null | undefined): string {
	if (!version?.nums?.length) return 'unknown'
	return version.label
		? `${version.nums.join('.')}-${version.label}`
		: version.nums.join('.')
}

export function parseVersion(raw: unknown): Version | null {
	if (typeof raw !== 'string' || !raw.trim()) return null
	const [main, ...rest] = raw.trim().replace(/^v/, '').split('-')
	const nums = main.split('.').map(part => Number.parseInt(part, 10))
	if (nums.some(n => !Number.isFinite(n))) return null
	return { nums, label: rest.length ? rest.join('-') : null }
}

export function asVersion(value: any): Version | null {
	if (value && Array.isArray(value.nums)) {
		return { nums: value.nums.map(Number), label: value.label ?? null }
	}
	return parseVersion(value)
}

export function compareVersions(a: Version, b: Version): number {
	const length = Math.max(a.nums.length, b.nums.length)
	for (let i = 0; i < length; i++) {
		const diff = (a.nums[i] ?? 0) - (b.nums[i] ?? 0)
		if (diff) return diff
	}
	if (a.label === b.label) return 0
	if (!a.label) return 1
	if (!b.label) return -1
	return a.label.localeCompare(b.label, undefined, { numeric: true })
}

export function satisfies(version: Version, range: string): boolean | null {
	const trimmed = range.trim()
	if (!trimmed || trimmed === '*' || trimmed === 'x') return true
	let unreadable = false
	const test = (comparator: string): boolean => {
		const match = /^(>=|<=|>|<|=|\^|~)?\s*v?([\dx*.]+(?:-[\w.]+)?)$/.exec(
			comparator,
		)
		if (!match) {
			unreadable = true
			return false
		}
		const [, op = '=', raw] = match
		if (/[x*]/.test(raw)) {
			const fixed = raw
				.split('.')
				.filter(part => !/[x*]/.test(part))
				.map(Number)
			return fixed.every((n, i) => version.nums[i] === n)
		}
		const target = parseVersion(raw)
		if (!target) {
			unreadable = true
			return false
		}
		const order = compareVersions(version, target)
		switch (op) {
			case '>=':
				return order >= 0
			case '<=':
				return order <= 0
			case '>':
				return order > 0
			case '<':
				return order < 0
			case '^':
			case '~': {
				if (order < 0) return false
				const held =
					op === '^'
						? Math.max(1, target.nums.findIndex(n => n !== 0) + 1)
						: Math.min(2, Math.max(1, target.nums.length - 1))
				return target.nums.slice(0, held).every((n, i) => version.nums[i] === n)
			}
			default:
				return order === 0
		}
	}
	const result = trimmed
		.split('||')
		.some(part => part.trim().split(/\s+/).filter(Boolean).every(test))
	return unreadable && !result ? null : result
}

export function formatBytes(bytes: number | null | undefined): string {
	if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return 'unknown'
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const ERROR_TEXT: Record<string, string> = {
	DEPENDENCY_MISSING: 'needs a plugin that is not installed',
	DEPENDENCY_UNSATISFIED: 'needs a different version of a plugin it depends on',
	DEPENDENCY_FAILED: 'a plugin it depends on failed to load',
	DEPENDENCY_CYCLE: 'its dependencies depend on each other in a loop',
	LOAD_FAILED: 'its code failed to load',
	PLUGIN_ERROR: 'threw an error while running',
	MANIFEST_INVALID: 'its manifest is invalid',
	DEPENDENCIES_UNSATISFIED:
		'a plugin it needs is missing, off or the wrong version',
	RELOAD_REQUIRED: "can't start again until Discord reloads",
	STORAGE_FAILED: "Valenced couldn't open its storage folder",
	RESOLVE_FAILED: "Valenced couldn't work out what to install",
	NOT_ALLOWED: 'Valenced refused the change',
	NOT_FOUND: 'Valenced could not find it',
}

export function describeError(error: PluginError): string {
	return ERROR_TEXT[error.code] ?? error.code.toLowerCase().replace(/_/g, ' ')
}

const capitalise = (text: string) =>
	text ? text[0].toUpperCase() + text.slice(1) : text

async function callPlugins<T = any>(
	name: string,
	args: any[] = [],
): Promise<T> {
	const answer = await (modulesNative as any).callNativeMethod(
		`valenced.plugins.${name}`,
		args,
	)
	if (answer && typeof answer === 'object' && !Array.isArray(answer)) {
		const keys = Object.keys(answer)
		if (keys.length === 1 && keys[0] === 'result') return answer.result
		if (keys.length === 1 && keys[0] === 'error') {
			const error = answer.error ?? {}
			throw new Error(
				`${error.code ?? 'UNKNOWN'}: ${error.message ?? 'Valenced call failed'}`,
			)
		}
	}
	return answer
}

async function readList(): Promise<any[]> {
	const list = await callPlugins('list')
	if (!Array.isArray(list)) throw new Error('Valenced returned no plugin list')
	return list
}

type States = Record<string, { enabled?: boolean }>

async function readStates(): Promise<States> {
	try {
		const result = await callPlugins('states.read')
		if (result?.states && typeof result.states === 'object')
			return result.states
		if (result && typeof result === 'object') {
			const active = await callPlugins<{ active?: string }>(
				'states.getSlots',
			).then(
				slots => slots?.active,
				() => undefined,
			)
			const slot = result[active ?? 'primary'] ?? result.primary
			if (slot && typeof slot === 'object') return slot
		}
		return {}
	} catch {
		return {}
	}
}

async function readNativeIds(): Promise<Set<string> | null> {
	try {
		const native = (modulesNative as any).callNativeMethod
		const ids = await native(`${OWN_ID}.nativePlugins`, [])
		return Array.isArray(ids) ? new Set(ids.map(String)) : null
	} catch {
		return null
	}
}

const INDEX_TIMEOUT_MS = 8000

async function readIndex(repo: string): Promise<any> {
	const controller =
		typeof AbortController === 'function' ? new AbortController() : undefined
	const timer = setTimeout(() => controller?.abort(), INDEX_TIMEOUT_MS)
	try {
		const response = await fetch(`${repo.replace(/\/+$/, '')}/index.json`, {
			signal: controller?.signal,
			headers: { 'Cache-Control': 'no-cache' },
		})
		if (!response.ok) throw new Error(`HTTP ${response.status}`)
		return await response.json()
	} finally {
		clearTimeout(timer)
	}
}

export function hostOf(repo: string): string {
	return repo.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

function readLiveStates(): Map<string, LiveState> | undefined {
	const internal = internals()
	const list = internal?.pList
	if (!(list instanceof Map)) return undefined

	let statusNames: Record<number, string> = {}
	try {
		const PluginStatus = (pluginConstants as any)?.PluginStatus
		if (PluginStatus && typeof PluginStatus === 'object') {
			statusNames = Object.fromEntries(
				Object.entries(PluginStatus).map(([name, value]) => [
					value as number,
					name,
				]),
			)
		}
	} catch {}

	const ask = (name: string, plugin: any): boolean => {
		try {
			return typeof internal[name] === 'function'
				? !!internal[name](plugin)
				: false
		} catch {
			return false
		}
	}

	const out = new Map<string, LiveState>()
	for (const plugin of list.values()) {
		const id = plugin?.manifest?.id
		if (typeof id !== 'string') continue
		let status: string | null = null
		try {
			const raw = plugin.status
			if (typeof raw === 'number') status = statusNames[raw] ?? `status ${raw}`
		} catch {}
		out.set(id, {
			enabled:
				typeof internal.isPluginEnabled === 'function'
					? ask('isPluginEnabled', plugin)
					: null,
			status,
			startedLate: ask('isPluginStartedLate', plugin),
			pendingReload: ask('isPluginPendingReload', plugin),
			pendingUpdate: ask('isPluginPendingUpdate', plugin),
			errored: ask('isPluginErrored', plugin),
		})
	}
	return out
}

let last: Checkup | undefined
const listeners = new Set<() => void>()

export function lastCheckup(): Checkup | undefined {
	return last
}

export function findPlugin(id: string): Diagnosis | undefined {
	return last?.plugins.find(plugin => plugin.id === id)
}

export function onCheckup(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function publish(checkup: Checkup): Checkup {
	last = checkup
	for (const listener of listeners) listener()
	return checkup
}

function diagnose(plugin: Diagnosis) {
	const notes: string[] = []
	let health = 'ok' as Health
	const raise = (to: Health) => {
		if (to === 'error' || (to === 'warning' && health === 'ok')) health = to
	}

	if (plugin.failed) {
		raise('error')
		notes.push(
			plugin.errors.length
				? `Did not load: ${describeError(plugin.errors[0])}`
				: 'Did not load this session',
		)
	}
	for (const error of plugin.failed ? plugin.errors.slice(1) : plugin.errors) {
		raise('error')
		notes.push(capitalise(describeError(error)))
	}
	for (const dependency of plugin.dependencies) {
		if (dependency.optional || dependency.satisfied !== false || plugin.failed)
			continue
		raise('error')
		notes.push(
			dependency.installed
				? `Needs ${dependency.id} ${dependency.range}, has ${formatVersion(dependency.installed)}`
				: `Needs ${dependency.id}, which is not installed`,
		)
	}
	if (plugin.missingOptional.length) {
		raise('warning')
		notes.push(
			`Running without ${plugin.missingOptional.join(', ')} (optional)`,
		)
	}

	if (plugin.live) {
		if (plugin.live.errored && !plugin.errors.length) {
			raise('error')
			notes.push('Hit an error while running this session')
		}
		if (plugin.live.pendingUpdate)
			notes.push('Update installed; it applies after a restart')
		else if (plugin.live.pendingReload) {
			raise('warning')
			notes.push('Waiting for Discord to restart')
		}
		if (plugin.live.startedLate)
			notes.push('Turned on mid-session; some parts need a restart')
		if (plugin.live.enabled === false) notes.push('Turned off')
	}

	if (plugin.latest && plugin.version) {
		const order = compareVersions(plugin.version, plugin.latest)
		if (order < 0) {
			raise('warning')
			notes.push(`Update available: ${formatVersion(plugin.latest)}`)
		} else if (order > 0) {
			notes.push(
				`Newer than published (${formatVersion(plugin.latest)}): a test or local build`,
			)
		}
	} else if (plugin.indexProblem) {
		notes.push(`Could not check for updates: ${plugin.indexProblem}`)
	} else if (plugin.origin === 'side-loaded') {
		notes.push('Side-loaded, so there is nothing to check updates against')
	}

	plugin.health = plugin.core && health === 'warning' ? 'ok' : health
	plugin.notes = notes
}

export async function runCheckup(): Promise<Checkup> {
	let raw: any[]
	try {
		raw = await readList()
	} catch (error) {
		return publish({
			at: Date.now(),
			discord: null,
			valencedApi: null,
			liveState: false,
			plugins: [],
			problem: `Valenced would not share its plugin list (${String(error)}). If Developer Mode is off, turn it on under Valenced settings.`,
		})
	}

	const entries = raw.filter(plugin => typeof plugin?.manifest?.id === 'string')
	const versions = new Map<string, Version | null>(
		entries.map(plugin => [
			plugin.manifest.id,
			asVersion(plugin.manifest.version),
		]),
	)
	const live = readLiveStates()
	const [states, nativeIds] = await Promise.all([readStates(), readNativeIds()])

	const plugins: Diagnosis[] = entries.map(plugin => {
		const manifest = plugin.manifest
		const id: string = manifest.id
		const core = !!(plugin.internal || plugin.essential)
		const repo =
			typeof plugin.source?.repo === 'string' ? plugin.source.repo : null
		const text = (value: unknown) =>
			typeof value === 'string' && value.trim() ? value : null

		const dependencies: Dependency[] = Object.entries(
			manifest.dependencies ?? {},
		).map(([depId, spec]: [string, any]) => {
			const range =
				typeof spec === 'string' ? spec : String(spec?.version ?? '*')
			const installed = versions.get(depId) ?? null
			return {
				id: depId,
				range,
				optional: !!spec?.optional,
				installed,
				satisfied: installed ? satisfies(installed, range) : false,
			}
		})

		return {
			id,
			name: text(manifest.name) ?? id,
			author: text(manifest.author),
			description: text(manifest.description),
			icon: text(manifest.icon),
			version: versions.get(id) ?? null,
			origin: core
				? 'core'
				: !repo
					? 'side-loaded'
					: id.startsWith(MY_PREFIX)
						? 'mine'
						: 'third-party',
			core,
			failed: !!plugin.failed,
			errors: Array.isArray(plugin.errors)
				? plugin.errors.map((e: any) => ({
						code: String(e?.code ?? 'UNKNOWN'),
						message: String(e?.message ?? ''),
						stack: typeof e?.stack === 'string' && e.stack ? e.stack : null,
					}))
				: [],
			missingOptional: Array.isArray(plugin.unsatisfiedOptionalDependencies)
				? plugin.unsatisfiedOptionalDependencies.map(String)
				: [],
			dependencies,
			dependents: [],
			hasNative: manifest.dist?.android
				? true
				: core || !nativeIds
					? null
					: nativeIds.has(id),
			isApi: !!plugin.api,
			enabledByDefault:
				typeof plugin.enabledByDefault === 'boolean'
					? plugin.enabledByDefault
					: null,
			enabled:
				typeof states[id]?.enabled === 'boolean'
					? !!states[id].enabled
					: typeof plugin.enabledByDefault === 'boolean'
						? plugin.enabledByDefault
						: core
							? true
							: null,
			scriptBytes:
				typeof plugin.script === 'string' ? plugin.script.length : null,
			repo,
			channel:
				typeof plugin.source?.channel === 'string'
					? plugin.source.channel
					: null,
			latest: null,
			latestSize: null,
			published: [],
			live: live?.get(id) ?? null,
			health: 'ok' as Health,
			notes: [],
		}
	})

	const byId = new Map(plugins.map(plugin => [plugin.id, plugin]))
	for (const plugin of plugins) {
		for (const dependency of plugin.dependencies)
			byId.get(dependency.id)?.dependents.push(plugin.id)
	}

	const repos = [
		...new Set(
			plugins.map(plugin => plugin.repo).filter((r): r is string => !!r),
		),
	]
	const indexes = new Map<string, { index?: any; problem?: string }>()
	await Promise.all(
		repos.map(async repo => {
			try {
				indexes.set(repo, { index: await readIndex(repo) })
			} catch (error) {
				const aborted = (error as any)?.name === 'AbortError'
				indexes.set(repo, {
					problem: aborted
						? `${hostOf(repo)} did not answer`
						: `${hostOf(repo)}: ${String(error)}`,
				})
			}
		}),
	)

	for (const plugin of plugins) {
		if (plugin.repo) {
			const { index, problem } = indexes.get(plugin.repo) ?? {}
			const entry = index?.plugins?.[plugin.id]
			plugin.repoName = index?.name ?? null
			plugin.repoAuthor = entry?.author ?? index?.author ?? null
			if (problem) plugin.indexProblem = problem
			else if (!entry)
				plugin.indexProblem = `no longer listed by ${hostOf(plugin.repo)}`
			else {
				const latestRaw = entry.channels?.[plugin.channel ?? 'latest']
				plugin.latest = parseVersion(latestRaw)
				plugin.published = Object.entries(entry.versions ?? {})
					.map(([version, info]: [string, any]) => ({
						version,
						size: typeof info?.size === 'number' ? info.size : null,
					}))
					.sort((a, b) => {
						const va = parseVersion(a.version)
						const vb = parseVersion(b.version)
						return va && vb
							? compareVersions(vb, va)
							: b.version.localeCompare(a.version)
					})
				plugin.latestSize =
					plugin.published.find(published => published.version === latestRaw)
						?.size ?? null
			}
		}
		diagnose(plugin)
	}

	plugins.sort((a, b) => a.name.localeCompare(b.name))
	return publish({
		at: Date.now(),
		discord: versions.get('discord') ?? null,
		valencedApi: versions.get('valenced.api') ?? null,
		liveState: !!live,
		plugins,
		repoMeta: new Map(
			Array.from(indexes.entries()).map(([r, res]) => [
				r,
				{
					name: res.index?.name,
					author: res.index?.author,
					problem: res.problem,
				},
			]),
		),
	})
}

const STACK_LINES = 6

function describePlugin(plugin: Diagnosis, lines: string[], checkup: Checkup) {
	const where = plugin.repo
		? `${hostOf(plugin.repo)}, ${plugin.channel ?? 'latest'}`
		: plugin.origin
	lines.push(`- ${plugin.id} ${formatVersion(plugin.version)} [${where}]`)
	for (const note of plugin.notes) lines.push(`    ${note}`)
	if (plugin.dependencies.length) {
		const deps = plugin.dependencies.map(dependency => {
			const mark =
				dependency.satisfied === true
					? 'ok'
					: dependency.satisfied === false
						? 'NO'
						: '?'
			return `${dependency.id} ${dependency.range}${dependency.optional ? ' (optional)' : ''} = ${formatVersion(dependency.installed)} ${mark}`
		})
		lines.push(`    needs: ${deps.join('; ')}`)
	}
	if (plugin.dependents.length) {
		const name = (id: string) =>
			checkup.plugins.find(p => p.id === id)?.name ?? id
		lines.push(`    used by: ${plugin.dependents.map(name).join(', ')}`)
	}
	const facts = [
		plugin.hasNative ? 'native' : null,
		plugin.isApi ? 'API plugin' : null,
		plugin.scriptBytes != null
			? `script ${formatBytes(plugin.scriptBytes)}`
			: null,
		plugin.live?.status ? `status ${plugin.live.status}` : null,
	].filter(Boolean)
	if (facts.length) lines.push(`    ${facts.join(' · ')}`)
	for (const error of plugin.errors) {
		lines.push(`    ${error.code}: ${error.message}`)
		if (error.stack) {
			for (const line of error.stack.split('\n').slice(0, STACK_LINES))
				lines.push(`      ${line.trim()}`)
		}
	}
}

function header(checkup: Checkup): string[] {
	return [
		`Discord ${formatVersion(checkup.discord)} · Valenced API ${formatVersion(checkup.valencedApi)}`,
		`Checked ${new Date(checkup.at).toISOString()}${checkup.liveState ? ' · Developer Mode on' : ''}`,
	]
}

export function formatReport(checkup: Checkup): string {
	const lines = ['DevLab: plugin report', ...header(checkup)]
	if (checkup.problem) {
		lines.push('', checkup.problem)
		return lines.join('\n')
	}

	const section = (title: string, list: Diagnosis[]) => {
		if (!list.length) return
		lines.push('', `${title} (${list.length})`)
		for (const plugin of list) describePlugin(plugin, lines, checkup)
	}

	const own = checkup.plugins.filter(plugin => !plugin.core)
	section(
		'Problems',
		own.filter(plugin => plugin.health === 'error'),
	)
	section(
		'Warnings',
		own.filter(plugin => plugin.health === 'warning'),
	)
	section(
		'Healthy',
		own.filter(plugin => plugin.health === 'ok'),
	)
	section(
		'Built in',
		checkup.plugins.filter(plugin => plugin.core),
	)
	return lines.join('\n')
}

export function formatCompactReport(checkup: Checkup): string {
	const lines = header(checkup)
	if (checkup.problem) {
		lines.push('', checkup.problem)
		return lines.join('\n')
	}
	const own = checkup.plugins.filter(plugin => !plugin.core)
	const flagged = own.filter(plugin => plugin.health !== 'ok')
	if (flagged.length) {
		lines.push('', `Plugins with problems or warnings (${flagged.length})`)
		for (const plugin of flagged) describePlugin(plugin, lines, checkup)
	}
	const rest = own
		.filter(plugin => plugin.health === 'ok')
		.sort((a, b) => a.name.localeCompare(b.name))
	if (rest.length) {
		lines.push('', `Other installed plugins (${rest.length})`)
		for (const plugin of rest) {
			const where = plugin.repo ? hostOf(plugin.repo) : plugin.origin
			const facts = [
				where,
				plugin.enabled === false ? 'off' : null,
				plugin.hasNative ? 'native' : null,
			].filter(Boolean)
			lines.push(
				`- ${plugin.name} (${plugin.id}) ${formatVersion(plugin.version)} [${facts.join(', ')}]`,
			)
		}
	}
	return lines.join('\n')
}

export function formatPluginReport(
	plugin: Diagnosis,
	checkup: Checkup,
): string {
	const lines = [`DevLab: ${plugin.name}`, ...header(checkup), '']
	describePlugin(plugin, lines, checkup)
	return lines.join('\n')
}

export function copyText(text: string): boolean {
	try {
		const clipboard = (clipboardModule as any)?.Clipboard
		if (typeof clipboard?.setString !== 'function') return false
		clipboard.setString(text)
		return true
	} catch {
		return false
	}
}
