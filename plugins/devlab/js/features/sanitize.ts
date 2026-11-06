export const SENSITIVE_KEY =
	/(token|authorization|password|secret|cookie|session.?id|api.?key|credential)/i

const MAX_DEPTH = 4
const MAX_ARRAY_ITEMS = 40
const MAX_OBJECT_KEYS = 80
const MAX_STRING_LENGTH = 4000

export function safely<T>(callback: () => T): T | undefined {
	try {
		return callback()
	} catch {
		return undefined
	}
}

export function sanitize(
	value: any,
	depth = 0,
	seen = new WeakSet<object>(),
): any {
	if (value === null || value === undefined) return value
	if (typeof value === 'string') {
		return value.length > MAX_STRING_LENGTH
			? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated]`
			: value
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value
	if (typeof value === 'bigint') return `${value}n`
	if (typeof value === 'function') {
		return `[Function ${value.name || 'anonymous'}]`
	}
	if (typeof value !== 'object') return String(value)
	if (depth >= MAX_DEPTH) return '[Max depth reached]'
	if (seen.has(value)) return '[Circular reference]'

	seen.add(value)
	try {
		if (Array.isArray(value)) {
			return value
				.slice(0, MAX_ARRAY_ITEMS)
				.map(item => sanitize(item, depth + 1, seen))
		}

		const keys = safely(() => Object.keys(value)) ?? []
		const result: Record<string, any> = {}
		for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
			result[key] = SENSITIVE_KEY.test(key)
				? '[REDACTED]'
				: (safely(() => sanitize(value[key], depth + 1, seen)) ??
					'[Unable to read property]')
		}
		if (keys.length > MAX_OBJECT_KEYS) {
			result['…'] = '[Additional properties omitted]'
		}
		return result
	} finally {
		seen.delete(value)
	}
}

export function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value)
	} catch {
		return String(value)
	}
}
