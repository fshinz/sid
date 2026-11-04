import { Page } from '@valenced/components'
import { ReactNative } from '@valenced/react'
import type { React } from '@valenced/react'

type TabScreenProps = {
	children: React.ReactNode
}

export function TabScreen({ children }: TabScreenProps) {
	const { ScrollView } = ReactNative

	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			contentContainerStyle={{ paddingBottom: 32 }}
		>
			<Page spacing={16}>{children}</Page>
		</ScrollView>
	)
}
