import type { Plugin } from '@valenced/plugins/types'

// Set on start so the sandbox can hand the plugin to user code as `api`.
export let pluginApi: Plugin<any> | null = null

export function setPluginApi(plugin: Plugin<any>) {
	pluginApi = plugin
}
