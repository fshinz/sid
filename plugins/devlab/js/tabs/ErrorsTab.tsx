import { Design } from '@valenced/discord/design'
import { Clipboard } from '@valenced/externals/react-native-clipboard'
import { React } from '@valenced/react'
import { TabScreen } from '../components/TabScreen'
import { clearErrors, readState } from '../storage'
import type { DiagnosticEntry } from '../storage'

const { Button, Stack, TableRow, TableRowGroup } = Design

function formatTime(timestamp: number) {
	return new Date(timestamp).toLocaleString()
}

function ErrorGroup({ entry }: { entry: DiagnosticEntry }) {
	const [expanded, setExpanded] = React.useState(false)

	return (
		<TableRowGroup
			title={`${entry.level.toUpperCase()} — ${formatTime(entry.timestamp)}`}
		>
			<TableRow
				label={entry.title}
				subLabel={entry.message}
				subLabelLineClamp={expanded ? 20 : 3}
				onPress={() => setExpanded(value => !value)}
			/>
			{expanded && entry.stack && (
				<TableRow
					label="Stack trace"
					subLabel={entry.stack}
					subLabelLineClamp={20}
					trailing={<TableRow.TrailingText text="Copy" />}
					onPress={() => Clipboard.setString(entry.stack ?? '')}
				/>
			)}
		</TableRowGroup>
	)
}

export function ErrorsTab() {
	const [, rerender] = React.useReducer((count: number) => count + 1, 0)
	const { entries, enabled } = readState()

	const handleClear = async () => {
		await clearErrors()
		rerender()
	}

	const handleCopyAll = () => {
		const text = entries
			.map(
				entry =>
					`[${formatTime(entry.timestamp)}] ${entry.title}\n${entry.message}\n${entry.stack ?? ''}`,
			)
			.join('\n\n---\n\n')
		Clipboard.setString(text || 'No errors.')
	}

	return (
		<TabScreen>
			<TableRowGroup title="Summary">
				<TableRow
					label="Recorded errors"
					trailing={<TableRow.TrailingText text={String(entries.length)} />}
				/>
				<TableRow
					label="Monitoring"
					trailing={
						<TableRow.TrailingText text={enabled ? 'Active' : 'Paused'} />
					}
				/>
			</TableRowGroup>

			<Stack direction="horizontal" spacing={8}>
				<Button
					text="Copy all"
					variant="secondary"
					grow
					disabled={entries.length === 0}
					onPress={handleCopyAll}
				/>
				<Button
					text="Clear"
					variant="destructive"
					grow
					disabled={entries.length === 0}
					onPress={handleClear}
				/>
			</Stack>

			{entries.length === 0 ? (
				<TableRowGroup title="Errors">
					<TableRow label="No errors recorded." />
				</TableRowGroup>
			) : (
				entries.map(entry => <ErrorGroup key={entry.id} entry={entry} />)
			)}
		</TabScreen>
	)
}
