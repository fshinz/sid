/**
 * Obsidian Black — a pure black Discord theme.
 * Deep black surfaces, charcoal contrast, and neutral white accents.
 */

/// <reference types="@valenced/themes-api" />

export default plugin({
    start({ themes }) {
        themes.registerGroup('black-theme', {
            name: 'black🖤',
            description: 'minimal black theme',
        });

        const semantic = {
            BACKGROUND_BRAND: '#BDBDBD',

            CONTROL_CONNECTED_BACKGROUND_DEFAULT: '#AFAFAF',
            CONTROL_CRITICAL_PRIMARY_BACKGROUND_DEFAULT: '#DA373C',
            CONTROL_CRITICAL_PRIMARY_TEXT_DEFAULT: '#FFFFFF',
            CONTROL_CRITICAL_SECONDARY_BACKGROUND_DEFAULT: '#202020',
            CONTROL_EXPRESSIVE_BACKGROUND_DEFAULT: '#BDBDBD',

            CONTROL_ICON_ONLY_ICON_DEFAULT: '#D0D0D0',
            CONTROL_OVERLAY_SECONDARY_BACKGROUND_DEFAULT: '#FFFFFF14',

            CONTROL_PRIMARY_BACKGROUND_DEFAULT: '#BDBDBD',
            CONTROL_PRIMARY_TEXT_DEFAULT: '#080808',

            CONTROL_SECONDARY_BACKGROUND_ACTIVE: '#FFFFFF20',
            CONTROL_SECONDARY_BACKGROUND_DEFAULT: '#FFFFFF0A',
            CONTROL_SECONDARY_BORDER_DEFAULT: '#404040',
            CONTROL_SECONDARY_TEXT_DEFAULT: '#E0E0E0',

            EMBED_BACKGROUND: '#0D0D0D',

            ICON_FEEDBACK_CRITICAL: '#F04747',
            ICON_SUBTLE: '#909090',
            INPUT_ICON_DEFAULT: '#A0A0A0',
            INTERACTIVE_ICON_DEFAULT: '#BDBDBD',

            MOBILE_ACTIONSHEET_BACKGROUND: '#080808',
            MOBILE_EMBED_BACKGROUND_DEFAULT: '#0D0D0D',
            MOBILE_FLOATING_ACCESSORY_BACKGROUND: '#101010',
            MOBILE_FLOATINGBAR_BACKGROUND: '#080808',
            MOBILE_FLOATINGBAR_BACKGROUND_NAMEPLATE: '#080808',

            REACTION_BACKGROUND_DEFAULT: '#101010',
            REACTION_BACKGROUND_REACTED_DEFAULT: '#242424',
            REACTION_BORDER_DEFAULT: '#303030',
            REACTION_BORDER_REACTED_DEFAULT: '#BDBDBD',
            REACTION_TEXT_DEFAULT: '#D0D0D0',

            TEXT_LINK: '#D4D4D4',

            STATUS_DANGER: '#DA373C',
            STATUS_DANGER_TEXT: '#FFFFFF',

            POLLS_VOTED_FILL: '#BDBDBD',

            REDESIGN_BUTTON_TERTIARY_BACKGROUND: '#1A1A1A',

            CHANNEL_BACKGROUND_DEFAULT: '#050505',
            STANDALONE_CHANNEL_CONTENT_BACKGROUND: '#050505',

            MOBILE_GUILDBAR_ICON_BACKGROUND_DEFAULT: '#101010',
            MOBILE_GUILDBAR_ICON_DEFAULT: '#C0C0C0',

            GUILD_FOLDER_BACKGROUND: '#0D0D0D',

            REDESIGN_CHANNEL_NAME_TEXT: '#EAEAEA',
            REDESIGN_CHANNEL_NAME_MUTED_TEXT: '#777777',
            CHANNEL_ICON: '#888888',

            MOBILE_CHANNEL_ITEM_BACKGROUND_SELECTED: '#1A1A1A',

            MOBILE_CHATINPUT_BACKGROUND_DEFAULT: '#0D0D0D',
            MOBILE_CHATINPUT_BACKGROUND_ACTIVE: '#101010',
            MOBILE_CHATINPUT_BORDER_DEFAULT: '#202020',
            MOBILE_CHATINPUT_BORDER_ACTIVE: '#505050',

            CHAT_INPUT_ICON_DEFAULT_TINT: '#A0A0A0',
            CHAT_INPUT_ACTION_ICON_ACTIVE_TINT: '#FFFFFF',

            BACKGROUND_BASE_LOW: '#080808',
            BACKGROUND_BASE_LOWER: '#030303',
            BACKGROUND_BASE_LOWEST: '#000000',

            BACKGROUND_SURFACE_HIGH: '#101010',
            BACKGROUND_SURFACE_HIGHEST: '#151515',

            CARD_BACKGROUND_DEFAULT: '#0D0D0D',

            TABLEROW_BACKGROUND_DEFAULT: '#FFFFFF08',
            TABLEROW_BACKGROUND_PRESSED: '#FFFFFF12',

            TEXT_DEFAULT: '#EAEAEA',
            TEXT_MUTED: '#777777',
            TEXT_BRAND: '#FFFFFF',
        };

        const raw = {
            // Brand and focus
            BLUE_NEW_27: '#D4D4D4',
            BLUE_NEW_37: '#D4D4D4',
            BLURPLE_14: '#D4D4D4',
            BLURPLE_36: '#D4D4D4',
            BLURPLE_50: '#A0A0A0',
            BLURPLE_65: '#777777',

            BRAND_345: '#888888',
            BRAND_500: '#BDBDBD',
            FOCUS_PRIMARY: '#A0A0A0',

            // Preserve readable status colors
            GREEN_0: '#19734D',
            GREEN_260: '#95CCB0',
            GREEN_300: '#8CC6A8',
            GREEN_345: '#82BFA0',
            GREEN_360: '#79B998',
            GREEN_400: '#70B390',
            GREEN_430: '#5BAD87',
            GREEN_460: '#46A67E',
            GREEN_500: '#40A078',
            GREEN_530: '#399971',
            GREEN_560: '#33936B',
            GREEN_600: '#2D8C65',
            GREEN_630: '#28865F',
            GREEN_660: '#228059',
            GREEN_NEW_22: '#79B998',
            GREEN_NEW_31: '#79B998',

            RED_400: '#F04747',
            RED_NEW_45: '#DA373C',
            RED_NEW_50: '#F04747',

            // Neutral palette
            NEUTRAL_1: '#FFFFFF',
            NEUTRAL_2: '#F5F5F5',
            NEUTRAL_5: '#EAEAEA',
            NEUTRAL_16: '#BDBDBD',
            NEUTRAL_23: '#A0A0A0',
            NEUTRAL_29: '#888888',
            NEUTRAL_31: '#777777',
            NEUTRAL_64: '#151515',
            NEUTRAL_73: '#101010',
            NEUTRAL_76: '#0D0D0D',
            NEUTRAL_79: '#0D0D0D',
            NEUTRAL_83: '#080808',
            NEUTRAL_86: '#050505',
            NEUTRAL_90: '#030303',
            NEUTRAL_92: '#020202',
            NEUTRAL_96: '#000000',
            NEUTRAL_100: '#000000',

            // White opacity levels
            OPACITY_1: '#FFFFFF05',
            OPACITY_4: '#FFFFFF0A',
            OPACITY_8: '#FFFFFF14',
            OPACITY_12: '#FFFFFF1F',
            OPACITY_16: '#FFFFFF29',
            OPACITY_20: '#FFFFFF33',
            OPACITY_24: '#FFFFFF3D',
            OPACITY_28: '#FFFFFF47',
            OPACITY_32: '#FFFFFF52',
            OPACITY_36: '#FFFFFF5C',
            OPACITY_40: '#FFFFFF66',
            OPACITY_44: '#FFFFFF70',
            OPACITY_48: '#FFFFFF7A',
            OPACITY_52: '#FFFFFF85',
            OPACITY_56: '#FFFFFF8F',
            OPACITY_60: '#FFFFFF99',
            OPACITY_64: '#FFFFFFA3',
            OPACITY_68: '#FFFFFFAD',
            OPACITY_72: '#FFFFFFB8',
            OPACITY_76: '#FFFFFFC2',
            OPACITY_80: '#FFFFFFCC',
            OPACITY_84: '#FFFFFFD6',
            OPACITY_88: '#FFFFFFE0',
            OPACITY_92: '#FFFFFFEB',
            OPACITY_96: '#FFFFFFF5',

            // Black opacity levels
            OPACITY_BLACK_1: '#00000005',
            OPACITY_BLACK_4: '#0000000A',
            OPACITY_BLACK_8: '#00000014',
            OPACITY_BLACK_12: '#0000001F',
            OPACITY_BLACK_16: '#00000029',
            OPACITY_BLACK_20: '#00000033',
            OPACITY_BLACK_24: '#0000003D',
            OPACITY_BLACK_28: '#00000047',
            OPACITY_BLACK_32: '#00000052',
            OPACITY_BLACK_36: '#0000005C',
            OPACITY_BLACK_40: '#00000066',
            OPACITY_BLACK_44: '#00000070',
            OPACITY_BLACK_48: '#0000007A',
            OPACITY_BLACK_52: '#00000085',
            OPACITY_BLACK_56: '#0000008F',
            OPACITY_BLACK_60: '#00000099',
            OPACITY_BLACK_64: '#000000A3',
            OPACITY_BLACK_68: '#000000AD',
            OPACITY_BLACK_72: '#000000B8',
            OPACITY_BLACK_76: '#000000C2',
            OPACITY_BLACK_80: '#000000CC',
            OPACITY_BLACK_84: '#000000D6',
            OPACITY_BLACK_88: '#000000E0',
            OPACITY_BLACK_92: '#000000EB',
            OPACITY_BLACK_96: '#000000F5',

            // Discord white tokens
            WHITE: '#FFFFFF',
            WHITE_500: '#FFFFFF',
        };

        themes.registerTheme('shin's themes', 'black', {
            name: 'black',
            getColors: () => ({
                semantic: {
                    darker: { ...semantic },
                    dark: { ...semantic },
                },
                raw,
            }),
        });
    },
});
