package com.liquidglass.fx

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import app.valenced.Logger
import java.lang.ref.WeakReference

internal data class GlassConfig(
	val enabled: Boolean = true,
	val top: Boolean = true,
	val bottom: Boolean = true,
	val input: Boolean = true,
	val floating: Boolean = true,
	val material: String = "regular",
	val blurDp: Float = 18f,
	val bevelDp: Float = 26f,
	val refractDp: Float = 46f,
	val falloff: Float = 2f,
	val dispersion: Float = 0.1f,
	val rim: Float = 1f,
	val dim: Float = 0.18f,
	val sat: Float = 1.15f,
	val tint: Float = 0.1f,
	val sensor: Boolean = false,
) {
	fun targetOn(target: String): Boolean = when (target) {
		"top" -> top
		"bottom" -> bottom
		"input" -> input
		"floating" -> floating
		else -> false
	}
}

internal class GlassEngine(private val log: Logger) {
	private val main = Handler(Looper.getMainLooper())
	private var activityRef: WeakReference<Activity>? = null
	private val hosts = ArrayList<Host>()
	private var capture: Bitmap? = null
	private var blurred: Bitmap? = null
	private var captureStamp = 0L
	private var dirty = true
	private var scanPending = false
	private var lastScanSignature = ""
	private var sensorLight: SensorLight? = null
	private var listenersAttached = false

	var config = GlassConfig()
		private set

	val captureScale = 0.5f

	private class Host(
		val target: String,
		val view: View,
		val glass: GlassView,
		val background: Drawable?,
		val signature: String,
	)

	fun attach(activity: Activity) {
		main.post {
			activityRef = WeakReference(activity)
			attachListeners(activity.window.decorView)
			rescan()
		}
	}

	fun configure(map: Map<*, *>): Any? {
		main.post {
			config = GlassConfig(
				enabled = map.bool("enabled", config.enabled),
				top = map.bool("top", config.top),
				bottom = map.bool("bottom", config.bottom),
				input = map.bool("input", config.input),
				floating = map.bool("floating", config.floating),
				material = map.str("material", config.material),
				blurDp = map.num("blurDp", config.blurDp),
				bevelDp = map.num("bevelDp", config.bevelDp),
				refractDp = map.num("refractDp", config.refractDp),
				falloff = map.num("falloff", config.falloff),
				dispersion = map.num("dispersion", config.dispersion),
				rim = map.num("rim", config.rim),
				dim = map.num("dim", config.dim),
				sat = map.num("sat", config.sat),
				tint = map.num("tint", config.tint),
				sensor = map.bool("sensor", config.sensor),
			)
			lastScanSignature = ""
			updateSensor()
			rescan()
			dirty = true
			refresh()
		}
		return true
	}

	fun rescanNow(): Any? {
		main.post {
			lastScanSignature = ""
			rescan()
		}
		return true
	}

	fun clearAll(): Any? {
		main.post {
			clearHosts()
			lastScanSignature = ""
		}
		return true
	}

	fun status(): Map<String, Any?> {
		val path = if (Build.VERSION.SDK_INT >= 33) "shader" else if (Build.VERSION.SDK_INT >= 31) "blur" else "plain"
		val applied = ArrayList<Map<String, Any?>>()
		for (host in hosts) {
			val loc = IntArray(2)
			host.view.getLocationInWindow(loc)
			applied.add(
				mapOf(
					"target" to host.target,
					"class" to host.view.javaClass.simpleName,
					"x" to loc[0],
					"y" to loc[1],
					"width" to host.view.width,
					"height" to host.view.height,
				),
			)
		}
		return mapOf(
			"enabled" to config.enabled,
			"path" to path,
			"material" to config.material,
			"sensor" to config.sensor,
			"applied" to applied,
		)
	}

	private fun updateSensor() {
		if (config.sensor && sensorLight == null) {
			sensorLight = SensorLight { x, y -> lightChanged(x, y) }.also { it.start() }
		} else if (!config.sensor) {
			sensorLight?.stop()
			sensorLight = null
			lightChanged(DEFAULT_LIGHT_X, DEFAULT_LIGHT_Y)
		}
	}

