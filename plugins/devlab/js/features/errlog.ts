import * as commonLogger from '@valenced/discord/common/logger'
import { saveLogs } from '../storage'

export type Level = 'debug' | 'log' | 'info' | 'warn' | 'error' | 'fatal'
export type Source = 'console' | 'discord' | 'uncaught'

export type LogEntry = {
	t: number
	lvl: Level
	src: Source
	plugin: string | null
	tag?: string
	msg: string
	stack?: string
	repeats?: number
}

export const OWN_ID = 'shin.dev-lab'
const DEV_KIT_ID = 'valenced.developer-kit'

const MEMORY_LIMIT = 500
const MESSAGE_LIMIT = 4000
const STACK_LINES = 12
const REPEAT_WINDOW_MS = 5000
const PERSIST_MS = 1500

// Never keep raw credentials in the log.
const REDACTIONS: Array<[RegExp, string]> = [
	[/[\w-]{24,28}\.[\w-]{6}\.[\w-]{27,}/g, '[redacted]'],
	[/mfa\.[\w-]{80,}/g, '[redacted]'],
	[
		/(authorization["']?\s*[:=]\s*["']?)(bearer |bot )?[^\s"',}]+/gi,
		'$1[redacted]',
	],
	[/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, '[redacted]'],
	[/\bAIza[0-9A-Za-z_-]{30,}/g, '[redacted]'],
]

export function redact(text: string): string {
	let out = text
	for (const [pattern, replacement] of REDACTIONS)
		out = out.replace(pattern, replacement)
	return out
}

// Renders any logged value as short safe text: strings, errors, arrays,
// objects, and React elements.
function describe(value: unknown, depth: number, seen: Set<unknown>): string {
	if (value === null) return 'null'
	switch (typeof value) {
		case 'string':
			return depth === 0 ? value : JSON.stringify(value)
		case 'number':
		case 'boolean':
		case 'bigint':
		case 'undefined':
			return String(value)
		case 'symbol':
			return value.toString()
		case 'function':
			return `[Function ${(value as any).name || 'anonymous'}]`
	}
	if (value instanceof Error) return `${value.name}: ${value.message}`
	if (seen.has(value)) return '[Circular]'
	if (depth >= 3)
		return Array.isArray(value) ? `[Array(${value.length})]` : '[Object]'
	seen.add(value)
	try {
		if (Array.isArray(value)) {
			const items = value
				.slice(0, 20)
				.map(item => describe(item, depth + 1, seen))
			if (value.length > 20) items.push(`… ${value.length - 20} more`)
			return `[${items.join(', ')}]`
		}
		const element = value as any
		if (element.$$typeof && element.type) {
			const type =
				typeof element.type === 'string'
					? element.type
					: (element.type.displayName ?? element.type.name)
			return `<${type || 'Element'} />`
		}
		const keys = Object.keys(value as object)
		const parts = keys
			.slice(0, 15)
			.map(key => `${key}: ${describe((value as any)[key], depth + 1, seen)}`)
		if (keys.length > 15) parts.push(`… ${keys.length - 15} more`)
		const name = (value as any).constructor?.name
		return `${name && name !== 'Object' ? `${name} ` : ''}{${parts.join(', ')}}`
	} catch {
		return '[Unreadable]'
	} finally {
		seen.delete(value)
	}
}

function trimStack(stack: string): string {
	return stack
		.split('\n')
		.slice(0, STACK_LINES + 1)
		.join('\n')
}

function format(args: unknown[]): { msg: string; stack?: string } {
	const seen = new Set<unknown>()
	let stack: string | undefined
	const msg = args
		.map(arg => {
			if (arg instanceof Error && !stack && typeof arg.stack === 'string')
				stack = arg.stack
			return describe(arg, 0, seen)
		})
		.join(' ')
	return {
		msg: redact(
			msg.length > MESSAGE_LIMIT
				? `${msg.slice(0, MESSAGE_LIMIT)}… (${msg.length} chars)`
				: msg,
		),
		stack: stack ? redact(trimStack(stack)) : undefined,
	}
}

