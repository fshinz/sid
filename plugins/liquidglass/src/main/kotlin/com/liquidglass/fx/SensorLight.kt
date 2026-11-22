package com.liquidglass.fx

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.view.Surface
import android.view.WindowManager

internal class SensorLight(private val onLight: (x: Float, y: Float) -> Unit) : SensorEventListener {
	private var manager: SensorManager? = null
	private var lastX = GlassEngine.DEFAULT_LIGHT_X
	private var lastY = GlassEngine.DEFAULT_LIGHT_Y

	fun start() {
		val app = android.app.AndroidAppHelper.currentApplication() ?: return
		val sensorManager = app.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
		val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_GRAVITY)
			?: sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
			?: return
		manager = sensorManager
		sensorManager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
	}

	fun stop() {
		manager?.unregisterListener(this)
		manager = null
	}

	override fun onSensorChanged(event: SensorEvent) {
		val rotation = try {
			val windowManager = android.app.AndroidAppHelper.currentApplication()
				?.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
			if (Build.VERSION.SDK_INT >= 30) {
				windowManager?.defaultDisplay?.rotation ?: Surface.ROTATION_0
			} else {
				@Suppress("DEPRECATION")
				windowManager?.defaultDisplay?.rotation ?: Surface.ROTATION_0
			}
		} catch (_: Throwable) {
			Surface.ROTATION_0
		}
		var gx = event.values[0]
		var gy = event.values[1]
		when (rotation) {
			Surface.ROTATION_90 -> {
				val swap = gx
				gx = -gy
				gy = swap
			}
			Surface.ROTATION_180 -> {
				gx = -gx
				gy = -gy
			}
			Surface.ROTATION_270 -> {
				val swap = gx
				gx = gy
				gy = -swap
			}
		}
		val length = kotlin.math.sqrt(gx * gx + gy * gy)
		if (length < 0.01f) return
		val x = (gx / length).coerceIn(-1f, 1f)
		val y = (-gy / length).coerceIn(-1f, 1f)
		val smoothedX = lastX + (x - lastX) * 0.12f
		val smoothedY = lastY + (y - lastY) * 0.12f
		if (kotlin.math.abs(smoothedX - lastX) + kotlin.math.abs(smoothedY - lastY) < 0.004f) return
		lastX = smoothedX
		lastY = smoothedY
		onLight(smoothedX, smoothedY)
	}

	override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
