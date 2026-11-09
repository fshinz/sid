import * as discordFinders from '@valenced/discord/utils/modules/finders'
import * as modulesFinders from '@valenced/modules/finders'
import * as filters from '@valenced/modules/finders/filters'
import { fitReport, gatherReport } from './diagreport'
import { recordPluginError } from './errlog'

export enum OptionType {
	String = 3,
	Integer = 4,
	Boolean = 5,
	User = 6,
	Channel = 7,
	Role = 8,
	Number = 10,
}

export interface CommandOption {
	name: string
	description: string
	type: OptionType
	required?: boolean
	choices?: { name: string; value: string }[]
}

export interface CommandArgument {
	name: string
	value: unknown
}

export interface CommandContext {
	channel?: { id: string; name?: string; guild_id?: string }
	guild?: { id: string }
}

export interface CommandDefinition {
	name: string
	description: string
	options?: CommandOption[]
	execute(
		args: CommandArgument[],
		context: CommandContext,
	): void | { content: string } | Promise<void>
}

export interface ClientMessageOptions {
	channelId: string
	content: string
	author?: string
}

export function argument<T>(
	args: CommandArgument[],
	name: string,
	fallback: T,
): T {
	const found = args?.find(arg => arg?.name === name)
	return found?.value === undefined ? fallback : (found.value as T)
}

const BUILT_INS_PATH =
	'modules/application_commands/ApplicationCommandBuiltIns.tsx'
const BUILT_IN_APPLICATION_ID = '-1'
const CHAT_INPUT = 1
const INPUT_BUILT_IN = 0
const EPHEMERAL = 64

const OWNER = 'DevLab'

function fakeSnowflake(): string {
	const timestamp = BigInt(Date.now() - 1420070400000) << 22n
	const noise = BigInt(Math.floor(Math.random() * 4194304))
	return (timestamp | noise).toString()
}

function extract(mod: any): unknown {
	if (Array.isArray(mod?.BUILT_IN_COMMANDS)) return mod.BUILT_IN_COMMANDS
	if (Array.isArray(mod?.default?.BUILT_IN_COMMANDS))
		return mod.default.BUILT_IN_COMMANDS
	return undefined
}

function buildEntry(definition: CommandDefinition, id: string) {
	return {
		id,
		applicationId: BUILT_IN_APPLICATION_ID,
		type: CHAT_INPUT,
		inputType: INPUT_BUILT_IN,
		name: definition.name,
		displayName: definition.name,
		untranslatedName: definition.name,
		description: definition.description,
		displayDescription: definition.description,
		untranslatedDescription: definition.description,
		options: (definition.options ?? []).map(option => ({
			...option,
			displayName: option.name,
			displayDescription: option.description,
			required: option.required ?? false,
			...(option.choices
				? {
						choices: option.choices.map(choice => ({
							...choice,
							displayName: choice.name,
						})),
					}
				: {}),
		})),
		execute: definition.execute,
	}
}

export type DefaultAvatar = 0 | 1 | 2 | 3 | 4 | 5

function authorIdFor(owner: string, avatar: DefaultAvatar): string {
	let hash = 0n
	for (let i = 0; i < owner.length; i++)
		hash = (hash * 31n + BigInt(owner.charCodeAt(i))) % 100000000000n
	return (((hash + 1n) * 6n + BigInt(avatar)) << 22n).toString()
}

