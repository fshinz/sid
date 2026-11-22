import { clearAll, pushConfig } from './native'
import { GlassSettings } from './settings'
import { bindStorage, readGlassFrom } from './storage'
import type { StorageState } from './storage'

export default plugin<{ jsonStorage: StorageState }>({
	jsonStorage: {
		load: true,
		default: {},
	},

	SettingsComponent: GlassSettings,

	start({ cleanup, jsonStorage, logger }) {
		bindStorage(jsonStorage)

		void jsonStorage
			.get()
			.then(doc => pushConfig(readGlassFrom(doc)))
			.catch(error => logger.log(`glass configure failed: ${String(error)}`))

		cleanup(() => {
			void clearAll().catch(() => {})
		})
	},
})
