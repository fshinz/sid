declare module '@valenced/plugins/_' {
	const pList: Map<string, any> | undefined
	function isPluginEnabled(plugin: any): boolean
	function isPluginStartedLate(plugin: any): boolean
	function isPluginPendingReload(plugin: any): boolean
	function isPluginPendingUpdate(plugin: any): boolean
	function isPluginErrored(plugin: any): boolean
}