export function createCommands(owner: string, avatar: DefaultAvatar = 0) {
	const tag = `[${owner.replace(/\s+/g, '')}]`
	const authorId = authorIdFor(owner, avatar)

	const status = {
		found: false,
		via: '' as '' | 'imported-path' | 'props',
		registered: [] as string[],
	}

	let registry: any[] | undefined
	const queued = new Map<string, any>()
	let watching = false
	const teardown: Array<() => void> = []

	function stopWatching() {
		for (const stop of teardown.splice(0)) {
			try {
				stop()
			} catch {}
		}
		watching = false
	}

	function adopt(array: unknown, via: 'imported-path' | 'props'): boolean {
		if (registry || !Array.isArray(array)) return false
		registry = array as any[]
		status.found = true
		status.via = via
		for (const [id, entry] of queued) {
			const stale = registry.findIndex(command => command?.id === id)
			if (stale !== -1) registry.splice(stale, 1)
			registry.push(entry)
		}
		queued.clear()
		stopWatching()
		return true
	}

	function watchForRegistry() {
		if (watching || registry) return
		watching = true

		try {
			const finders = discordFinders as any
			if (typeof finders?.getModuleWithImportedPath === 'function') {
				const unsub = finders.getModuleWithImportedPath(
					BUILT_INS_PATH,
					(exports: any) => {
						adopt(extract(exports), 'imported-path')
					},
				)
				if (typeof unsub === 'function') teardown.push(unsub)
			}
		} catch (error) {
			recordPluginError(error, `${tag} imported-path lookup threw`)
		}

		if (registry) return stopWatching()

		try {
			const { lookupModules, waitForModules } = modulesFinders
			const { withProps } = filters
			const filter = withProps('BUILT_IN_COMMANDS')

			for (const [exports] of lookupModules(filter)) {
				if (adopt(extract(exports), 'props')) return
			}

			const unsub = waitForModules(filter, (exports: any) => {
				adopt(extract(exports), 'props')
			})
			teardown.push(() => unsub?.())
		} catch (error) {
			recordPluginError(error, `${tag} props lookup threw`)
		}
	}

	function registerCommand(definition: CommandDefinition): () => void {
		const id = `shin-${definition.name}`
		const entry = buildEntry(definition, id)
		status.registered.push(definition.name)

		if (registry) {
			const stale = registry.findIndex(command => command?.id === id)
			if (stale !== -1) registry.splice(stale, 1)
			registry.push(entry)
		} else {
			queued.set(id, entry)
			watchForRegistry()
		}

		return () => {
			queued.delete(id)
			if (registry) {
				const index = registry.findIndex(command => command?.id === id)
				if (index !== -1) registry.splice(index, 1)
			}
			status.registered = status.registered.filter(
				name => name !== definition.name,
			)
			if (queued.size === 0) stopWatching()
		}
	}

	function registryStatus(): {
		found: boolean
		via: string
		registered: string[]
	} {
		return {
			found: status.found,
			via: status.via,
			registered: [...status.registered],
		}
	}

	let receiver: any
	let receiverResolved = false

	function getReceiver(): any {
		if (receiverResolved) return receiver
		receiverResolved = true

		try {
			const { lookupModule } = modulesFinders
			const { withProps } = filters
			const [mod, id] = lookupModule(
				withProps('receiveMessage', 'sendMessage'),
			) as [any, number | undefined]
			if (id === undefined) {
				recordPluginError(new Error('no receiveMessage module found'), tag)
				return undefined
			}
			const host =
				typeof mod?.receiveMessage === 'function' ? mod : mod?.default
			if (typeof host?.receiveMessage !== 'function') {
				recordPluginError(
					new Error(`module ${id} has no callable receiveMessage`),
					tag,
				)
				return undefined
			}
			receiver = host
		} catch (error) {
			recordPluginError(error, `${tag} receiveMessage lookup threw`)
		}

		return receiver
	}

	function showClientMessage({
		channelId,
		content,
		author = owner,
	}: ClientMessageOptions): boolean {
		const host = getReceiver()
		if (!host) return false

		try {
			host.receiveMessage(channelId, {
				id: fakeSnowflake(),
				type: 0,
				flags: EPHEMERAL,
				channel_id: channelId,
				content,
				author: {
					id: authorId,
					username: author,
					global_name: author,
					discriminator: '0',
					avatar: null,
					bot: true,
				},
				timestamp: new Date().toISOString(),
				edited_timestamp: null,
				tts: false,
				pinned: false,
				mention_everyone: false,
				mentions: [],
				mention_roles: [],
				attachments: [],
				embeds: [],
				reactions: [],
				state: 'SENT',
			})
			return true
		} catch (error) {
			recordPluginError(error, `${tag} receiveMessage threw`)
			return false
		}
	}

	return { registerCommand, registryStatus, showClientMessage }
}

const { registerCommand, registryStatus, showClientMessage } = createCommands(
	OWNER,
	5,
)

export { registerCommand, registryStatus, showClientMessage }

let messages: any

function messageActions(): any {
	if (messages) return messages
	const { lookupModule } = modulesFinders
	const { withProps } = filters
	const [mod] = lookupModule(withProps('receiveMessage', 'sendMessage')) as [
		any,
		number | undefined,
	]
	const host = typeof mod?.sendMessage === 'function' ? mod : mod?.default
	if (typeof host?.sendMessage === 'function') messages = host
	return messages
}

const DISCORD_EPOCH = 1420070400000

function sendOptions(actions: any): Record<string, unknown> {
	let options: Record<string, unknown> = {}
	try {
		const built = actions.getSendMessageOptions?.({})
		if (built && typeof built === 'object') options = { ...built }
	} catch {}
	if (options.nonce == null) {
		try {
			options.nonce = (
				BigInt(Date.now() - DISCORD_EPOCH) << BigInt(22)
			).toString()
		} catch {
			options.nonce = String(Date.now())
		}
	}
	return options
}

function getMessageLimit(): number {
	try {
		const rev = (globalThis as any).valenced ?? (globalThis as any).revenge
		const user = rev?.discord?.flux?.Stores?.UserStore?.getCurrentUser?.()
		if (user?.premiumType === 2) return 4000
	} catch {}
	return 2000
}

async function runReport(channelId: string, send: boolean, core: boolean) {
	let data: Awaited<ReturnType<typeof gatherReport>>
	try {
		data = await gatherReport()
	} catch (error) {
		showClientMessage({
			channelId,
			content: `The checkup failed: ${String(error)}`,
		})
		return
	}

	const limit = getMessageLimit()
	const messagesToSend = [fitReport(data, { core }, limit)]

	if (!send) {
		for (const msg of messagesToSend) {
			showClientMessage({ channelId, content: msg })
		}
		return
	}

	try {
		const actions = messageActions()
		if (!actions) throw new Error("Discord's message actions were not found")
		for (let i = 0; i < messagesToSend.length; i++) {
			const content = messagesToSend[i]
			await actions.sendMessage(
				channelId,
				{ content, tts: false, invalidEmojis: [], validNonShortcutEmojis: [] },
				undefined,
				sendOptions(actions),
			)
			if (i < messagesToSend.length - 1) {
				await new Promise(r => setTimeout(r, 250))
			}
		}
	} catch (error) {
		showClientMessage({
			channelId,
			content: `Could not post it (${String(error)}). Here it is for you to copy:\n\n${messagesToSend.join('\n\n')}`,
		})
	}
}

export function registerPluginsCommand(): () => void {
	return registerCommand({
		name: 'plugins',
		description:
			'Your Discord, Valenced and Android builds and every plugin, for a bug report (DevLab)',
		options: [
			{
				name: 'send',
				description: 'Post it in this channel instead of showing only you',
				type: OptionType.Boolean,
			},
			{
				name: 'core',
				description: "Include Valenced's own built-in plugins",
				type: OptionType.Boolean,
			},
		],
		execute(args, context: CommandContext) {
			const channelId = context?.channel?.id
			if (!channelId) return
			void runReport(
				channelId,
				argument(args, 'send', false),
				argument(args, 'core', false),
			)
		},
	})
}
