plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "rs.biokutak.prizebox"
    compileSdk = 35
    defaultConfig {
        applicationId = "rs.biokutak.prizebox"
        minSdk = 23
        targetSdk = 28
        versionCode = 1
        versionName = "1.0.0"
    }
}
