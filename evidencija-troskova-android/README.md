# Evidencija Troškova – Android APK

Android WebView aplikacija koja koristi odobreni HTML frontend i identičnu početnu grafiku.

## Build
GitHub Actions workflow **Build Evidencija Troškova APK** pravi debug APK.
Pokreni ga ručno kroz Actions → Build Evidencija Troškova APK → Run workflow.
APK se preuzima iz Artifacts pod nazivom **Evidencija-Troskova-APK**.

Podaci se čuvaju lokalno u WebView localStorage na uređaju. CSV izvoz i JSON backup/restore dostupni su u aplikaciji.
