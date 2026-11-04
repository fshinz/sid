import { SearchInput } from '@valenced/components'

type SearchFieldProps = Pick<
	Parameters<typeof SearchInput>[0],
	'value' | 'onChange' | 'placeholder'
>

// TextInputProps doesn't declare these, but the input forwards them to the native field.
const nativeProps = { autoCapitalize: 'none', autoCorrect: false }

export function SearchField(props: SearchFieldProps) {
	return <SearchInput isClearable {...nativeProps} {...props} />
}
