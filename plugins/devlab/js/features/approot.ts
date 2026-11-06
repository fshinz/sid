import { lookupModules } from '@valenced/modules/finders'
import { withName } from '@valenced/modules/finders/filters'
import { after } from '@valenced/patcher'
import { React } from '@valenced/react'
import { HighlightHost } from '../components/HighlightHost'

// Root component names used across Discord builds. The first match wins.
const ROOT_NAMES = ['App', 'AppContainer', 'Root']

function wrapResult(result: any) {
	if (result === null || result === undefined) return result
	return React.createElement(HighlightHost, null, result)
}

/**
 * Best-effort mount of the highlight overlay at the app root, so highlights and
 * pick mode stay visible on every screen. Falls back to the DevLab screen's own
 * host when no root component can be found.
 */
export function mountOverlayHost(
	cleanup: (...undo: Array<() => void>) => void,
) {
	for (const name of ROOT_NAMES) {
		for (const [namespace] of lookupModules(withName(name), {
			returnNamespace: true,
		})) {
			if (!namespace || typeof namespace !== 'object') continue

			for (const key of Object.keys(namespace)) {
				const value = (namespace as Record<string, any>)[key]
				if (typeof value !== 'function' || value.name !== name) continue

				try {
					// Class components are patched on their render method so the
					// element tree wraps correctly; function components on the export.
					const target =
						value.prototype && typeof value.prototype.render === 'function'
							? value.prototype
							: (namespace as Record<string, any>)
					const targetKey = target === value.prototype ? 'render' : (key as any)

					const unpatch = after(target, targetKey, (result: any) =>
						wrapResult(result),
					)
					cleanup(unpatch)
					return true
				} catch {
					// Try the next candidate.
				}
			}
		}
	}
	return false
}
