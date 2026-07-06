# Android App / Autofill

This folder is a native Android shell for the shared Vue UI.

- `MainActivity` loads the built Vue app from `front/dist/android`.
- `AndroidPasswordBridge` exposes the same vault API used by the desktop shell to the Vue WebView.
- `AndroidVaultStore` reads/writes the same encrypted `mypwdmg-vault` envelope format as the Python core.
- `PwdAutofillService` is the Android Autofill entry point. It detects username/password/TOTP fields, matches the current web domain or app package, and offers matching accounts.
- Build with Android Studio after running `npm run build` in `front`.

Autofill behavior:

- Empty master password vaults can be unlocked directly by the service and filled from the Autofill suggestion.
- Non-empty master password vaults show an `Unlock My Password` suggestion that opens the app. Unlock the app first, then retry Autofill.
- The Android vault file is stored in the app private directory as `vault.json`.
- Download/import keeps a small local protection backup before replacing the current vault.

The current workspace may not have Java or Gradle installed, so APK compilation can be done in Android Studio or in Gitee.

## Gitee build notes

Use the repository root as the build root. The root `gradlew` delegates into `android/gradlew`, so Gitee can run:

```sh
sh ./gradlew assembleDebug
```

Using `sh ./gradlew` avoids executable-bit issues on Gitee. If Gitee calls `./gradlew` without arguments, the root script defaults to `assembleDebug`.

`android/gradlew` first tries the system `gradle` command. If Gradle is not installed, it checks:

```text
android/gradle/distributions/gradle-8.9-bin.zip
```

If that zip is missing, the script downloads Gradle 8.9. By default it tries these URLs in order:

```text
https://mirrors.cloud.tencent.com/gradle/gradle-8.9-bin.zip
https://repo.huaweicloud.com/gradle/gradle-8.9-bin.zip
https://services.gradle.org/distributions/gradle-8.9-bin.zip
```

Set `GRADLE_DISTRIBUTION_URL` for one custom URL, or `GRADLE_DISTRIBUTION_URLS` for a space-separated fallback list.

If the Gitee runner has no network/DNS, commit `android/gradle/distributions/gradle-8.9-bin.zip` to the repository. In that mode the script cannot download Gradle from any mirror.

The APK output is:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

This project also needs the built Vue files in `front/dist/android/`. Prefer building the front end before the APK step. If the runner cannot build the front end, force-add `front/dist/android/` as an intentional generated artifact.
