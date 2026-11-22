/**
 * Liquid Glass — a glass theme pack for Valenced.
 *
 * Valenced themes are plugins. This one registers four color themes that all
 * share the same idea: a wallpaper sits behind the app, and every panel is a
 * translucent, lightly tinted sheet with a hairline light edge, so the
 * wallpaper reads through the UI the way frosted glass does.
 *
 * Two things make the glass work, and neither is CSS:
 *
 * 1. `background` — Valenced draws the image behind the main screens and chat,
 *    blurs it, and turns the big surfaces (server list, channel list, panels,
 *    floating bars) translucent by `dimming`. That translucency is applied by
 *    the Themes API itself, so the theme only has to pick a good backdrop.
 * 2. The semantic tokens below — cool, low-chroma surfaces with a light
 *    border token give the sheets their edge; hover/selected states are white
 *    alpha layers, not opaque greys, so they light up like glass instead of
 *    painting over it.
 *
 * Values are `#RRGGBB`, deliberately not `#RRGGBBAA`, on the surfaces: over a
 * background the API keeps Discord's own translucency for those tokens and
 * appends it to the color. Hard-coding alpha there would fight the dimming
 * slider the user controls on the Background screen.
 */

/// <reference types="@valenced/themes-api" />
import type { ThemeColors, ThemeDefinition } from '@valenced/themes-api/types'

/** One glass recipe: every surface and ink color a base theme needs. */
interface Palette {
	/** Main background behind everything else. */
	base: string
	/** Panels and cards sitting on the base. */
	panel: string
	/** A raised panel, one step lighter. */
	panelAlt: string
	/** Recessed rails: server list, channel list. */
	deep: string
	/** Sheets that float: menus, sheets, dialogs. */
	floating: string
	/** Text input. */
	field: string
	text: string
	muted: string
	link: string
	/** Hairline rim. `#RRGGBBAA` so it reads as an edge, not a border. */
	border: string
	borderStrong: string
	/** White (or ink) alpha state layers. */
	hover: string
	active: string
	selected: string
	accent: string
	messageHover: string
}

/** Cool brand ramp shared by every glass theme. */
const raw: Record<string, string> = {
	BRAND_360: '#8CC0FF',
	BRAND_400: '#78B2FF',
	BRAND_460: '#63A4FF',
	BRAND_500: '#5B9DFF',
	BRAND_560: '#4A87E6',
	BRAND_600: '#3C74C9',
}

/**
 * The semantic token map for one palette.
 *
 * Only Discord's semantic names go here. A name Valenced doesn't know is
 * inert, so the list is safe to keep broad across Discord versions.
 */
function semanticColors(p: Palette): Record<string, string> {
	return {
		// Base surfaces. These are the ones the API makes translucent over a
		// background, so they carry the glass.
		BACKGROUND_BASE_LOWER: p.base,
		BACKGROUND_BASE_LOW: p.panel,
		BACKGROUND_BASE_LOWEST: p.deep,
		CHANNEL_BACKGROUND_DEFAULT: p.panel,
		PANEL_BG: p.base,

		// Classic surfaces, still used all over the app.
		BACKGROUND_PRIMARY: p.base,
		BACKGROUND_SECONDARY: p.panel,
		BACKGROUND_SECONDARY_ALT: p.panelAlt,
		BACKGROUND_TERTIARY: p.deep,
		BACKGROUND_FLOATING: p.floating,
		BACKGROUND_NESTED_FLOATING: p.panelAlt,
		BACKGROUND_MOBILE_PRIMARY: p.panel,
		BACKGROUND_MOBILE_SECONDARY: p.base,
		MOBILE_FLOATINGBAR_BACKGROUND: p.panel,
		MOBILE_FLOATINGBAR_BACKGROUND_HIGHER: p.floating,
		CHANNELTEXTAREA_BACKGROUND: p.field,
		BACKGROUND_ACCENT: p.panelAlt,

		// State layers: light, never opaque.
		BACKGROUND_MODIFIER_HOVER: p.hover,
		BACKGROUND_MODIFIER_ACTIVE: p.active,
		BACKGROUND_MODIFIER_SELECTED: p.selected,
		BACKGROUND_MODIFIER_ACCENT: p.accent,
		BACKGROUND_MESSAGE_HOVER: p.messageHover,

		// Ink.
		HEADER_PRIMARY: p.text,
		HEADER_SECONDARY: p.muted,
		TEXT_NORMAL: p.text,
		TEXT_DEFAULT: p.text,
		TEXT_MUTED: p.muted,
		TEXT_LINK: p.link,
		INTERACTIVE_NORMAL: p.muted,
		INTERACTIVE_HOVER: p.text,
		INTERACTIVE_ACTIVE: p.text,
		INTERACTIVE_MUTED: p.muted,
		CHANNEL_ICON: p.muted,
		CHANNELS_DEFAULT: p.muted,

		// The rim. Two values: subtle separators, and the brighter edge on
		// floating sheets, which is what sells the glass.
		BORDER_SUBTLE: p.border,
		BORDER_STRONG: p.borderStrong,
	}
}

// ---------------------------------------------------------------------------
// Palettes
// ---------------------------------------------------------------------------

/** Frosted: cool blue-grey glass for dark bases. */
const frostDark: Palette = {
	base: '#0E1118',
	panel: '#151A24',
	panelAlt: '#1A2029',
	deep: '#0A0D13',
	floating: '#1E242F',
	field: '#1B212B',
	text: '#E9EEF7',
	muted: '#9AA4B5',
	link: '#79B8FF',
	border: '#FFFFFF24',
	borderStrong: '#FFFFFF3D',
	hover: '#FFFFFF14',
	active: '#FFFFFF1F',
	selected: '#FFFFFF29',
	accent: '#FFFFFF1A',
	messageHover: '#FFFFFF0A',
}

