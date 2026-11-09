import { SearchInput } from '@valenced/components'

type SearchFieldProps = Pick<
	Parameters<typeof SearchInput>[0],
	'value' | 'onChange' | 'placeholder'
>

const nativeProps = { autoCapitalize: 'none', autoCorrect: false }

export function SearchField(props: SearchFieldProps) {
	return <SearchInput isClearable {...nativeProps} {...props} />
}