// ── attribution: which plugin caused this? ──────────────────────────────────

const PLUGIN_FRAME = /Valenced:Plugin:([^:)\s]+)/
const PROXY_FRAME = /proxy trap/

function callerFrames(stack: string, overridden: boolean): string[] {
	const lines = stack.split('\n').slice(1)
	if (!overridden) return lines
	const proxy = lines.findIndex(line => PROXY_FRAME.test(line))
	return proxy < 0 ? lines : lines.slice(proxy + 1)
}

function attribute(
	stack: string | undefined,
	overridden = false,
): string | null {
	if (!stack) return null
	let sawDevKit = false
	for (const line of callerFrames(stack, overridden)) {
		const match = PLUGIN_FRAME.exec(line)
		if (!match) {
			if (line.includes('index.android.bundle')) return null
			continue
		}
		const id = match[1]
		if (id === OWN_ID) continue
		if (id === DEV_KIT_ID) {
			sawDevKit = true
			continue
		}
		return id
	}
	return sawDevKit ? DEV_KIT_ID : null
}

function callSite(
	stack: string | undefined,
	overridden = false,
): string | undefined {
	if (!stack) return undefined
	const lines = callerFrames(stack, overridden)
	const first = lines.findIndex(
		line =>
			!line.includes(`Valenced:Plugin:${OWN_ID}`) &&
			!line.includes(`Valenced:Plugin:${DEV_KIT_ID}`),
	)
	return first < 0
		? undefined
		: trimStack(`Logged from:\n${lines.slice(first).join('\n')}`)
}

// ── memory + listeners ──────────────────────────────────────────────────────

const memory: LogEntry[] = []
const listeners = new Set<() => void>()
let persistTimer: ReturnType<typeof setTimeout> | undefined
let inside = false
let paused = false

export function entries(): readonly LogEntry[] {
	return memory
}

