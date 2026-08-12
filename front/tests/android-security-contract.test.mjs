import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const mainSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/MainActivity.java', import.meta.url), 'utf8')
const pickerSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AutofillPickerActivity.java', import.meta.url), 'utf8')
const autofillServiceSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/PwdAutofillService.java', import.meta.url), 'utf8')
const passkeySource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/PasskeyCompletionActivity.java', import.meta.url), 'utf8')
const compatSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AndroidIntentCompat.java', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')

test('all Android surfaces that present vault secrets block screenshots and screen capture', () => {
  assert.match(mainSource, /addFlags\(WindowManager\.LayoutParams\.FLAG_SECURE\)/)
  assert.match(pickerSource, /WindowManager\.LayoutParams\.FLAG_DIM_BEHIND \| WindowManager\.LayoutParams\.FLAG_SECURE/)
  assert.match(passkeySource, /WindowManager\.LayoutParams\.FLAG_SECURE/)
})

test('Android keeps the native session across ordinary Activity stops', () => {
  assert.match(mainSource, /isChangingConfigurations\(\) \|\| !isFinishing\(\)/)
  assert.match(mainSource, /Only clear the native session when this Activity is actually finishing/)
})

test('Android safe exit still clears the native session explicitly', () => {
  const bridgeSource = readFileSync(new URL('../../android/app/src/main/java/com/suzikuo/mypwdmg/AndroidPasswordBridge.java', import.meta.url), 'utf8')
  assert.match(bridgeSource, /public String safeExit\(\) \{\s*store\.lock\(\);/)
})

test('Android Autofill intents reuse MainActivity and refresh the latest request', () => {
  assert.match(autofillServiceSource, /FLAG_ACTIVITY_CLEAR_TOP/)
  assert.match(autofillServiceSource, /FLAG_ACTIVITY_SINGLE_TOP/)
  assert.match(mainSource, /protected void onNewIntent\(Intent intent\)/)
  assert.match(mainSource, /setIntent\(intent\)/)
  assert.match(mainSource, /EXTRA_ASSIST_STRUCTURE/)
  assert.match(mainSource, /__mypwdmgHandleNativeAutofillIntent/)
  assert.match(appSource, /__mypwdmgHandleNativeAutofillIntent = \(\) =>/)
  assert.match(appSource, /loadAndroidAutofillLaunchContext\(\)/)
})

test('Parcelable extras use the typed Android 13 API with a bounded compatibility fallback', () => {
  assert.match(compatSource, /Build\.VERSION_CODES\.TIRAMISU/)
  assert.match(compatSource, /intent\.getParcelableExtra\(name, type\)/)
  assert.match(compatSource, /type\.isInstance\(value\)/)
  assert.match(mainSource, /AndroidIntentCompat\.getParcelableExtra/)
  assert.match(pickerSource, /AndroidIntentCompat\.getParcelableExtra/)
})

test('WebView does not call deprecated file URL cross-origin toggles', () => {
  assert.doesNotMatch(mainSource, /setAllowFileAccessFromFileURLs/)
  assert.doesNotMatch(mainSource, /setAllowUniversalAccessFromFileURLs/)
})

test('Android WebView logs redact URL paths, queries, and fragments', () => {
  assert.match(mainSource, /safeUriLabel\(Uri\.parse\(url\)\)/)
  assert.match(mainSource, /host=\" \+ safeUriLabel\(request\.getUrl\(\)\)/)
  assert.doesNotMatch(mainSource, /WebView page loaded: \" \+ url/)
  assert.doesNotMatch(mainSource, /url=\" \+ request\.getUrl\(\)/)
})
