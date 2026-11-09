import * as modulesNative from '@valenced/modules/native'
import {
	describeError,
	formatReport,
	formatVersion,
	runCheckup,
} from './diagcheck'
import type { Checkup, Diagnosis } from './diagcheck'

export const EXPORT_FOLDER = 'Download/DevLab'
export const SEND_LIMIT = 2000

const OWN_ID = 'shin.dev-lab'

export interface Device {
	appVersionName?: string | null
	appVersionCode?: number | null
	androidRelease?: string | null
	sdk?: number | null
	securityPatch?: string | null
	manufacturer?: string | null
	model?: string | null
	abi?: string | null
}

export interface ExitInfo {
	pid: number
	timestamp: number
	reason: number
	reasonText: string
	description: string | null
	status: number
	importance: number
	processName: string | null
	pssKb: number
	rssKb: number
	hasTrace: boolean
}

export interface SessionInfo {
	id: string
	startedAt: number
	pid: number
	current: boolean
	jsBytes: number
	logcatBytes: number
	crash: boolean
	exit: ExitInfo | null
}

const native = (method: string) => {
	const call = (modulesNative as any)?.callNativeMethod
	return typeof call === 'function'
		? Promise.resolve(call(method, []))
		: Promise.reject(new Error('no bridge'))
}

async function settle<T>(promise: Promise<T>): Promise<T | undefined> {
	try {
		return await promise
	} catch {
		return undefined
	}
}

const byName = (a: Diagnosis, b: Diagnosis) => a.name.localeCompare(b.name)

function quote(names: string[]): string {
	return `> ${names.join(', ')}`
}

function cleanAuthor(str?: string | null): string | null {
	if (!str) return null
	const s = str
		.replace(/<[^>]+>/g, '')
		.replace(/\([^)]+\)/g, '')
		.trim()
	if (s.toLowerCase() === 'your name' || !s) return null
	return s
}

function getRepoHeader(
	repoUrl: string,
	author?: string | null,
	name?: string | null,
): string {
	if (
		repoUrl.includes('community.valenced.app') ||
		(name && /community/i.test(name))
	) {
		return `[${name || 'Valenced Community Plugins'}](<${repoUrl}>):`
	}
	const cAuthor = cleanAuthor(author)
	let title: string
	if (cAuthor) {
		title = cAuthor.endsWith('s') ? `${cAuthor}'` : `${cAuthor}'s`
	} else if (name) {
		title = name
	} else {
		title = host(repoUrl)
	}
	return `[${title}](<${repoUrl}>):`
}

