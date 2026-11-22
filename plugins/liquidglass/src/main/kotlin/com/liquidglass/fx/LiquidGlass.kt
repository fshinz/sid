@file:JvmName("LiquidGlass")

package com.liquidglass.fx

import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod

private const val ID = "com.liquidglass.fx"

private var shutdown: (() -> Unit)? = null

@Suppress("UNUSED")
val liquidGlass = plugin {
	start {
		val engine = GlassEngine(log)
		withAppContext { engine.attachContext(it) }
		withAppActivity { engine.attach(it) }

		registerNativeAsyncMethod("$ID.configure") { args ->
			engine.configure(args.getOrNull(0) as? Map<*, *> ?: emptyMap<Any, Any>())
		}
		registerNativeAsyncMethod("$ID.apply") { engine.rescanNow() }
		registerNativeAsyncMethod("$ID.clear") { engine.clearAll() }
		registerNativeAsyncMethod("$ID.status") { engine.status() }

		shutdown = { engine.clearAll() }
	}

	stop {
		shutdown?.invoke()
		shutdown = null
	}
}
