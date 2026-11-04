import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { SearchField } from '../components/SearchField'
import { TabScreen } from '../components/TabScreen'
import { getModuleEntries } from '../registry'

const { Button, Card, Stack, TableRow, TableRowGroup, Text } = Design

const MAX_RESULTS = 60
const PREVIEW_KEYS = 6
const MIN_QUERY_LENGTH = 2

type ModuleMatch = { id: string; keys: string[]; exports: any }

function searchModules(query: string) {
	const needle = query.toLowerCase()
	const results: ModuleMatch[] = []

	for (const [id, exports] of getModuleEntries()) {
		if (results.length >= MAX_RESULTS) break
		if (!exports || typeof exports !== 'object') continue

		try {
			const keys = Object.keys(exports)
			if (
				id === query ||
				keys.some(key => key.toLowerCase().includes(needle))
			) {
				results.push({ id, keys, exports })
			}
		} catch {
			// Exotic exports can throw on key access.
		}
	}

	return results
}

function formatDetail({ id, keys, exports }: ModuleMatch) {
	const lines = keys.map(key => {
		try {
			return ` • ${key}: <${typeof exports[key]}>`
		} catch {
			return ` • ${key}: <unreadable>`
		}
	})
	return `Module ID: ${id}\nTotal Keys: ${keys.length}\n\nKeys & Types:\n${lines.join('\n')}`
}

function ModuleDetail({
	module,
	onBack,
}: {
	module: ModuleMatch
	onBack: () => void
}) {
	const [copied, setCopied] = React.useState(false)
	const detail = React.useMemo(() => formatDetail(module), [module])

	const handleCopy = () => {
		Clipboard.setString(detail)
		setCopied(true)
		setTimeout(() => setCopied(false), 1500)
	}

	return (
		<TabScreen>
			<Stack direction="horizontal" spacing={8}>
				<Button text="Back" variant="secondary" grow onPress={onBack} />
				<Button
					text={copied ? 'Copied' : 'Copy'}
					variant="primary"
					grow
					onPress={handleCopy}
				/>
			</Stack>
			<Card>
				<Text
					selectable
					variant="text-sm/normal"
					style={{ fontFamily: 'monospace' }}
				>
					{detail}
				</Text>
			</Card>
		</TabScreen>
	)
}

export function MetroTab() {
	const [query, setQuery] = React.useState('')
	const [selected, setSelected] = React.useState<ModuleMatch | null>(null)

	const totalModules = React.useMemo(() => getModuleEntries().length, [])
	const searching = query.length >= MIN_QUERY_LENGTH
	const results = React.useMemo(
		() => (searching ? searchModules(query) : []),
		[query, searching],
	)

	if (selected) {
		return <ModuleDetail module={selected} onBack={() => setSelected(null)} />
	}

	return (
		<TabScreen>
			<TableRowGroup title="Metro Explorer">
				<TableRow
					label="Initialized modules"
					trailing={
						<TableRow.TrailingText text={totalModules.toLocaleString()} />
					}
				/>
			</TableRowGroup>

			<SearchField
				value={query}
				onChange={setQuery}
				placeholder="Search export key or paste module ID"
			/>

			<TableRowGroup
				title={searching ? `Results (${results.length})` : 'Results'}
			>
				{!searching ? (
					<TableRow label="Type at least 2 characters to search." />
				) : results.length === 0 ? (
					<TableRow label="No modules matched." />
				) : (
					results.map(match => {
						const hidden = match.keys.length - PREVIEW_KEYS
						return (
							<TableRow
								key={match.id}
								label={`ID ${match.id}`}
								subLabel={
									match.keys.slice(0, PREVIEW_KEYS).join(', ') +
									(hidden > 0 ? ` … +${hidden}` : '')
								}
								subLabelLineClamp={3}
								trailing={
									<TableRow.TrailingText text={`${match.keys.length} keys`} />
								}
								arrow
								onPress={() => setSelected(match)}
							/>
						)
					})
				)}
			</TableRowGroup>
		</TabScreen>
	)
}
