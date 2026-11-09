import type { Plugin } from '@valenced/plugins/types'

export let pluginApi: Plugin<any> | null = null

export function setPluginApi(plugin: Plugin<any>) {
	pluginApi = plugin
}
