# Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
-dontwarn retrofit2.**

# Gson
-keep class com.driversreward.app.data.api.** { *; }
-keepclassmembers class com.driversreward.app.data.api.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# Hilt / Dagger
-keep class dagger.hilt.** { *; }
-keep class javax.inject.** { *; }
-dontwarn dagger.hilt.**

# Compose
-dontwarn androidx.compose.**

# Keep data classes used by Gson for serialization
-keep class * implements java.io.Serializable { *; }
