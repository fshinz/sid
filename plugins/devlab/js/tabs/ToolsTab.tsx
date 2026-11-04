import { Design } from '@valenced/discord/design'
import { ReactNavigationNative } from '@valenced/externals/react-navigation'
import { TabScreen } from '../components/TabScreen'
import { TOOLS } from '../tools'

const { TableRow, TableRowGroup } = Design

export function ToolsTab() {
	const navigation = ReactNavigationNative.useNavigation()

	return (
		<TabScreen>
			<TableRowGroup title="Tools">
				{TOOLS.map(tool => (
					<TableRow
						key={tool.route}
						label={tool.title}
						subLabel={tool.description}
						arrow
						onPress={() => navigation.navigate(tool.route)}
					/>
				))}
			</TableRowGroup>
		</TabScreen>
	)
}
