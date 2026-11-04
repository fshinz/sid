import { Design } from '@valenced/discord/design'
import { React, ReactNative } from '@valenced/react'
import { ComponentTab } from './tabs/ComponentTab'
import { ErrorsTab } from './tabs/ErrorsTab'
import { MetroTab } from './tabs/MetroTab'
import { ToolsTab } from './tabs/ToolsTab'

const TABS = [
	{ id: 'tools', label: 'Tools', Tab: ToolsTab },
	{ id: 'metro', label: 'Metro', Tab: MetroTab },
	{ id: 'components', label: 'Components', Tab: ComponentTab },
	{ id: 'errors', label: 'Errors', Tab: ErrorsTab },
]

export function DevLabSettings() {
	const { SegmentedControl, SegmentedControlPages, useSegmentedControlState } =
		Design
	const { View, useWindowDimensions } = ReactNative
	const { width } = useWindowDimensions()

	const items = React.useMemo(
		() => TABS.map(({ id, label, Tab }) => ({ id, label, page: <Tab /> })),
		[],
	)
	const state = useSegmentedControlState({ items, pageWidth: width })

	return (
		<View style={{ flex: 1 }}>
			{/* SegmentedControl is a ScrollView, which grows by default and would fill the column. */}
			<View
				style={{
					flexGrow: 0,
					flexShrink: 0,
					paddingHorizontal: 16,
					paddingVertical: 12,
				}}
			>
				<SegmentedControl state={state} />
			</View>
			<SegmentedControlPages state={state} style={{ flex: 1 }} />
		</View>
	)
}