	private fun lightChanged(x: Float, y: Float) {
		for (host in hosts) host.glass.setLight(x, y)
	}

	private fun attachListeners(root: View) {
		if (listenersAttached) return
		listenersAttached = true
		val observer = root.viewTreeObserver
		if (!observer.isAlive) return
		observer.addOnGlobalLayoutListener(object : ViewTreeObserver.OnGlobalLayoutListener {
			override fun onGlobalLayout() {
				scheduleScan()
				markDirty()
			}
		})
		observer.addOnScrollChangedListener(object : ViewTreeObserver.OnScrollChangedListener {
			override fun onScrollChanged() {
				markDirty()
			}
		})
		main.post(object : Runnable {
			override fun run() {
				markDirty()
				main.postDelayed(this, 450)
			}
		})
	}

	private fun scheduleScan() {
		if (scanPending) return
		scanPending = true
		main.postDelayed({
			scanPending = false
			rescan()
		}, 600)
	}

	private fun markDirty() {
		dirty = true
		refresh()
	}

	private fun refresh() {
		for (host in hosts) host.glass.onBackdropUpdated()
	}

	internal fun backdrop(): Bitmap? {
		val now = System.nanoTime()
		if (!dirty && blurred != null && now - captureStamp < 33_000_000L) return blurred
		if (hosts.isEmpty()) return blurred
		val root = activityRef?.get()?.window?.decorView ?: return blurred
		if (root.width == 0 || root.height == 0) return blurred
		capture = capture(root, capture)
		val source = capture ?: return blurred
		blurred = GlassView.blurBitmap(source, config.blurDp * root.resources.displayMetrics.density * captureScale)
		captureStamp = now
		dirty = false
		return blurred
	}

	private fun capture(root: View, reuse: Bitmap?): Bitmap {
		val w = (root.width * captureScale).toInt().coerceAtLeast(2)
		val h = (root.height * captureScale).toInt().coerceAtLeast(2)
		val bmp = if (reuse != null && reuse.width == w && reuse.height == h) {
			reuse.eraseColor(0)
			reuse
		} else {
			reuse?.recycle()
			Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
		}
		val canvas = Canvas(bmp)
		canvas.scale(captureScale, captureScale)
		val hidden = ArrayList<View>()
		for (host in hosts) {
			if (host.view.visibility == View.VISIBLE) {
				host.view.visibility = View.INVISIBLE
				hidden.add(host.view)
			}
		}
		try {
			root.draw(canvas)
		} catch (_: Throwable) {
		}
		for (view in hidden) view.visibility = View.VISIBLE
		return bmp
	}

	private fun rescan() {
		val activity = activityRef?.get() ?: return
		val root = activity.window.decorView as? ViewGroup ?: return
		if (root.width == 0 || root.height == 0) {
			root.post { rescan() }
			return
		}
		val candidates = classify(root, root)
		val signature = candidates.joinToString("|") { it.signature }
		if (signature == lastScanSignature && hosts.isNotEmpty() == (config.enabled && candidates.isNotEmpty())) {
			pruneDetached()
			return
		}
		lastScanSignature = signature
		clearHosts()
		if (!config.enabled) return
		for (candidate in candidates) {
			if (config.targetOn(candidate.target)) decorate(candidate)
		}
		dirty = true
	}

	private fun pruneDetached() {
		val iterator = hosts.iterator()
		while (iterator.hasNext()) {
			val host = iterator.next()
			if (host.view.windowToken == null) {
				restore(host)
				iterator.remove()
			}
		}
	}

	private fun clearHosts() {
		for (host in hosts) restore(host)
		hosts.clear()
		dirty = true
	}

	private fun restore(host: Host) {
		try {
			(host.view as? ViewGroup)?.removeView(host.glass)
			host.view.background = host.background
		} catch (_: Throwable) {
		}
	}

	private class Candidate(val target: String, val view: View, val signature: String)