/** Frosted: the same recipe over a light base, with ink instead of white. */
const frostLight: Palette = {
	base: '#FBFCFE',
	panel: '#F4F7FC',
	panelAlt: '#EAEFF8',
	deep: '#E8EDF6',
	floating: '#FFFFFF',
	field: '#EDF1F8',
	text: '#10141C',
	muted: '#5B6474',
	link: '#2563EB',
	border: '#0B12201F',
	borderStrong: '#0B122033',
	hover: '#0B12200F',
	active: '#0B122014',
	selected: '#0B12201F',
	accent: '#0B122016',
	messageHover: '#0B122008',
}

/** Midnight: smoked, near-black glass. */
const midnightDark: Palette = {
	base: '#07080B',
	panel: '#0D0F14',
	panelAlt: '#11141A',
	deep: '#050609',
	floating: '#151922',
	field: '#10131A',
	text: '#EDF1F8',
	muted: '#8E97A6',
	link: '#8CC4FF',
	border: '#FFFFFF1F',
	borderStrong: '#FFFFFF33',
	hover: '#FFFFFF10',
	active: '#FFFFFF1A',
	selected: '#FFFFFF24',
	accent: '#FFFFFF14',
	messageHover: '#FFFFFF08',
}

/** Aurora: violet-tinted glass over the aurora backdrop. */
const auroraDark: Palette = {
	base: '#0B0814',
	panel: '#141022',
	panelAlt: '#1A1530',
	deep: '#080610',
	floating: '#1F1938',
	field: '#191428',
	text: '#F1ECFF',
	muted: '#A79BC4',
	link: '#9AD4FF',
	border: '#C9B8FF33',
	borderStrong: '#C9B8FF4D',
	hover: '#FFFFFF14',
	active: '#C9B8FF26',
	selected: '#C9B8FF33',
	accent: '#C9B8FF1F',
	messageHover: '#FFFFFF0A',
}

/** Aurora, light bases. */
const auroraLight: Palette = {
	base: '#FAF7FF',
	panel: '#F3EDFD',
	panelAlt: '#EAE1F9',
	deep: '#EEE6FB',
	floating: '#FFFFFF',
	field: '#F0E9FB',
	text: '#171226',
	muted: '#655A7A',
	link: '#6D4DE0',
	border: '#2A1B4D1F',
	borderStrong: '#2A1B4D33',
	hover: '#2A1B4D0F',
	active: '#2A1B4D14',
	selected: '#2A1B4D1F',
	accent: '#2A1B4D16',
	messageHover: '#2A1B4D08',
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/** Builds a theme that uses `dark` for dark/darker/midnight and `light` for light. */
function glassTheme(
	name: string,
	description: string,
	dark: Palette,
	light: Palette,
	background: ThemeDefinition['background'],
): ThemeDefinition {
	// Resolved once: getColors must stay cheap and deterministic.
	const semantic: NonNullable<ThemeColors['semantic']> = {
		dark: semanticColors(dark),
		darker: semanticColors(dark),
		midnight: semanticColors(dark),
		light: semanticColors(light),
	}

	return {
		name,
		description,
		getColors: () => ({ semantic, raw }),
		background,
	}
}

export default plugin({
	preInit({ themes }) {
		themes.registerGroup('liquid-glass', {
			name: 'Liquid Glass',
			description: 'Translucent panels with a light edge, over a soft backdrop.',
		})

		themes.registerTheme(
			'liquid-glass',
			'frosted',
			glassTheme(
				'Glass · Frosted',
				'Cool frosted sheets over a deep blue backdrop. The everyday pick.',
				frostDark,
				frostLight,
				{
					path: 'assets/wall-frosted.jpg',
					opacity: 0.95,
					blur: 18,
					dimming: 0.45,
				},
			),
		)

		themes.registerTheme(
			'liquid-glass',
			'midnight',
			glassTheme(
				'Glass · Midnight',
				'Smoked glass over near-black. Easiest on the eyes at night.',
				midnightDark,
				frostLight,
				{
					path: 'assets/wall-midnight.jpg',
					opacity: 0.9,
					blur: 20,
					dimming: 0.62,
				},
			),
		)

		themes.registerTheme(
			'liquid-glass',
			'aurora',
			glassTheme(
				'Glass · Aurora',
				'Violet glass with a live aurora showing through the panels.',
				auroraDark,
				auroraLight,
				{
					path: 'assets/wall-aurora.jpg',
					opacity: 0.85,
					blur: 8,
					dimming: 0.3,
				},
			),
		)

		themes.registerTheme(
			'liquid-glass',
			'daylight',
			glassTheme(
				'Glass · Daylight',
				'Bright, airy glass over a pale pastel backdrop. Built for the Light base.',
				frostDark,
				frostLight,
				{
					path: 'assets/wall-light.jpg',
					opacity: 0.9,
					blur: 10,
					dimming: 0.35,
				},
			),
		)

		themes.registerTheme(
			'liquid-glass',
			'clear',
			glassTheme(
				'Glass · Clear',
				'Barely-there glass: sharp backdrop, thin rim, almost no dimming.',
				frostDark,
				frostLight,
				{
					path: 'assets/wall-frosted.jpg',
					opacity: 0.95,
					blur: 2,
					dimming: 0.16,
				},
			),
		)
	},
})
