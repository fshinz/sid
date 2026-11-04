import { getInstalledPlugins } from '../native'

export type CompatibilityProblem = {
	id: string
	type: 'missing' | 'version' | 'api'
	message: string
}

export type CompatibilityReport = {
	pluginId: string
	pluginName: string
	compatible: boolean
	problems: CompatibilityProblem[]
}

const KNOWN_API: Record<string, string[]> = {
	'@valenced/discord/design': [
		'Design',
		'TableRow',
		'TableRowGroup',
		'TableSwitchRow',
		'Button',
		'Text',
		'Stack',
	],
	'@valenced/react': ['React', 'ReactNative'],
	'@valenced/modules/finders': ['getModules', 'withProps', 'withName'],
	'@valenced/patcher': ['before', 'after', 'instead'],
	'@valenced/externals/react-native-clipboard': ['Clipboard'],
}

// Only understands ranges like ">=1 <2", which is all valenced.api uses.
function satisfiesMajor(version: string, range: string) {
	const major = Number(version.split('.')[0]) || 0
	const min = Number(range.match(/>=(\d+)/)?.[1] ?? 0)
	const max = Number(range.match(/<(\d+)/)?.[1] ?? Infinity)
	return major >= min && major < max
}

async function loadPlugins(): Promise<any[]> {
	let plugins: unknown = []
	try {
		plugins = await getInstalledPlugins()
	} catch {
		// Fall through to the global registry below.
	}
	if (Array.isArray(plugins) && plugins.length > 0) return plugins

	const registry = (globalThis as any).__valenced?.plugins
	return registry ? Object.values(registry) : []
}

export async function checkAllPlugins(): Promise<CompatibilityReport[]> {
	const plugins = await loadPlugins()
	const clientVersion = (globalThis as any).__valenced?.version ?? '1.0.0'

	return plugins.map((plugin): CompatibilityReport => {
		const manifest = plugin.manifest ?? plugin
		const problems: CompatibilityProblem[] = []

		const requiredApi = manifest?.dependencies?.['valenced.api']?.version
		if (requiredApi && !satisfiesMajor(clientVersion, requiredApi)) {
			problems.push({
				id: 'valenced.api',
				type: 'version',
				message: `Requires valenced.api ${requiredApi}, running ${clientVersion}`,
			})
		}

		const imports: string[] = manifest?.imports ?? []
		for (const path of imports) {
			if (!KNOWN_API[path]) {
				problems.push({
					id: path,
					type: 'api',
					message: `Import path "${path}" is not a recognized Valenced API.`,
				})
			}
		}

		return {
			pluginId: manifest?.id ?? plugin.id ?? 'unknown',
			pluginName: manifest?.name ?? plugin.name ?? 'Unknown Plugin',
			compatible: problems.length === 0,
			problems,
		}
	})
}
