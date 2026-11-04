import * as settings from '@valenced/discord/modules/settings'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { setPluginApi } from './api'
import { DevLabSettings } from './settings'
import { bindStorage, recordError } from './storage'
import { TOOLS } from './tools'
import type { DevLabState } from './storage'

const SETTINGS_KEY = 'shin.devlab.settings'
const SECTION = 'VALENCED'
const SECTION_RETRY_MS = 20
const SECTION_MAX_ATTEMPTS = 500

// Each tool is its own screen so the system back gesture returns to the Tools tab.
const toolItems: Record<string, settings.SettingsItem> = {}
for (const { route, title, Screen } of TOOLS) {
	toolItems[route] = {
		type: 'route',
		parent: null,
		unsearchable: true,
		useTitle: () => title,
		screen: { route, getComponent: () => Screen },
	}
}

const initialState: DevLabState = { entries: [], enabled: true }

// addSettingsItemToSection throws while the section doesn't exist yet.
function sectionExists() {
	try {
		settings.addSettingsItemToSection(SECTION, items => items)()
		return true
	} catch {
		return false
	}
}

export default plugin<{ jsonStorage: DevLabState }>({
	jsonStorage: {
		load: true,
		default: initialState,
	},

	SettingsComponent: DevLabSettings,

	start({ cleanup, plugin: self, jsonStorage, logger }) {
		bindStorage(jsonStorage)
		setPluginApi(self)

		const report = (error: unknown, context: string) => {
			recordError(error, context).catch(() => {})
		}

		// Errors other plugins report through the plugin API end up in the Errors tab.
		self.reportError = error => report(error, 'Reported plugin error')

		const errorUtils = (globalThis as any).ErrorUtils
		const previousHandler = errorUtils?.getGlobalHandler?.()

		errorUtils?.setGlobalHandler?.((error: Error, isFatal: boolean) => {
			report(error, isFatal ? 'Fatal error' : 'Unhandled error')
			previousHandler?.(error, isFatal)
		})

		cleanup(() => {
			if (previousHandler) errorUtils?.setGlobalHandler?.(previousHandler)
		})

		// DevLab also gets its own row in Discord settings :>
		const undo: Array<() => void> = []
		let stopped = false
		let retryTimer: ReturnType<typeof setTimeout> | undefined
		let attempts = 0

		const placeInSection = () => {
			if (stopped) return

			if (!sectionExists()) {
				if (++attempts < SECTION_MAX_ATTEMPTS) {
					retryTimer = setTimeout(placeInSection, SECTION_RETRY_MS)
				}
				return
			}

			undo.push(
				settings.registerSettingsSection
					? settings.registerSettingsSection(SETTINGS_KEY, {
							label: 'DevLab',
							settings: [SETTINGS_KEY],
							index: 1,
						})
					: settings.addSettingsItemToSection(SECTION, SETTINGS_KEY),
			)
			settings.refreshSettings()
		}

		const stopListening = settings.onSettingsModulesLoaded(() => {
			undo.push(
				settings.registerSettingsItems({
					[SETTINGS_KEY]: {
						type: 'route',
						parent: null,
						IconComponent: lookupGeneratedIconComponent('WrenchIcon'),
						useTitle: () => 'DevLab',
						screen: {
							route: SETTINGS_KEY,
							getComponent: () => DevLabSettings,
						},
					},
					...toolItems,
				}),
			)
			placeInSection()
		})

		cleanup(stopListening, () => {
			stopped = true
			clearTimeout(retryTimer)
			for (const remove of undo.splice(0)) {
				try {
					remove()
				} catch {
					// Already removed along with its section.
				}
			}
			settings.refreshSettings()
		})

		logger.log('DevLab started')
	},
})
