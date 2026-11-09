import { getModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { inspectState, notifyChange } from './inspect'

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

export function probeMounts() {
	const found: string[] = []
	inspectState.status.probe = 'running…'
	notifyChange()

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
				notifyChange()
			},
			{ returnNamespace: true },
		),
	)

	setTimeout(() => {
		for (const u of unsubs) {
			try {
				u()
			} catch {}
		}
		if (!found.length) {
			inspectState.status.probe = 'found: none of the candidates'
		}
		notifyChange()
	}, 4000)
}
