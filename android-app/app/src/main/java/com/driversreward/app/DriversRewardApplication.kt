package com.driversreward.app

import android.app.Application
import com.driversreward.app.util.RewardWindowNotifier
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class DriversRewardApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        RewardWindowNotifier.createNotificationChannel(this)
        RewardWindowNotifier.schedule(this)
    }
}
