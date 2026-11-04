import { Design } from '@valenced/discord/design'
import { React } from '@valenced/react'
import { TabScreen } from '../components/TabScreen'
import { checkAllPlugins } from '../features/compatibility'
import { recordError } from '../storage'
import type { CompatibilityReport } from '../features/compatibility'

const { Button, TableRow, TableRowGroup } = Design

function ReportGroup({ report }: { report: CompatibilityReport }) {
	return (
		<TableRowGroup title={report.pluginName} description={report.pluginId}>
			{report.problems.map(problem => (
				<TableRow
					key={`${problem.id}-${problem.type}`}
					label={problem.id}
					subLabel={problem.message}
					subLabelLineClamp={3}
				/>
			))}
		</TableRowGroup>
	)
}

export function CompatibilityTab() {
	const [reports, setReports] = React.useState<CompatibilityReport[]>([])
	const [checking, setChecking] = React.useState(false)
	const [done, setDone] = React.useState(false)

	const runCheck = async () => {
		setChecking(true)
		try {
			setReports(await checkAllPlugins())
		} catch (error) {
			setReports([])
			recordError(error, 'Compatibility check failed')
		} finally {
			setChecking(false)
			setDone(true)
		}
	}

	const incompatible = reports.filter(report => !report.compatible)
	const compatible = reports.filter(report => report.compatible)

	return (
		<TabScreen>
			<TableRowGroup
				title="API Compatibility Checker"
				description="Checks installed plugins for missing or incompatible API dependencies."
			>
				<TableRow
					label="Status"
					trailing={
						<TableRow.TrailingText
							text={
								done
									? `${incompatible.length} incompatible, ${compatible.length} compatible`
									: 'Not checked'
							}
						/>
					}
				/>
			</TableRowGroup>

			<Button
				text={checking ? 'Checking…' : 'Run check'}
				variant="primary"
				loading={checking}
				disabled={checking}
				onPress={runCheck}
			/>

			{incompatible.map(report => (
				<ReportGroup key={report.pluginId} report={report} />
			))}

			{done && compatible.length > 0 && (
				<TableRowGroup title="Compatible plugins">
					{compatible.map(report => (
						<TableRow
							key={report.pluginId}
							label={report.pluginName}
							subLabel={report.pluginId}
						/>
					))}
				</TableRowGroup>
			)}
		</TabScreen>
	)
}
