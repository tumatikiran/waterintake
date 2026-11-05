// Builds a debug APK with the Android project's Gradle wrapper (gradlew on macOS/Linux, gradlew.bat on Windows).
// Needs JDK 21 and the Android SDK (Android Studio installs both). Run `npm run android:apk`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'gradlew.bat' : './gradlew', ['assembleDebug'], { cwd: 'android', stdio: 'inherit', shell: windows });
const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
if (result.status === 0 && existsSync(apk)) console.log(`\nAPK ready: ${apk}`);
process.exit(result.status ?? 1);