export function onEntries(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function isCapturePaused() {
	return paused
}

export function setCapturePaused(value: boolean) {
	paused = value
	notify()
}

export function clearEntries() {
	memory.length = 0
	schedulePersist()
	notify()
}

/** Replaces the in-memory log — used to hydrate persisted entries at startup. */
export function restoreEntries(saved: LogEntry[]) {
	memory.length = 0
	memory.push(...saved.slice(-MEMORY_LIMIT))
	notify()
}

function notify() {
	for (const listener of [...listeners]) {
		try {
			listener()
		} catch {
			// Ignore.
		}
	}
}

function schedulePersist() {
	if (persistTimer) return
	persistTimer = setTimeout(() => {
		persistTimer = undefined
		void saveLogs(memory.slice(-MEMORY_LIMIT))
	}, PERSIST_MS)
}

function record(entry: LogEntry) {
	memory.push(entry)
	if (memory.length > MEMORY_LIMIT)
		memory.splice(0, memory.length - MEMORY_LIMIT)
	schedulePersist()
	notify()
}

function capture(
	src: Source,
	lvl: Level,
	args: unknown[],
	tag?: string,
	withStack = true,
	overridden = false,
) {
	if (inside || paused) return
	inside = true
	try {
		const { msg, stack } = format(args)

		// Collapse identical messages into a repeat counter.
		const last = memory[memory.length - 1]
		const now = Date.now()
		if (
			last &&
			last.msg === msg &&
			last.lvl === lvl &&
			last.src === src &&
			last.tag === tag &&
			now - last.t < REPEAT_WINDOW_MS
		) {
			last.repeats = (last.repeats ?? 0) + 1
			return
		}

		const raw = withStack ? new Error().stack : undefined
		const serious = lvl === 'warn' || lvl === 'error' || lvl === 'fatal'
		record({
			t: now,
			lvl,
			src,
			plugin: attribute(raw, overridden),
			tag,
			msg,
			stack: stack ?? (serious ? callSite(raw, overridden) : undefined),
		})
	} catch {
		// Never break the caller.
	} finally {
		inside = false
	}
}

/** Records an error reported through the plugin API. */
export function recordPluginError(error: unknown, tag?: string) {
	capture('uncaught', 'error', [error], tag)
}

// ── hooks ───────────────────────────────────────────────────────────────────

function wrap(
	target: any,
	fn: string,
	onCall: (self: any, args: unknown[], overridden: boolean) => void,
): (() => void) | undefined {
	const original = target[fn]
	if (typeof original !== 'function') return undefined
	let active = true
	const wrapper = function (this: any, ...args: unknown[]) {
		if (active) onCall(this, args, target[fn] !== wrapper)
		return original.apply(this, args)
	}
	try {
		target[fn] = wrapper
	} catch {
		return undefined
	}
	return () => {
		active = false
		if (target[fn] === wrapper) target[fn] = original
	}
}

const CONSOLE_LEVELS: Array<[keyof Console, Level]> = [
	['debug', 'debug'],
	['log', 'log'],
	['info', 'info'],
	['warn', 'warn'],
	['error', 'error'],
]

export function startErrorLog(): () => void {
	const unpatches: Array<() => void> = []

	for (const [method, lvl] of CONSOLE_LEVELS) {
		const undo = wrap(console, method, (_self, args, overridden) =>
			capture('console', lvl, args, undefined, true, overridden),
		)
		if (undo) unpatches.push(undo)
	}

	// Uncaught JS errors and fatal crashes.
	const ErrorUtils = (globalThis as any).ErrorUtils
	let restoreHandler: (() => void) | undefined
	if (ErrorUtils?.getGlobalHandler && ErrorUtils?.setGlobalHandler) {
		const previous = ErrorUtils.getGlobalHandler()
		const handler = (error: unknown, isFatal?: boolean) => {
			capture('uncaught', isFatal ? 'fatal' : 'error', [error])
			return previous?.(error, isFatal)
		}
		ErrorUtils.setGlobalHandler(handler)
		restoreHandler = () => {
			if (ErrorUtils.getGlobalHandler() === handler)
				ErrorUtils.setGlobalHandler(previous)
		}
	}

	// Discord's own logger (Logger.prototype.*), tagged with the logger name.
	const restores: Array<() => void> = []
	const proto = (commonLogger as any)?.Logger?.prototype
	if (proto) {
		const DISCORD_LEVELS: Array<[string, Level]> = [
			['log', 'log'],
			['info', 'info'],
			['warn', 'warn'],
			['error', 'error'],
			['trace', 'debug'],
			['verbose', 'debug'],
		]
		for (const [method, lvl] of DISCORD_LEVELS) {
			const undo = wrap(proto, method, (self, args) =>
				capture('discord', lvl, args, loggerName(self), false),
			)
			if (undo) restores.push(undo)
		}
	}

	return () => {
		for (const unpatch of unpatches) unpatch()
		for (const restore of restores) restore()
		restoreHandler?.()
	}
}

function loggerName(logger: any): string | undefined {
	try {
		const name = logger?.name ?? logger?.tag ?? logger?._name
		return typeof name === 'string' ? name : undefined
	} catch {
		return undefined
	}
}

// ── formatting for the UI ───────────────────────────────────────────────────

export function formatEntry(entry: LogEntry): string {
	const time = new Date(entry.t).toISOString().slice(11, 23)
	const who =
		entry.plugin ??
		(entry.src === 'discord'
			? `Discord${entry.tag ? `/${entry.tag}` : ''}`
			: 'Discord')
	const head = `${time} ${entry.lvl.toUpperCase().padEnd(5)} [${who}] ${entry.msg}${
		entry.repeats ? ` (×${entry.repeats + 1})` : ''
	}`
	return entry.stack ? `${head}\n${entry.stack}` : head
}

export function logCounts() {
	let errors = 0
	let warnings = 0
	for (const entry of memory) {
		if (entry.lvl === 'error' || entry.lvl === 'fatal') errors++
		else if (entry.lvl === 'warn') warnings++
	}
	return { total: memory.length, errors, warnings }
}