function host(url: string): string {
	return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

export interface ReportOptions {
	core: boolean
	compact?: boolean
}

export interface ReportData {
	checkup: Checkup
	device?: Device
	loader?: { name?: string; version?: string }
	previous?: SessionInfo
	sessions: SessionInfo[]
	exits: ExitInfo[]
}

export async function gatherReport(): Promise<ReportData> {
	const [checkup, device, loader, sessions, exits] = await Promise.all([
		runCheckup(),
		settle(native(`${OWN_ID}.device`)),
		settle(native('valenced.info')),
		settle(native(`${OWN_ID}.logs.sessions`)),
		settle(native(`${OWN_ID}.logs.exits`)),
	])
	const list = Array.isArray(sessions) ? sessions : []
	return {
		checkup,
		device: device as Device | undefined,
		loader: loader as any,
		previous: list.find(session => !session.current),
		sessions: list,
		exits: Array.isArray(exits) ? exits : [],
	}
}

export function formatReportMessages(
	{ checkup, device, loader }: ReportData,
	options: ReportOptions,
	limit: number = SEND_LIMIT,
): string[] {
	const debutLines: string[] = []

	const discord = device?.appVersionName
		? `${device.appVersionName}${device.appVersionCode ? ` (${device.appVersionCode})` : ''}`
		: formatVersion(checkup.discord)
	const valencedBuild = [
		loader?.version ? `${loader.name ?? 'Valenced'} ${loader.version}` : null,
		`API ${formatVersion(checkup.valencedApi)}`,
	].filter((part): part is string => !!part)
	const android = [
		device?.androidRelease
			? `${device.androidRelease}${device.sdk ? ` (API ${device.sdk})` : ''}`
			: 'unknown',
		[device?.manufacturer, device?.model].filter(Boolean).join(' ') || null,
		device?.abi,
		device?.securityPatch ? `patch ${device.securityPatch}` : null,
	].filter((part): part is string => !!part)

	debutLines.push('**Build Info:**')
	debutLines.push('Discord:', `> ${discord}`)
	debutLines.push('Valenced:', quote(valencedBuild))
	debutLines.push('Android:', quote(android))

	if (checkup.problem) {
		debutLines.push('', checkup.problem)
		return [debutLines.join('\n')]
	}

	const listed = checkup.plugins
		.filter(plugin => options.core || !plugin.core)
		.sort(byName)
	const enabled = listed.filter(plugin => plugin.enabled !== false)
	const broken = enabled.filter(plugin => plugin.health === 'error')

	if (broken.length) {
		debutLines.push('', `**Not working (${broken.length}):**`)
		for (const plugin of broken) {
			const why = plugin.errors[0]
				? describeError(plugin.errors[0])
				: (plugin.notes[0] ?? 'did not load')
			debutLines.push(
				`> ${plugin.name} ${formatVersion(plugin.version)}: ${why}`,
			)
		}
	}

	const updates = listed.filter(
		plugin =>
			plugin.latest &&
			plugin.notes.some(note => note.startsWith('Update available')),
	)
	if (updates.length) {
		debutLines.push('', `**Updates available (${updates.length}):**`)
		debutLines.push(
			quote(
				updates.map(
					plugin =>
						`${plugin.name} ${formatVersion(plugin.version)} → ${formatVersion(plugin.latest)}`,
				),
			),
		)
	}

	const debutMessage = debutLines.join('\n')

	const byRepo = new Map<string, Diagnosis[]>()
	const sideLoaded: Diagnosis[] = []

	for (const plugin of listed) {
		if (plugin.repo) {
			const list = byRepo.get(plugin.repo) ?? []
			list.push(plugin)
			byRepo.set(plugin.repo, list)
		} else {
			sideLoaded.push(plugin)
		}
	}

	const chunks: string[] = []
	let current = ''

	const pushLine = (line: string) => {
		if (current.length === 0) {
			current = line
			return
		}
		if (current.length + 1 + line.length <= limit) {
			current += `\n${line}`
		} else {
			chunks.push(current.trim())
			current = line
		}
	}

	pushLine(`**Installed Plugins (${listed.length}):**\n`)

	for (const [repoUrl, rPlugins] of byRepo.entries()) {
		rPlugins.sort(byName)
		const meta = checkup.repoMeta?.get(repoUrl)
		const sampleAuthor =
			meta?.author ??
			rPlugins.find(p => p.repoAuthor || p.author)?.repoAuthor ??
			rPlugins.find(p => p.author)?.author
		const repoTitle = meta?.name ?? rPlugins[0]?.repoName
		const header = getRepoHeader(repoUrl, sampleAuthor, repoTitle)

		if (current.length + 1 + header.length > limit) {
			chunks.push(current.trim())
			current = header
		} else {
			pushLine(header)
		}

		for (const plugin of rPlugins) {
			const line = `> ${plugin.name} \`${formatVersion(plugin.version)}\``
			if (current.length + 1 + line.length > limit) {
				chunks.push(current.trim())
				current = `${header} (cont.)\n${line}`
			} else {
				pushLine(line)
			}
		}
		pushLine('')
	}

	if (sideLoaded.length > 0) {
		sideLoaded.sort(byName)
		const header = '__Side-loaded / Local__:'
		if (current.length + 1 + header.length > limit) {
			chunks.push(current.trim())
			current = header
		} else {
			pushLine(header)
		}
		for (const plugin of sideLoaded) {
			const line = `> ${plugin.name} \`${formatVersion(plugin.version)}\``
			if (current.length + 1 + line.length > limit) {
				chunks.push(current.trim())
				current = `${header} (cont.)\n${line}`
			} else {
				pushLine(line)
			}
		}
	}

	if (current.trim().length > 0) {
		chunks.push(current.trim())
	}

	return [debutMessage, ...chunks]
}

export function formatReportMessage(
	data: ReportData,
	options: ReportOptions,
): string {
	return formatReportMessages(data, options, SEND_LIMIT).join('\n\n')
}

export function fitReport(
	data: ReportData,
	options: ReportOptions,
	limit: number,
): string {
	const messages = formatReportMessages(data, options, limit)
	const combined = messages.join('\n\n')
	if (combined.length <= limit) return combined
	return `${combined.slice(0, limit - 1)}…`
}

export function buildFullReportHeader(data: ReportData): string {
	const summary = formatReportMessage(data, { core: true }).replace(/\*\*/g, '')
	const exits = data.exits.length
		? data.exits
				.slice(0, 15)
				.map(
					exit =>
						`- ${new Date(exit.timestamp).toISOString()}  pid ${exit.pid}  ${exit.reasonText}${exit.description ? ` (${exit.description})` : ''}${exit.processName ? `  [${exit.processName}]` : ''}`,
				)
				.join('\n')
		: '- none recorded (needs Android 11+)'
	return [
		'DevLab full report',
		`Saved ${new Date().toISOString()}`,
		'',
		'########## Summary ##########',
		summary,
		'',
		'########## Plugins in detail ##########',
		formatReport(data.checkup),
		'',
		"########## Why Discord closed (Android's record) ##########",
		exits,
		'',
		'########## This session ##########',
	].join('\n')
}

function stamp(): string {
	const d = new Date()
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function fileName(what: string): string {
	return `devlab-${what.replace(/[^\w-]+/g, '-')}-${stamp()}.txt`
}

async function runExport(args: unknown[], share: boolean): Promise<boolean> {
	try {
		const nativeCall = (modulesNative as any).callNativeMethod
		const result = await nativeCall(`${OWN_ID}.export`, args)
		toastResult(
			share
				? `Saved to ${result?.path ?? EXPORT_FOLDER}; choose where to send it.`
				: `Saved to ${result?.path ?? EXPORT_FOLDER}.`,
		)
		return true
	} catch (error) {
		toastResult(
			`Could not save it: ${String((error as any)?.message ?? error)}`,
			true,
		)
		return false
	}
}

let toastSink: ((text: string, critical?: boolean) => void) | undefined

export function setExportToast(fn: (text: string, critical?: boolean) => void) {
	toastSink = fn
}

function toastResult(text: string, critical?: boolean) {
	toastSink?.(text, critical)
}

export function exportText(
	what: string,
	text: string,
	share: boolean,
): Promise<boolean> {
	return runExport([fileName(what), text, null, share], share)
}

export function exportSession(
	sessionId: string,
	share: boolean,
): Promise<boolean> {
	return runExport([fileName('session'), null, sessionId, share], share)
}

export async function exportFullReport(share: boolean): Promise<boolean> {
	toastResult('Building the full report…')
	let data: ReportData
	try {
		data = await gatherReport()
	} catch (error) {
		toastResult(
			`Could not build the report: ${String((error as any)?.message ?? error)}`,
			true,
		)
		return false
	}
	const current = data.sessions.find(session => session.current)
	const previous = data.sessions.find(session => !session.current)
	return runExport(
		[
			fileName('full-report'),
			null,
			current?.id ?? null,
			share,
			buildFullReportHeader(data),
			previous ? [previous.id] : [],
		],
		share,
	)
}
