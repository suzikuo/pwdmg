package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Pattern;

final class AndroidUpdateManager {
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int MAX_MANIFEST_BYTES = 1024 * 1024;
    private static final long MAX_PACKAGE_BYTES = 500L * 1024L * 1024L;
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[a-fA-F0-9]{64}$");

    private final Activity activity;
    private final File updateDir;

    AndroidUpdateManager(Activity activity) {
        this.activity = activity;
        this.updateDir = new File(activity.getCacheDir(), "updates");
    }

    JSONObject check(String manifestUrl) throws Exception {
        String url = normalizeHttpsUrl(manifestUrl);
        JSONObject manifest = new JSONObject(fetchText(url, MAX_MANIFEST_BYTES));
        JSONObject parsed = parseManifest(manifest, url);
        int latestCode = parsed.optInt("latestCode", 0);
        boolean newerName = compareVersions(parsed.getString("latestVersion"), BuildConfig.VERSION_NAME) > 0;
        boolean newerCode = latestCode > 0 && latestCode > BuildConfig.VERSION_CODE;
        parsed
            .put("currentVersion", BuildConfig.VERSION_NAME)
            .put("currentCode", BuildConfig.VERSION_CODE)
            .put("updateAvailable", newerName || newerCode)
            .put("canApply", true)
            .put("installPermissionGranted", canRequestPackageInstalls())
            .put("platform", "android");
        return parsed;
    }

    JSONObject download(String manifestUrl) throws Exception {
        return download(manifestUrl, null);
    }

    JSONObject download(String manifestUrl, ProgressCallback progress) throws Exception {
        notifyProgress(progress, "check", 0, 0, "正在检查更新");
        JSONObject update = check(manifestUrl);
        if (!update.optBoolean("updateAvailable")) {
            throw new IllegalStateException("Already on the latest version");
        }

        JSONObject asset = update.getJSONObject("asset");
        notifyProgress(progress, "download", 0, asset.optLong("size", 0), "正在准备下载");
        File packageFile = downloadAsset(
            asset.getString("url"),
            asset.getString("sha256"),
            asset.optLong("size", 0),
            asset.getString("fileName"),
            progress
        );

        return new JSONObject()
            .put("update", update)
            .put("packagePath", packageFile.getAbsolutePath())
            .put("sha256", asset.getString("sha256"))
            .put("size", packageFile.length());
    }

