import { sha256hex } from './util.ts'

export interface PluginDist {
	url: string
	size: number
	sha256: string
}

export interface PluginEntry {
	id: string
	version: string
	name: string
	description: string
	author: string
	channels: Record<string, PluginDist>
}

export interface PoolIndex {
	format: number
	plugins: PluginEntry[]
}

export function parseIndex(raw: unknown): PoolIndex {
	const doc = raw as PoolIndex
	if (doc?.format !== 1 || !Array.isArray(doc.plugins))
		throw new Error('unsupported pool index')
	for (const plugin of doc.plugins) {
		if (!plugin.id || !plugin.version || !plugin.channels)
			throw new Error('plugin entry incomplete')
	}
	return doc
}

export function pickChannel(
	entry: PluginEntry,
	channel: string,
): PluginDist | undefined {
	const order = [channel, 'stable', 'beta', 'canary']
	for (const name of order) {
		const dist = entry.channels[name]
		if (dist) return dist
	}
	return undefined
}

export async function verifyDist(
	data: Uint8Array,
	dist: PluginDist,
): Promise<void> {
	if (dist.size && data.length !== dist.size) throw new Error('size mismatch')
	if (dist.sha256) {
		const digest = await sha256hex(data)
		if (digest !== dist.sha256.toLowerCase()) throw new Error('sha256 mismatch')
	}
}

export async function fetchDist(dist: PluginDist): Promise<Uint8Array> {
	let response: Response
	try {
		response = await fetch(dist.url)
	} catch {
		throw new Error(
			`download blocked for ${dist.url}, fetch the file and add it manually`,
		)
	}
	if (!response.ok) throw new Error(`download failed: ${response.status}`)
	const data = new Uint8Array(await response.arrayBuffer())
	await verifyDist(data, dist)
	return data
}

export function pluginScriptName(entry: PluginEntry): string {
	return `${entry.id}.js`
}

export function describePlugin(entry: PluginEntry): string {
	return `${entry.name || entry.id} ${entry.version}`
}
