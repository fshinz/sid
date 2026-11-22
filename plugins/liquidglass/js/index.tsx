import { clearAll, pushConfig } from './native'
import { GlassSettings } from './settings'
import { bindStorage, readGlassWhenLoaded } from './storage'
import type { StorageState } from './storage'

export default plugin<{ jsonStorage: StorageState }>({
	jsonStorage: {
		load: true,
		default: {},
	},

	SettingsComponent: GlassSettings,

	start({ cleanup, jsonStorage, logger }) {
		bindStorage(jsonStorage)

		void readGlassWhenLoaded()
			.then(state => pushConfig(state))
			.catch(error => logger.log(`glass configure failed: ${String(error)}`))

		cleanup(() => {
			void clearAll().catch(() => {})
		})
	},
})
