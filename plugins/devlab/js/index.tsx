import { ToastActionCreators } from '@valenced/discord/actions'
import * as settings from '@valenced/discord/modules/settings'
import { lookupGeneratedIconComponent } from '@valenced/utils/discord'
import { setPluginApi } from './api'
import { attachOverlay } from './components/FloatingPill'
import { registerPluginsCommand } from './features/diagcommands'
import { startIconCache } from './features/diagicons'
import { setExportToast } from './features/diagreport'
import {
	beginSession,
	hydrate,
	markSessionClean,
	recordPluginError,
	startErrorLog,
} from './features/errlog'
import { startFluxLog, stopFluxLog } from './features/fluxlog'
import {
	applyInspectPrefs,
	findJsxRuntime,
	setInspectSaver,
	shutdown,
} from './features/inspect'
import { findTokens } from './features/tokens'
import { DevLabSettings } from './settings'
import { bindStorage, readStateWhenLoaded, saveInspectPrefs } from './storage'
import { TOOLS } from './tools'
import type { DevLabState } from './storage'

const SETTINGS_KEY = 'shin.devlab.settings'
const SECTION = 'VALENCED'
const SECTION_RETRY_MS = 20
const SECTION_MAX_ATTEMPTS = 500

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

const initialState: DevLabState = { enabled: true }

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

		beginSession()
		cleanup(startErrorLog())
		cleanup(markSessionClean)

		self.reportError = error =>
			recordPluginError(error, 'Reported plugin error')

		setExportToast((text, critical) => {
			try {
				ToastActionCreators.open('shin.devlab.errors', {
					text,
					variant: critical ? 'critical' : 'success',
				})
			} catch {}
		})

		try {
			cleanup(registerPluginsCommand())
		} catch (error) {
			recordPluginError(error, 'Failed to register /plugins')
		}

		cleanup(stopFluxLog)

		cleanup(findTokens())
		cleanup(findJsxRuntime())
		setInspectSaver(prefs => {
			void saveInspectPrefs(prefs)
		})
		attachOverlay(cleanup)
		cleanup(shutdown)
		void readStateWhenLoaded().then(state => {
			hydrate({ logs: state.logs, sessions: state.sessions })
			applyInspectPrefs(state.inspect)
			if (state.fluxEnabled) startFluxLog()
			try {
				startIconCache(state.iconCache)
			} catch (error) {
				recordPluginError(error, 'Icon cache check failed')
			}
		})

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
				} catch {}
			}
			settings.refreshSettings()
		})

		logger.log('DevLab started')
	},
})