	private fun classify(root: ViewGroup, decor: View): List<Candidate> {
		val w = decor.width.toFloat()
		val h = decor.height.toFloat()
		val density = decor.resources.displayMetrics.density
		val barMin = 34f * density
		val barMax = 104f * density
		val found = ArrayList<Candidate>()

		fun walk(view: View, depth: Int) {
			if (depth > 14 || !view.isShown || view is GlassView) return
			val vw = view.width
			val vh = view.height
			if (vw > 0 && vh > 0) {
				val loc = IntArray(2)
				view.getLocationInWindow(loc)
				val heightPx = vh.toFloat()
				val strip = heightPx in barMin..barMax
				val target = when {
					strip && vw >= w * 0.92f && loc[1] <= 96f * density -> "top"
					strip && vw >= w * 0.92f && loc[1] + vh >= h - 24f * density -> "bottom"
					strip && vw >= w * 0.72f && loc[1] + vh >= h * 0.55f && loc[1] + vh < h - 8f * density -> "input"
					strip && vw >= w * 0.42f && loc[1] >= 96f * density && loc[1] + vh <= h - 64f * density -> "floating"
					else -> null
				}
				if (target != null) {
					val signature = "$target:${view.javaClass.name}@${loc[0]},${loc[1]},$vw,$vh"
					found.add(Candidate(target, view, signature))
				}
			}
			if (view is ViewGroup && depth < 14) {
				for (index in 0 until view.childCount) walk(view.getChildAt(index), depth + 1)
			}
		}
		walk(root, 0)

		val innermost = found.filter { candidate ->
			found.none { other ->
				other.view !== candidate.view && isDescendantOf(other.view, candidate.view)
			}
		}
		val unique = LinkedHashMap<String, Candidate>()
		for (candidate in innermost) {
			val key = "${candidate.target}:${candidate.signature}"
			if (!unique.containsKey(key)) unique[key] = candidate
		}
		return unique.values.take(12)
	}

	private fun isDescendantOf(view: View, ancestor: View): Boolean {
		var current = view.parent
		while (current is View) {
			if (current === ancestor) return true
			current = current.parent
		}
		return false
	}

	private fun decorate(candidate: Candidate) {
		val parent = candidate.view as? ViewGroup ?: return
		val density = parent.resources.displayMetrics.density
		val config = config
		val halfH = candidate.view.height / 2f
		val params = when (candidate.target) {
			"top", "bottom" -> GlassParams(
				radiusPx = 0f,
				extendX = candidate.view.width * 0.75f,
				extendY = 0f,
				bevelPx = config.bevelDp * density,
				refractPx = config.refractDp * density,
				falloff = config.falloff,
				dispersion = config.dispersion,
				rim = config.rim,
				dim = config.dim,
				sat = config.sat,
				adaptive = config.material == "regular",
				tintColor = 0xFFFFFF,
				tintColorAlpha = config.tint,
			)
			else -> GlassParams(
				radiusPx = halfH.coerceAtMost(26f * density),
				extendX = 0f,
				extendY = 0f,
				bevelPx = config.bevelDp * density,
				refractPx = config.refractDp * density,
				falloff = config.falloff,
				dispersion = config.dispersion,
				rim = config.rim,
				dim = config.dim,
				sat = config.sat,
				adaptive = config.material == "regular",
				tintColor = 0xFFFFFF,
				tintColorAlpha = config.tint,
			)
		}
		val glass = GlassView(parent.context, this, params)
		val background = candidate.view.background
		candidate.view.background = null
		parent.addView(glass, 0)
		hosts.add(Host(candidate.target, candidate.view, glass, background, candidate.signature))
		log.d { "glass on ${candidate.target} ${candidate.signature}" }
	}

	private fun Map<*, *>.num(key: String, def: Float): Float = (this[key] as? Number)?.toFloat() ?: def
	private fun Map<*, *>.bool(key: String, def: Boolean): Boolean = (this[key] as? Boolean) ?: def
	private fun Map<*, *>.str(key: String, def: String): String = (this[key] as? String) ?: def

	companion object {
		const val DEFAULT_LIGHT_X = 0.866f
		const val DEFAULT_LIGHT_Y = 0.5f
	}
}
