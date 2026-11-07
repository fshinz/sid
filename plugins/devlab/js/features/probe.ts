import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { inspectState, setShowButton } from './inspect'

const CANDIDATES = [
	'AppContainer',
	'ToastContainer',
	'AlertContainer',
	'ModalContainer',
	'ActionSheetContainer',
	'RootNavigator',
	'DiscordApp',
	'App',
	'AppRoot',
	'NavigationContainer',
	'SafeAreaProvider',
	'GestureHandlerRootView',
	'FullWindowOverlay',
	'Portal',
	'PortalHost',
	'LayerContainer',
]

/** Reports which candidate component names exist as modules. Results land in the status map. */
export function probeMounts() {
	const found: string[] = []
	inspectState.status.probe = 'running…'
	// setShowButton re-emits the current value; used only to refresh the settings page.
	setShowButton(inspectState.showButton)

	const unsubs = CANDIDATES.map(name =>
		getModules(
			withName<any>(name),
			(ns: any) => {
				const kind =
					typeof ns?.default === 'function'
						? ns.default.prototype?.render
							? 'class'
							: 'fn'
						: 'other'
				found.push(`${name} (${kind})`)
				inspectState.status.probe = `found: ${found.join(', ')}`
				setShowButton(inspectState.showButton)
			},
			{ returnNamespace: true },
		),
	)

	setTimeout(() => {
		for (const u of unsubs) {
			try {
				u()
			} catch {
				// Ignore.
			}
		}
		if (!found.length) {
			inspectState.status.probe = 'found: none of the candidates'
		}
		setShowButton(inspectState.showButton)
	}, 4000)
}
