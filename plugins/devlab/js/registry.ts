import { lookupModules } from '@valenced/modules/finders'
import { createFilterGenerator } from '@valenced/modules/finders/filters'

const anyModule = createFilterGenerator<[]>(
	() => true,
	() => 'devlab.any-module',
)

// Only already-initialized modules, so scanning never side-loads anything.
export function getModuleEntries(): [string, any][] {
	const entries: [string, any][] = []
	for (const [exports, id] of lookupModules(anyModule(), {
		initialize: false,
		returnNamespace: true,
	})) {
		if (exports) entries.push([String(id), exports])
	}
	return entries
}
