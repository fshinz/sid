@file:JvmName("DevLab")

package com.shin.devlab

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.os.Process
import app.valenced.plugins.plugin
import app.valenced.xposed.api.registerNativeAsyncMethod
import org.json.JSONObject
import java.io.BufferedWriter
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStreamWriter

private const val DEFAULT_SESSIONS = 8
private const val MIN_SESSIONS = 2
private const val MAX_SESSIONS = 50
private const val JS_CAP_BYTES = 1_500_000L
private const val LOGCAT_CAP_BYTES = 3_000_000L
private const val MAX_READ_BYTES = 2_000_000
private const val MAX_TRACE_BYTES = 600_000
private val LEVELS = setOf("V", "D", "I", "W", "E")

private var shutdown: (() -> Unit)? = null

private val REDACTIONS = listOf(
	Regex("""[\w-]{24,28}\.[\w-]{6}\.[\w-]{27,}"""),
	Regex("""mfa\.[\w-]{80,}"""),
	Regex("""(?i)(authorization["']?\s*[:=]\s*["']?)(bearer |bot )?[^\s"',}]+"""),
	Regex("""\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}"""),
	Regex("""\bAIza[0-9A-Za-z_-]{30,}"""),
)

private fun redact(line: String): String {
	var out = line
	for (pattern in REDACTIONS) {
		out = pattern.replace(out) { match ->
			if (match.groupValues.size > 1 && match.groupValues[1].isNotEmpty()) "${match.groupValues[1]}[redacted]"
			else "[redacted]"
		}
	}
	return out
}

private class RollingFile(private val file: File, private val cap: Long) {
	private var writer: BufferedWriter? = null
	private var size = file.length()

	private fun open(): BufferedWriter =
		writer ?: BufferedWriter(OutputStreamWriter(FileOutputStream(file, true), Charsets.UTF_8)).also { writer = it }

	@Synchronized
	fun append(text: String, flush: Boolean) {
		if (size + text.length > cap && size > 0) {
			runCatching { writer?.close() }
			writer = null
			val old = File(file.path + ".1")
			old.delete()
			file.renameTo(old)
			size = 0
		}
		val out = open()
		out.write(text)
		size += text.length
		if (flush) out.flush()
	}

	@Synchronized
	fun flush() {
		runCatching { writer?.flush() }
	}

	@Synchronized
	fun close() {
		runCatching { writer?.close() }
		writer = null
	}
}

private fun readTail(dir: File, name: String, max: Int): String {
	val parts = listOf(File(dir, "$name.1"), File(dir, name)).filter(File::isFile)
	val total = parts.sumOf(File::length)
	var skip = (total - max).coerceAtLeast(0)
	val out = StringBuilder()
	for (part in parts) {
		val length = part.length()
		if (skip >= length) {
			skip -= length
			continue
		}
		part.inputStream().use { input ->
			input.skip(skip)
			out.append(input.readBytes().toString(Charsets.UTF_8))
		}
		skip = 0
	}
	if (total > max) {
		val newline = out.indexOf("\n")
		if (newline >= 0) out.delete(0, newline + 1)
	}
	return out.toString()
}

private fun sizeOf(dir: File, name: String) = File(dir, name).length() + File(dir, "$name.1").length()

private val EXIT_REASONS = mapOf(
	0 to "unknown",
	1 to "exited",
	2 to "killed by a signal",
	3 to "low memory",
	4 to "crash",
	5 to "native crash",
	6 to "not responding (ANR)",
	7 to "failed to start",
	8 to "permission changed",
	9 to "used too many resources",
	10 to "stopped by the user",
	11 to "force stopped",
	12 to "a process it depended on died",
	13 to "other",
	14 to "frozen",
	15 to "package state changed",
	16 to "updated",
)

