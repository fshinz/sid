import { Design } from '@valenced/discord/design'
import { React } from '@valenced/react'
import { applyNow, clearAll, pushConfig, readStatus } from './native'
import { normalizeGlass, PRESETS, readGlass, saveGlass } from './storage'
import type { GlassState } from './native'

const {
	Button,
	TableRadioGroup,
	TableRadioRow,
	TableRow,
	TableRowGroup,
	TableSwitchRow,
	Text,
} = Design

type Picker = 'material' | 'strength' | undefined

const PRESET_LABEL: Record<string, string> = {
	subtle: 'Subtle',
	balanced: 'Balanced',
	bold: 'Bold',
}

const BLUR_STEPS = [12, 18, 26, 34]
const REFRACT_STEPS = [22, 46, 76, 110]
const DISPERSION_STEPS = [0, 0.06, 0.1, 0.16, 0.22]
const RIM_STEPS = [0.6, 1, 1.4, 1.8]
const DIM_STEPS = [0.1, 0.18, 0.26, 0.34]

function cycle(steps: number[], current: number): number {
	const index = steps.findIndex(step => Math.abs(step - current) < 0.001)
	return steps[(index + 1) % steps.length] ?? steps[0]
}

function pathLabel(path: string): string {
	if (path === 'shader') return 'Shader lens'
	if (path === 'blur') return 'Blurred, no refraction'
	return 'Translucent only'
}

