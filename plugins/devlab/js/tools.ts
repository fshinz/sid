import { CompatibilityTab } from './tabs/CompatibilityTab'
import { SandboxTab } from './tabs/SandboxTab'
import { WatchTab } from './tabs/WatchTab'

export const TOOLS = [
	{
		route: 'shin.devlab.compat',
		title: 'Compat',
		description: 'Check installed plugins for API problems.',
		Screen: CompatibilityTab,
	},
	{
		route: 'shin.devlab.watch',
		title: 'Watch',
		description: 'Monitor Flux stores for changes.',
		Screen: WatchTab,
	},
	{
		route: 'shin.devlab.sandbox',
		title: 'Sandbox',
		description: 'Run JavaScript snippets against the plugin API.',
		Screen: SandboxTab,
	},
]