@Suppress("UNUSED")
val devlab = plugin {
	start {
		val pid = Process.myPid()
		val startedAt = System.currentTimeMillis()
		val root = File(storageDir, "logs").apply { mkdirs() }
		val session = File(root, "$startedAt-$pid").apply { mkdirs() }
		val configFile = File(storageDir, "native-config.json")

		runCatching {
			File(session, "meta.json").writeText(
				JSONObject().put("startedAt", startedAt).put("pid", pid).toString(),
			)
		}

		val jsLog = RollingFile(File(session, "js.jsonl"), JS_CAP_BYTES)
		val logcatLog = RollingFile(File(session, "logcat.txt"), LOGCAT_CAP_BYTES)

		fun readConfig(): JSONObject = runCatching { JSONObject(configFile.readText()) }.getOrElse { JSONObject() }
		fun logcatLevel(): String = readConfig().optString("logcatLevel", "I").takeIf { it in LEVELS } ?: "I"
		fun logcatEnabled(): Boolean = readConfig().optBoolean("logcatEnabled", true)
		fun maxSessions(): Int = readConfig().optInt("maxSessions", DEFAULT_SESSIONS).coerceIn(MIN_SESSIONS, MAX_SESSIONS)

		runCatching {
			root.listFiles().orEmpty()
				.filter { it.isDirectory && it != session }
				.sortedByDescending { it.name.substringBefore('-').toLongOrNull() ?: 0L }
				.drop(maxSessions() - 1)
				.forEach { it.deleteRecursively() }
		}

		var logcatProcess: java.lang.Process? = null
		var logcatThread: Thread? = null
		var logcatError: String? = null
		var logcatLines = 0L

		fun stopLogcat() {
			runCatching { logcatProcess?.destroy() }
			logcatProcess = null
			logcatThread?.interrupt()
			logcatThread = null
		}

		fun startLogcat() {
			stopLogcat()
			if (!logcatEnabled()) return
			val level = logcatLevel()
			logcatError = null
			val process = runCatching {
				ProcessBuilder("logcat", "-v", "threadtime", "--pid=$pid", "*:$level")
					.redirectErrorStream(true)
					.start()
			}.getOrElse {
				logcatError = "could not start logcat: $it"
				runCatching { log.e(logcatError!!) }
				return
			}
			logcatProcess = process
			logcatThread = Thread({
				runCatching {
					process.inputStream.bufferedReader().use { reader ->
						while (!Thread.currentThread().isInterrupted) {
							val line = reader.readLine() ?: break
							logcatLines++
							logcatLog.append(redact(line) + "\n", flush = !reader.ready())
						}
					}
				}.onFailure { if (logcatProcess === process) logcatError = "logcat stopped: $it" }
				logcatLog.flush()
			}, "DevLab-logcat").apply {
				isDaemon = true
				start()
			}
			runCatching { log.i("reading logcat for pid $pid at level $level") }
		}

		runCatching { startLogcat() }

		val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
		val crashHandler = Thread.UncaughtExceptionHandler { thread, error ->
			runCatching {
				File(session, "crash.txt").appendText(
					"${System.currentTimeMillis()} on thread ${thread.name}\n${error.stackTraceToString()}\n",
				)
				jsLog.flush()
				logcatLog.flush()
			}
			previousHandler?.uncaughtException(thread, error)
		}
		Thread.setDefaultUncaughtExceptionHandler(crashHandler)

		var appContext: Context? = null
		withAppContext { appContext = it.applicationContext ?: it }

		fun exitInfos(limit: Int): List<android.app.ApplicationExitInfo> {
			if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return emptyList()
			val context = appContext ?: return emptyList()
			val manager = context.getSystemService(ActivityManager::class.java) ?: return emptyList()
			return manager.getHistoricalProcessExitReasons(context.packageName, 0, limit)
		}

		fun describeExit(info: android.app.ApplicationExitInfo): Map<String, Any?> = mapOf(
			"pid" to info.pid,
			"timestamp" to info.timestamp.toDouble(),
			"reason" to info.reason,
			"reasonText" to (EXIT_REASONS[info.reason] ?: "reason ${info.reason}"),
			"description" to info.description,
			"status" to info.status,
			"importance" to info.importance,
			"processName" to info.processName,
			"pssKb" to info.pss.toDouble(),
			"rssKb" to info.rss.toDouble(),
			"hasTrace" to (info.reason == 5 || info.reason == 6),
		)

		fun sessionInfo(dir: File, exits: List<android.app.ApplicationExitInfo>): Map<String, Any?> {
			val meta = runCatching { JSONObject(File(dir, "meta.json").readText()) }.getOrElse { JSONObject() }
			val sessionPid = meta.optInt("pid", -1)
			val sessionStart = meta.optLong("startedAt", 0L)
			val exit = exits.firstOrNull { it.pid == sessionPid && it.timestamp >= sessionStart }
			return mapOf(
				"id" to dir.name,
				"startedAt" to sessionStart.toDouble(),
				"pid" to sessionPid,
				"current" to (dir == session),
				"jsBytes" to sizeOf(dir, "js.jsonl").toDouble(),
				"logcatBytes" to sizeOf(dir, "logcat.txt").toDouble(),
				"crash" to File(dir, "crash.txt").isFile,
				"exit" to exit?.let(::describeExit),
			)
		}

		fun sessionDir(id: Any?): File? {
			val name = id as? String ?: return null
			if (name.contains('/') || name.contains("..")) return null
			return File(root, name).takeIf(File::isDirectory)
		}

		val prefix = "${manifest.id}.logs"

		registerNativeAsyncMethod("$prefix.append") { args ->
			val lines = (args.getOrNull(0) as? List<*>)?.filterIsInstance<String>() ?: return@registerNativeAsyncMethod false
			if (lines.isEmpty()) return@registerNativeAsyncMethod true
			val urgent = args.getOrNull(1) == true
			jsLog.append(lines.joinToString("\n", postfix = "\n"), flush = true)
			if (urgent) logcatLog.flush()
			true
		}

		registerNativeAsyncMethod("$prefix.sessions") { _ ->
			val exits = runCatching { exitInfos(32) }.getOrElse { emptyList() }
			root.listFiles().orEmpty()
				.filter(File::isDirectory)
				.sortedByDescending { it.name.substringBefore('-').toLongOrNull() ?: 0L }
				.map { sessionInfo(it, exits) }
		}

		registerNativeAsyncMethod("$prefix.read") { args ->
			val dir = sessionDir(args.getOrNull(0)) ?: return@registerNativeAsyncMethod null
			val max = (args.getOrNull(2) as? Number)?.toInt()?.coerceIn(1_000, MAX_READ_BYTES) ?: 400_000
			when (args.getOrNull(1)) {
				"js" -> { jsLog.flush(); readTail(dir, "js.jsonl", max) }
				"logcat" -> { logcatLog.flush(); readTail(dir, "logcat.txt", max) }
				"crash" -> readTail(dir, "crash.txt", max)
				else -> null
			}
		}

		registerNativeAsyncMethod("$prefix.exits") { _ ->
			runCatching { exitInfos(32).map(::describeExit) }.getOrElse { emptyList() }
		}

		registerNativeAsyncMethod("$prefix.exitTrace") { args ->
			val wantedPid = (args.getOrNull(0) as? Number)?.toInt() ?: return@registerNativeAsyncMethod null
			val wantedAt = (args.getOrNull(1) as? Number)?.toLong() ?: return@registerNativeAsyncMethod null
			val info = exitInfos(32).firstOrNull { it.pid == wantedPid && it.timestamp == wantedAt }
				?: return@registerNativeAsyncMethod null
			val bytes = info.traceInputStream?.use { input ->
				val buffer = java.io.ByteArrayOutputStream()
				val chunk = ByteArray(16_384)
				while (buffer.size() < MAX_TRACE_BYTES) {
					val read = input.read(chunk)
					if (read < 0) break
					buffer.write(chunk, 0, read)
				}
				buffer.toByteArray()
			} ?: return@registerNativeAsyncMethod null
			if (info.reason == 5) {
				val runs = StringBuilder()
				val current = StringBuilder()
				for (byte in bytes) {
					val c = byte.toInt() and 0xff
					if (c in 0x20..0x7e) current.append(c.toChar())
					else {
						if (current.length >= 4) runs.append(current).append('\n')
						current.setLength(0)
					}
				}
				if (current.length >= 4) runs.append(current)
				redact(runs.toString())
			} else {
				redact(bytes.toString(Charsets.UTF_8))
			}
		}

		registerNativeAsyncMethod("$prefix.status") { _ ->
			mapOf(
				"session" to session.name,
				"logcatRunning" to (logcatThread?.isAlive == true),
				"logcatEnabled" to logcatEnabled(),
				"logcatLevel" to logcatLevel(),
				"maxSessions" to maxSessions().toDouble(),
				"logcatLines" to logcatLines.toDouble(),
				"logcatError" to logcatError,
				"exitReasonsAvailable" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R),
				"sdk" to Build.VERSION.SDK_INT,
			)
		}

		registerNativeAsyncMethod("$prefix.configure") { args ->
			val change = args.getOrNull(0) as? Map<*, *> ?: return@registerNativeAsyncMethod false
			val config = readConfig()
			(change["logcatLevel"] as? String)?.takeIf { it in LEVELS }?.let { config.put("logcatLevel", it) }
			(change["logcatEnabled"] as? Boolean)?.let { config.put("logcatEnabled", it) }
			(change["maxSessions"] as? Number)?.let { config.put("maxSessions", it.toInt().coerceIn(MIN_SESSIONS, MAX_SESSIONS)) }
			configFile.writeText(config.toString())
			startLogcat()
			true
		}

		registerNativeAsyncMethod("${manifest.id}.device") { _ ->
			val context = appContext
			val pkg = runCatching { context?.packageManager?.getPackageInfo(context.packageName, 0) }.getOrNull()
			mapOf(
				"appVersionName" to pkg?.versionName,
				"appVersionCode" to pkg?.let {
					if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.longVersionCode.toDouble()
					else @Suppress("DEPRECATION") it.versionCode.toDouble()
				},
				"androidRelease" to Build.VERSION.RELEASE,
				"sdk" to Build.VERSION.SDK_INT,
				"securityPatch" to Build.VERSION.SECURITY_PATCH,
				"manufacturer" to Build.MANUFACTURER,
				"model" to Build.MODEL,
				"abi" to Build.SUPPORTED_ABIS.firstOrNull(),
			)
		}

		registerNativeAsyncMethod("${manifest.id}.nativePlugins") { _ ->
			val dataDir = appContext?.applicationInfo?.dataDir ?: return@registerNativeAsyncMethod emptyList<String>()
			File(dataDir, "files/valenced/plugins/dist").listFiles().orEmpty()
				.filter { it.isDirectory && !it.name.startsWith(".") }
				.mapNotNull { dir ->
					runCatching {
						val json = JSONObject(File(dir, "manifest.json").readText())
						json.optString("id").takeIf { it.isNotEmpty() && json.optJSONObject("dist")?.has("android") == true }
					}.getOrNull()
				}
		}

		fun formatJsLine(raw: String): String = runCatching {
			val entry = JSONObject(raw)
			val time = java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.ROOT)
				.format(java.util.Date(entry.optLong("t")))
			val tag = entry.optString("tag").takeIf { it.isNotEmpty() }
			val who = entry.optString("plugin").takeIf { it.isNotEmpty() && it != "null" }
				?: if (entry.optString("src") == "discord") "Discord${tag?.let { "/$it" } ?: ""}" else "Discord/Valenced"
			val repeats = entry.optInt("repeats", 0)
			val head = "$time ${entry.optString("lvl").uppercase().padEnd(5)} [$who] ${entry.optString("msg")}" +
				if (repeats > 0) " (x${repeats + 1})" else ""
			val stack = entry.optString("stack").takeIf { it.isNotEmpty() && it != "null" }
			if (stack != null) "$head\n$stack" else head
		}.getOrDefault(raw)

		fun sessionText(dir: File): String = buildString {
			val meta = runCatching { JSONObject(File(dir, "meta.json").readText()) }.getOrElse { JSONObject() }
			val exit = runCatching { exitInfos(32) }.getOrElse { emptyList() }
				.firstOrNull { it.pid == meta.optInt("pid", -1) && it.timestamp >= meta.optLong("startedAt", 0L) }
			append("DevLab log, session ${dir.name}\n")
			append("Started ${java.util.Date(meta.optLong("startedAt", 0L))}, pid ${meta.optInt("pid", -1)}\n")
			if (exit != null) append("Ended: ${EXIT_REASONS[exit.reason] ?: exit.reason}${exit.description?.let { " ($it)" } ?: ""}\n")
			append("Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}\n")
			if (File(dir, "crash.txt").isFile) {
				append("\n===== Java crash =====\n")
				append(readTail(dir, "crash.txt", 200_000))
			}
			append("\n===== Plugins & Discord (JS) =====\n")
			jsLog.flush()
			readTail(dir, "js.jsonl", MAX_READ_BYTES).lineSequence().filter(String::isNotBlank)
				.forEach { append(formatJsLine(it)).append('\n') }
			append("\n===== Android log (logcat) =====\n")
			logcatLog.flush()
			append(readTail(dir, "logcat.txt", LOGCAT_CAP_BYTES.toInt() * 2))
		}

		fun saveToDownloads(context: Context, name: String, text: String): android.net.Uri {
			check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { "saving needs Android 10 or newer" }
			val resolver = context.contentResolver
			val values = android.content.ContentValues().apply {
				put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name)
				put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "text/plain")
				put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, "${android.os.Environment.DIRECTORY_DOWNLOADS}/DevLab")
				put(android.provider.MediaStore.MediaColumns.IS_PENDING, 1)
			}
			val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
				?: error("MediaStore would not create the file")
			try {
				resolver.openOutputStream(uri)?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
					?: error("MediaStore gave no stream to write to")
				values.clear()
				values.put(android.provider.MediaStore.MediaColumns.IS_PENDING, 0)
				resolver.update(uri, values, null, null)
			} catch (error: Throwable) {
				runCatching { resolver.delete(uri, null, null) }
				throw error
			}
			return uri
		}

		fun share(context: Context, uri: android.net.Uri, name: String) {
			val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
				type = "text/plain"
				putExtra(android.content.Intent.EXTRA_STREAM, uri)
				putExtra(android.content.Intent.EXTRA_SUBJECT, name)
				clipData = android.content.ClipData.newRawUri(name, uri)
				addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
			}
			val chooser = android.content.Intent.createChooser(send, name).apply {
				addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
			}
			context.startActivity(chooser)
		}

		registerNativeAsyncMethod("${manifest.id}.export") { args ->
			val context = appContext ?: error("Discord's context is not ready yet")
			val name = (args.getOrNull(0) as? String)
				?.replace(Regex("""[^\w .()-]"""), "_")?.take(120)?.let { if (it.endsWith(".txt")) it else "$it.txt" }
				?: "devlab.txt"
			val textPrefix = args.getOrNull(4) as? String
			val earlier = (args.getOrNull(5) as? List<*>).orEmpty().mapNotNull(::sessionDir)
			val session = sessionDir(args.getOrNull(2))?.let(::sessionText)
			val text = (args.getOrNull(1) as? String)
				?: if (session == null && textPrefix == null) error("nothing to export") else buildString {
					if (textPrefix != null) append(textPrefix).append("\n\n")
					if (session != null) append(session)
					for (dir in earlier) append("\n\n########## Earlier session ##########\n\n").append(sessionText(dir))
				}
			val uri = saveToDownloads(context, name, redact(text))
			if (args.getOrNull(3) == true) {
				android.os.Handler(android.os.Looper.getMainLooper()).post {
					runCatching { share(context, uri, name) }.onFailure { runCatching { log.e("share sheet failed", it) } }
				}
			}
			mapOf("uri" to uri.toString(), "path" to "Download/DevLab/$name", "bytes" to text.length.toDouble())
		}

		registerNativeAsyncMethod("$prefix.clear") { _ ->
			root.listFiles().orEmpty().filter { it.isDirectory && it != session }.forEach { it.deleteRecursively() }
			true
		}

		shutdown = {
			stopLogcat()
			jsLog.close()
			logcatLog.close()
			if (Thread.getDefaultUncaughtExceptionHandler() === crashHandler) {
				Thread.setDefaultUncaughtExceptionHandler(previousHandler)
			}
		}

		runCatching { log.i("session ${session.name} logging to ${session.path}") }
	}

	stop {
		shutdown?.invoke()
		shutdown = null
	}
}