export function GlassSettings() {
	const [state, setState] = React.useState<GlassState>(() => readGlass())
	const [picker, setPicker] = React.useState<Picker>(undefined)
	const [status, setStatus] = React.useState<Awaited<
		ReturnType<typeof readStatus>
	> | null>(null)

	React.useEffect(() => {
		void readStatus()
			.then(setStatus)
			.catch(() => setStatus(null))
	}, [])

	const apply = (patch: Partial<GlassState>) => {
		const next = normalizeGlass({ ...state, ...patch })
		setState(next)
		void saveGlass(next)
		void pushConfig(next)
			.then(() => readStatus())
			.then(setStatus)
			.catch(() => {})
	}

	const applyPreset = (preset: string) => {
		apply({ preset, ...(PRESETS[preset] ?? {}) })
		setPicker(undefined)
	}

	const title = state.enabled
		? `Glass on ${[state.top && 'top bar', state.bottom && 'bottom bar', state.input && 'chat input', state.floating && 'floating bars'].filter(Boolean).join(', ') || 'nothing yet'}`
		: 'Glass effects are off'

	return (
		<>
			<TableRowGroup
				title="Liquid Glass"
				description="Real glass over the app: blurred backdrops, refraction at the edges, light-driven highlights."
			>
				<TableSwitchRow
					label="Glass effects"
					subLabel={title}
					value={state.enabled}
					onValueChange={value => apply({ enabled: value })}
				/>
			</TableRowGroup>

			<TableRowGroup title="Glass surfaces">
				<TableSwitchRow
					label="Top bar"
					subLabel="The header strip at the top of the screen."
					value={state.top}
					onValueChange={value => apply({ top: value })}
				/>
				<TableSwitchRow
					label="Bottom bar"
					subLabel="The navigation strip at the bottom."
					value={state.bottom}
					onValueChange={value => apply({ bottom: value })}
				/>
				<TableSwitchRow
					label="Chat input"
					subLabel="The message composer above the bottom bar."
					value={state.input}
					onValueChange={value => apply({ input: value })}
				/>
				<TableSwitchRow
					label="Floating bars"
					subLabel="Pills and floating bars over the content."
					value={state.floating}
					onValueChange={value => apply({ floating: value })}
				/>
			</TableRowGroup>

			<TableRowGroup title="Material">
				<TableRow
					label="Material"
					subLabel={
						state.material === 'clear'
							? 'Clear: keeps more of the backdrop, adds a dimming layer.'
							: 'Regular: readability first, adapts to what is behind the glass.'
					}
					subLabelLineClamp={2}
					trailing={
						<TableRow.TrailingText
							text={state.material === 'clear' ? 'Clear' : 'Regular'}
						/>
					}
					onPress={() =>
						setPicker(picker === 'material' ? undefined : 'material')
					}
				/>
				{picker === 'material' && (
					<TableRadioGroup
						defaultValue={state.material}
						onChange={(value: string) => {
							apply({ material: value === 'clear' ? 'clear' : 'regular' })
							setPicker(undefined)
						}}
					>
						<TableRadioRow
							label="Regular"
							subLabel="Adaptive tint keeps text readable over any backdrop."
							value="regular"
						/>
						<TableRadioRow
							label="Clear"
							subLabel="Higher clarity with a dimming layer instead of tint."
							value="clear"
						/>
					</TableRadioGroup>
				)}
			</TableRowGroup>

			<TableRowGroup title="Strength">
				<TableRow
					label="Preset"
					subLabel="Sets blur, refraction, dispersion and edge light together."
					trailing={
						<TableRow.TrailingText
							text={PRESET_LABEL[state.preset] ?? 'Custom'}
						/>
					}
					onPress={() =>
						setPicker(picker === 'strength' ? undefined : 'strength')
					}
				/>
				{picker === 'strength' && (
					<TableRadioGroup
						defaultValue={state.preset}
						onChange={(value: string) => {
							applyPreset(value)
						}}
					>
						<TableRadioRow label="Subtle" value="subtle" />
						<TableRadioRow label="Balanced" value="balanced" />
						<TableRadioRow label="Bold" value="bold" />
					</TableRadioGroup>
				)}
				<TableRow
					label="Backdrop blur"
					trailing={<TableRow.TrailingText text={`${state.blurDp}dp`} />}
					onPress={() =>
						apply({ blurDp: cycle(BLUR_STEPS, state.blurDp), preset: 'custom' })
					}
				/>
				<TableRow
					label="Refraction"
					subLabel="How hard the edge bends the backdrop inward."
					trailing={<TableRow.TrailingText text={`${state.refractDp}dp`} />}
					onPress={() =>
						apply({
							refractDp: cycle(REFRACT_STEPS, state.refractDp),
							preset: 'custom',
						})
					}
				/>
				<TableRow
					label="Dispersion"
					subLabel="Spectral fringes along the bent edge."
					trailing={
						<TableRow.TrailingText text={state.dispersion.toFixed(2)} />
					}
					onPress={() =>
						apply({
							dispersion: cycle(DISPERSION_STEPS, state.dispersion),
							preset: 'custom',
						})
					}
				/>
				<TableRow
					label="Edge light"
					subLabel="The twin bright lines along lit edges."
					trailing={<TableRow.TrailingText text={state.rim.toFixed(1)} />}
					onPress={() =>
						apply({ rim: cycle(RIM_STEPS, state.rim), preset: 'custom' })
					}
				/>
				<TableRow
					label="Dimming"
					subLabel="Darkens the glass body over bright backdrops."
					trailing={
						<TableRow.TrailingText text={`${Math.round(state.dim * 100)}%`} />
					}
					onPress={() =>
						apply({ dim: cycle(DIM_STEPS, state.dim), preset: 'custom' })
					}
				/>
			</TableRowGroup>

			<TableRowGroup title="Light">
				<TableSwitchRow
					label="Tilt light"
					subLabel="Edges light up from the tilt of the device instead of a fixed top-left source."
					value={state.sensor}
					onValueChange={value => apply({ sensor: value })}
				/>
			</TableRowGroup>

			<TableRowGroup title="Status">
				<TableRow
					label="Render path"
					trailing={
						<TableRow.TrailingText
							text={status ? pathLabel(status.path) : 'Checking…'}
						/>
					}
				/>
				<TableRow
					label="Glassed surfaces"
					trailing={
						<TableRow.TrailingText
							text={status ? String(status.applied.length) : '…'}
						/>
					}
				/>
				<TableRow
					label="Re-scan surfaces"
					subLabel="Finds bars and pills again after the layout changes."
					arrow
					onPress={() => {
						void applyNow()
							.then(() => readStatus())
							.then(setStatus)
							.catch(() => {})
					}}
				/>
				<Button
					text="Remove glass"
					variant="destructive"
					onPress={() => {
						void clearAll()
							.then(() => readStatus())
							.then(setStatus)
							.catch(() => {})
					}}
				/>
			</TableRowGroup>

			<Text variant="text-sm/normal" color="text-muted">
				Glass reads what is drawn behind each surface. It looks best over a
				wallpaper theme or busy content. Surfaces are found by shape and
				position, so unusual layouts may need a re-scan.
			</Text>
		</>
	)
}
