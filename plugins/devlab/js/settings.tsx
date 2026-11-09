import { Design } from '@valenced/discord/design'
import { React, ReactNative } from '@valenced/react'
import { OverlayWidgets } from './components/FloatingPill'
import { DevLabMarker } from './components/HighlightHost'
import { ColorsTab } from './tabs/ColorsTab'
import { ComponentTab } from './tabs/ComponentTab'
import { DebuggingTab } from './tabs/DebuggingTab'
import { MetroTab } from './tabs/MetroTab'
import { ToolsTab } from './tabs/ToolsTab'

const TABS = [
	{ id: 'tools', label: 'Tools', Tab: ToolsTab },
	{ id: 'metro', label: 'Metro', Tab: MetroTab },
	{ id: 'colors', label: 'Colors', Tab: ColorsTab },
	{ id: 'components', label: 'Components', Tab: ComponentTab },
	{ id: 'debugging', label: 'Debugging', Tab: DebuggingTab },
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
		<DevLabMarker>
			<View style={{ flex: 1 }}>
				{}
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
			{}
			<OverlayWidgets mount="devlab" />
		</DevLabMarker>
	)
}