    JSONObject apply(String packagePath) throws Exception {
        File apk = resolveDownloadedApk(packagePath);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName())
            );
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.runOnUiThread(() -> activity.startActivity(settings));
            return new JSONObject()
                .put("packagePath", apk.getAbsolutePath())
                .put("permissionRequired", true)
                .put("installerOpened", false)
                .put("willRestart", false);
        }

        Uri apkUri = UpdateFileProvider.uriFor(activity, apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(apkUri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(intent);
            } catch (ActivityNotFoundException error) {
                throw new RuntimeException(error);
            }
        });

        return new JSONObject()
            .put("packagePath", apk.getAbsolutePath())
            .put("permissionRequired", false)
            .put("installerOpened", true)
            .put("willRestart", false);
    }

    private JSONObject parseManifest(JSONObject manifest, String manifestUrl) throws Exception {
        String version = manifest.optString("version", "").trim();
        if (version.isEmpty()) {
            throw new IllegalArgumentException("Update manifest is missing version");
        }
        int versionCode = manifest.optInt("versionCode", 0);
        JSONObject asset = selectAndroidAsset(manifest);
        if (asset.has("versionCode")) {
            versionCode = asset.optInt("versionCode", versionCode);
        }

        String url = normalizeHttpsUrl(asset.optString("url", ""));
        String sha256 = asset.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
        if (!SHA256_PATTERN.matcher(sha256).matches()) {
            throw new IllegalArgumentException("Update manifest must include a valid SHA256 for the Android APK");
        }
        long size = asset.optLong("size", 0);
        if (size < 0 || size > MAX_PACKAGE_BYTES) {
            throw new IllegalArgumentException("Android APK size is invalid");
        }

        return new JSONObject()
            .put("supported", true)
            .put("manifestUrl", manifestUrl)
            .put("latestVersion", version)
            .put("latestCode", versionCode)
            .put("notes", manifest.optString("notes", ""))
            .put("publishedAt", manifest.optString("publishedAt", ""))
            .put("asset", new JSONObject()
                .put("url", url)
                .put("sha256", sha256)
                .put("size", size)
                .put("fileName", safeApkName(asset.optString("fileName", fileNameFromUrl(url, version)))));
    }

    private JSONObject selectAndroidAsset(JSONObject manifest) throws Exception {
        JSONObject assets = manifest.optJSONObject("assets");
        if (assets != null) {
            JSONObject android = assets.optJSONObject("android");
            if (android != null) return android;
            JSONObject apk = assets.optJSONObject("apk");
            if (apk != null) return apk;
        }
        JSONObject android = manifest.optJSONObject("android");
        if (android != null) return android;
        throw new IllegalArgumentException("Update manifest is missing an Android asset");
    }

    private File downloadAsset(String url, String expectedSha256, long expectedSize, String fileName, ProgressCallback progress) throws Exception {
        updateDir.mkdirs();
        File destination = new File(updateDir, safeApkName(fileName));
        if (destination.isFile() && sha256File(destination).equals(expectedSha256)) {
            notifyProgress(progress, "download", destination.length(), expectedSize, "已存在可用安装包");
            return destination;
        }

        File temp = new File(updateDir, destination.getName() + ".tmp");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long total = 0;

        HttpURLConnection connection = openConnection(url);
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("APK download failed with HTTP " + code);
        }
        long contentLength = connection.getContentLengthLong();
        long limit = expectedSize > 0 ? expectedSize : (contentLength > 0 ? contentLength : MAX_PACKAGE_BYTES);
        long progressTotal = expectedSize > 0 ? expectedSize : (contentLength > 0 ? contentLength : 0);
        if (limit > MAX_PACKAGE_BYTES) {
            throw new IllegalArgumentException("Android APK is too large");
        }

        notifyProgress(progress, "download", 0, progressTotal, "正在下载更新包");
        long lastProgressAt = 0;
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_PACKAGE_BYTES || total > limit + 1024) {
                    throw new IllegalArgumentException("Android APK is larger than expected");
                }
                digest.update(buffer, 0, read);
                output.write(buffer, 0, read);
                long now = System.currentTimeMillis();
                if (now - lastProgressAt > 250) {
                    lastProgressAt = now;
                    notifyProgress(progress, "download", total, progressTotal, "正在下载更新包");
                }
            }
            output.getFD().sync();
        } finally {
            connection.disconnect();
        }

        notifyProgress(progress, "verify", total, progressTotal, "正在校验更新包");
        String actualSha256 = hex(digest.digest());
        if (!actualSha256.equals(expectedSha256)) {
            temp.delete();
            throw new IllegalArgumentException("Android APK SHA256 verification failed");
        }
        if (expectedSize > 0 && total != expectedSize) {
            temp.delete();
            throw new IllegalArgumentException("Android APK size verification failed");
        }
        if (destination.exists() && !destination.delete()) {
            throw new IllegalStateException("Could not replace old APK download");
        }
        if (!temp.renameTo(destination)) {
            throw new IllegalStateException("Could not move APK download into place");
        }
        notifyProgress(progress, "download", destination.length(), expectedSize, "下载完成");
        return destination;
    }

    private void notifyProgress(ProgressCallback progress, String phase, long downloaded, long total, String message) {
        if (progress != null) progress.onProgress(phase, downloaded, total, message);
    }

    private File resolveDownloadedApk(String packagePath) throws Exception {
        File root = updateDir.getCanonicalFile();
        File apk = new File(packagePath).getCanonicalFile();
        if (!apk.getPath().startsWith(root.getPath() + File.separator) || !apk.isFile() || !apk.getName().endsWith(".apk")) {
            throw new IllegalArgumentException("APK must be downloaded by this app before it can be installed");
        }
        return apk;
    }

    private String fetchText(String url, int maxBytes) throws Exception {
        HttpURLConnection connection = openConnection(url);
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IllegalStateException("Update manifest request failed with HTTP " + code);
        }
        try (InputStream input = connection.getInputStream()) {
            byte[] data = readLimited(input, maxBytes);
            return new String(data, "UTF-8");
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection openConnection(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(normalizeHttpsUrl(url)).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("User-Agent", "MyPasswordManager-AndroidUpdater");
        return connection;
    }

    private byte[] readLimited(InputStream input, int maxBytes) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int total = 0;
        int read;
        while ((read = input.read(buffer)) != -1) {
            total += read;
            if (total > maxBytes) {
                throw new IllegalArgumentException("Remote response is too large");
            }
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private boolean canRequestPackageInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity.getPackageManager().canRequestPackageInstalls();
    }

    private String normalizeHttpsUrl(String value) {
        String url = value == null ? "" : value.trim();
        if (!url.startsWith("https://")) {
            throw new IllegalArgumentException("Update URLs must use HTTPS");
        }
        return url;
    }

    private int compareVersions(String left, String right) {
        int[] leftParts = versionParts(left);
        int[] rightParts = versionParts(right);
        for (int i = 0; i < 3; i += 1) {
            if (leftParts[i] > rightParts[i]) return 1;
            if (leftParts[i] < rightParts[i]) return -1;
        }
        return 0;
    }

    private int[] versionParts(String value) {
        String[] parts = (value == null ? "" : value.trim().replaceFirst("^[vV]", "")).split("\\.");
        int[] result = new int[] { 0, 0, 0 };
        for (int i = 0; i < Math.min(3, parts.length); i += 1) {
            try {
                result[i] = Integer.parseInt(parts[i].replaceAll("[^0-9].*$", ""));
            } catch (NumberFormatException ignored) {
                result[i] = 0;
            }
        }
        return result;
    }

    private String safeApkName(String value) {
        String name = value == null ? "" : new File(value).getName().trim();
        name = name.replaceAll("[^A-Za-z0-9._ -]", "_");
        if (!name.endsWith(".apk")) {
            name = (name.isEmpty() ? "MyPasswordAndroid-release" : name) + ".apk";
        }
        return name.length() > 120 ? name.substring(0, 120) : name;
    }

    private String fileNameFromUrl(String url, String version) {
        int index = url.lastIndexOf('/');
        if (index >= 0 && index < url.length() - 1) {
            return url.substring(index + 1);
        }
        return "MyPasswordAndroid-" + version + ".apk";
    }

    private String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[256 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        return hex(digest.digest());
    }

    private String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        }
        return builder.toString();
    }

    interface ProgressCallback {
        void onProgress(String phase, long downloaded, long total, String message);
    }
}
