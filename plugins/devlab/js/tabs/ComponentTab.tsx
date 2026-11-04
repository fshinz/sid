import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { SearchField } from '../components/SearchField'
import { TabScreen } from '../components/TabScreen'
import { getModuleEntries } from '../registry'

const { Button, TableRow, TableRowGroup } = Design

const MAX_RESULTS = 150

type ComponentInfo = {
	name: string
	moduleId: string
	propTypes?: string[]
	isForwardRef: boolean
	isMemo: boolean
}

function wrapperKind(value: any) {
	const tag = value?.$$typeof ? String(value.$$typeof) : ''
	return { isMemo: tag.includes('memo'), isForwardRef: tag.includes('forward') }
}

function looksLikeComponent(value: any) {
	if (typeof value === 'function') {
		// Component names start with an uppercase letter.
		const first = value.name?.[0]
		return (
			!!first && first === first.toUpperCase() && first !== first.toLowerCase()
		)
	}
	if (!value || typeof value !== 'object') return false

	const { isMemo, isForwardRef } = wrapperKind(value)
	return isMemo || isForwardRef
}

function scanComponents(filter: string) {
	const needle = filter.toLowerCase()
	const results: ComponentInfo[] = []

	for (const [moduleId, exports] of getModuleEntries()) {
		if (results.length >= MAX_RESULTS) break
		if (!exports || typeof exports !== 'object') continue

		try {
			for (const name of Object.keys(exports)) {
				if (results.length >= MAX_RESULTS) break
				if (filter && !name.toLowerCase().includes(needle)) continue

				const value = exports[name]
				if (!looksLikeComponent(value)) continue

				const { isMemo, isForwardRef } = wrapperKind(value)
				const inner = isMemo ? value.type : isForwardRef ? value.render : value
				const propTypes = inner?.propTypes ? Object.keys(inner.propTypes) : []

				results.push({
					name,
					moduleId,
					propTypes: propTypes.length > 0 ? propTypes : undefined,
					isMemo,
					isForwardRef,
				})
			}
		} catch {
			// Skip modules whose exports throw on access.
		}
	}

	return results
}

function describeKind({ isMemo, isForwardRef }: ComponentInfo) {
	return isMemo ? 'React.memo' : isForwardRef ? 'forwardRef' : 'Component'
}

export function ComponentTab() {
	const [filter, setFilter] = React.useState('')
	const [components, setComponents] = React.useState<ComponentInfo[]>([])
	const [scanned, setScanned] = React.useState(false)
	const [expandedKey, setExpandedKey] = React.useState<string | null>(null)

	const handleScan = () => {
		setComponents(scanComponents(filter))
		setScanned(true)
		setExpandedKey(null)
	}

	const renderItem = (item: ComponentInfo) => {
		const key = `${item.moduleId}-${item.name}`
		const expanded = expandedKey === key
		const props = item.propTypes?.join(', ')

		const handlePress = () => {
			if (!expanded) return setExpandedKey(key)

			Clipboard.setString(
				`${item.name} (module ${item.moduleId})${props ? `\nProps: ${props}` : ''}`,
			)
			setExpandedKey(null)
		}

		return (
			<TableRow
				key={key}
				label={item.name}
				subLabel={
					expanded
						? [
								`Module: ${item.moduleId}`,
								describeKind(item),
								props && `Props: ${props}`,
							]
								.filter(Boolean)
								.join('\n')
						: `#${item.moduleId} · ${describeKind(item)}`
				}
				subLabelLineClamp={expanded ? 10 : 1}
				trailing={expanded ? <TableRow.TrailingText text="Copy" /> : null}
				onPress={handlePress}
			/>
		)
	}

	return (
		<TabScreen>
			<SearchField
				value={filter}
				onChange={setFilter}
				placeholder="Filter by component name (optional)"
			/>
			<Button
				text="Scan Metro modules"
				variant="primary"
				onPress={handleScan}
			/>

			{scanned && (
				<TableRowGroup title={`Results (${components.length})`}>
					{components.length === 0 ? (
						<TableRow
							label={
								filter
									? `No components matched "${filter}".`
									: 'No React components found.'
							}
						/>
					) : (
						components.map(renderItem)
					)}
				</TableRowGroup>
			)}
		</TabScreen>
	)
}
