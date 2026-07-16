package com.suzikuo.mypwdmg;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

final class AndroidUpdateManager {
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int MAX_MANIFEST_BYTES = 1024 * 1024;
    private static final int MAX_VERIFICATION_RECORD_BYTES = 64 * 1024;
    private static final long MAX_PACKAGE_BYTES = 500L * 1024L * 1024L;
    private static final Pattern SHA256_PATTERN = Pattern.compile("^[a-fA-F0-9]{64}$");
    private static final Pattern GITHUB_RELEASE_ASSET_PATH = Pattern.compile(
        "^/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[^/]+/[^/]+$"
    );
    private static final String VERIFIED_RECORD_SUFFIX = ".verified.json";
    private static final int VERIFIED_RECORD_VERSION = 1;

    private final Activity activity;
    private final File updateDir;

    AndroidUpdateManager(Activity activity) {
        this.activity = activity;
        this.updateDir = new File(activity.getCacheDir(), "updates");
    }

    JSONObject check(String manifestUrl) throws Exception {
        ManifestFetchResult fetched = fetchManifestFromCandidates(normalizeHttpsUrls(manifestUrl));
        JSONObject parsed = parseManifest(fetched.manifest, fetched.url);
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
            assetUrlCandidates(asset),
            asset.getString("sha256"),
            asset.optLong("size", 0),
            asset.getString("fileName"),
            progress
        );
        try {
            verifyApkIdentity(packageFile, update.optString("latestVersion", ""), update.optLong("latestCode", 0));
            writeVerificationRecord(packageFile, update);
        } catch (Exception error) {
            packageFile.delete();
            verificationRecordFile(packageFile).delete();
            throw error;
        }

        return new JSONObject()
            .put("update", update)
            .put("packagePath", packageFile.getAbsolutePath())
            .put("sha256", asset.getString("sha256"))
            .put("size", packageFile.length());
    }

    JSONObject apply(String packagePath) throws Exception {
        File apk = resolveDownloadedApk(packagePath);
        JSONObject verified = readVerificationRecord(apk);
        verifyPackageAgainstRecord(apk, verified);
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

        List<String> urls = collectAssetUrls(asset);
        if (urls.isEmpty()) {
            throw new IllegalArgumentException("Update manifest is missing an Android asset URL");
        }
        String url = urls.get(0);
        String sha256 = asset.optString("sha256", "").trim().toLowerCase(Locale.ROOT);
        if (!SHA256_PATTERN.matcher(sha256).matches()) {
            throw new IllegalArgumentException("Update manifest must include a valid SHA256 for the Android APK");
        }
        long size = asset.optLong("size", 0);
        if (size <= 0 || size > MAX_PACKAGE_BYTES) {
            throw new IllegalArgumentException("Android APK size is invalid");
        }

        String fileName = safeApkName(asset.optString("fileName", fileNameFromUrl(url, version)));
        for (String candidate : urls) {
            validateTrustedGithubReleaseAssetUrl(candidate);
            if (!safeApkName(fileNameFromUrl(candidate, version)).equalsIgnoreCase(fileName)) {
                throw new IllegalArgumentException("Android APK URL and fileName do not match");
            }
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
                .put("urls", new org.json.JSONArray(urls))
                .put("sha256", sha256)
                .put("size", size)
                .put("fileName", fileName));
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

    private File downloadAsset(List<String> urls, String expectedSha256, long expectedSize, String fileName, ProgressCallback progress) throws Exception {
        updateDir.mkdirs();
        File destination = new File(updateDir, safeApkName(fileName));
        if (
            destination.isFile()
                && destination.length() == expectedSize
                && sha256File(destination).equals(expectedSha256)
        ) {
            notifyProgress(progress, "download", destination.length(), expectedSize, "已存在可用安装包");
            return destination;
        }

        File temp = new File(updateDir, destination.getName() + ".tmp");
        Exception lastError = null;
        for (String url : urls) {
            try {
                return downloadAssetFromUrl(url, expectedSha256, expectedSize, destination, temp, progress);
            } catch (Exception error) {
                lastError = error;
                temp.delete();
            }
        }
        throw lastError == null ? new IllegalStateException("APK download failed") : lastError;
    }

    private File downloadAssetFromUrl(
        String url,
        String expectedSha256,
        long expectedSize,
        File destination,
        File temp,
        ProgressCallback progress
    ) throws Exception {
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

    private void writeVerificationRecord(File apk, JSONObject update) throws Exception {
        JSONObject asset = update.getJSONObject("asset");
        JSONObject record = new JSONObject()
            .put("formatVersion", VERIFIED_RECORD_VERSION)
            .put("packageName", activity.getPackageName())
            .put("fileName", apk.getName())
            .put("version", update.optString("latestVersion", ""))
            .put("versionCode", update.optLong("latestCode", 0))
            .put("sha256", asset.getString("sha256").toLowerCase(Locale.ROOT))
            .put("size", asset.getLong("size"));
        byte[] encoded = record.toString().getBytes(StandardCharsets.UTF_8);
        if (encoded.length > MAX_VERIFICATION_RECORD_BYTES) {
            throw new IllegalArgumentException("APK verification record is too large");
        }

        File destination = verificationRecordFile(apk);
        File temp = new File(destination.getPath() + ".tmp");
        try (FileOutputStream output = new FileOutputStream(temp)) {
            output.write(encoded);
            output.getFD().sync();
        }
        if (destination.exists() && !destination.delete()) {
            temp.delete();
            throw new IllegalStateException("Could not replace APK verification record");
        }
        if (!temp.renameTo(destination)) {
            temp.delete();
            throw new IllegalStateException("Could not save APK verification record");
        }
    }

    private JSONObject readVerificationRecord(File apk) throws Exception {
        File recordFile = verificationRecordFile(apk);
        if (!recordFile.isFile()) {
            throw new IllegalArgumentException("APK verification record is missing; download the update again");
        }
        try (InputStream input = new FileInputStream(recordFile)) {
            return new JSONObject(new String(readLimited(input, MAX_VERIFICATION_RECORD_BYTES), StandardCharsets.UTF_8));
        }
    }

    private File verificationRecordFile(File apk) {
        return new File(apk.getParentFile(), apk.getName() + VERIFIED_RECORD_SUFFIX);
    }

    private void verifyPackageAgainstRecord(File apk, JSONObject record) throws Exception {
        if (record.optInt("formatVersion", 0) != VERIFIED_RECORD_VERSION) {
            throw new IllegalArgumentException("APK verification record format is unsupported");
        }
        if (!activity.getPackageName().equals(record.optString("packageName", ""))) {
            throw new IllegalArgumentException("APK verification record belongs to another application");
        }
        if (!apk.getName().equals(record.optString("fileName", ""))) {
            throw new IllegalArgumentException("APK name does not match its verification record");
        }
        String expectedSha256 = record.optString("sha256", "").toLowerCase(Locale.ROOT);
        long expectedSize = record.optLong("size", 0);
        if (!SHA256_PATTERN.matcher(expectedSha256).matches() || expectedSize <= 0 || expectedSize > MAX_PACKAGE_BYTES) {
            throw new IllegalArgumentException("APK verification record is invalid");
        }
        if (apk.length() != expectedSize) {
            throw new IllegalArgumentException("Android APK size verification failed before install");
        }
        if (!sha256File(apk).equals(expectedSha256)) {
            throw new IllegalArgumentException("Android APK SHA256 verification failed before install");
        }
        verifyApkIdentity(apk, record.optString("version", ""), record.optLong("versionCode", 0));
    }

    private void verifyApkIdentity(File apk, String expectedVersion, long expectedVersionCode) throws Exception {
        PackageManager packageManager = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = packageManager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null || !activity.getPackageName().equals(archive.packageName)) {
            throw new IllegalArgumentException("Android APK package name does not match this app");
        }

        long archiveVersionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? archive.getLongVersionCode()
            : archive.versionCode;
        if (archiveVersionCode <= BuildConfig.VERSION_CODE) {
            throw new IllegalArgumentException("Android APK is not newer than the installed app");
        }
        if (expectedVersionCode > 0 && archiveVersionCode != expectedVersionCode) {
            throw new IllegalArgumentException("Android APK versionCode does not match the verified update");
        }
        if (
            expectedVersion != null
                && !expectedVersion.trim().isEmpty()
                && !expectedVersion.trim().equals(String.valueOf(archive.versionName))
        ) {
            throw new IllegalArgumentException("Android APK versionName does not match the verified update");
        }

        PackageInfo installed = packageManager.getPackageInfo(activity.getPackageName(), flags);
        Set<String> installedCertificates = signingCertificateDigests(installed);
        Set<String> archiveCertificates = signingCertificateDigests(archive);
        archiveCertificates.retainAll(installedCertificates);
        if (archiveCertificates.isEmpty()) {
            throw new SecurityException("Android APK signing certificate does not match the installed app");
        }
    }

    private Set<String> signingCertificateDigests(PackageInfo packageInfo) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signingInfo = packageInfo.signingInfo;
            if (signingInfo == null) return new HashSet<>();
            signatures = signingInfo.hasMultipleSigners()
                ? signingInfo.getApkContentsSigners()
                : signingInfo.getSigningCertificateHistory();
        } else {
            signatures = packageInfo.signatures;
        }
        Set<String> result = new HashSet<>();
        if (signatures == null) return result;
        for (Signature signature : signatures) {
            if (signature != null) {
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                result.add(hex(digest.digest(signature.toByteArray())));
            }
        }
        return result;
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

    private ManifestFetchResult fetchManifestFromCandidates(List<String> urls) throws Exception {
        Exception lastError = null;
        for (String url : urls) {
            try {
                return new ManifestFetchResult(url, new JSONObject(fetchText(url, MAX_MANIFEST_BYTES)));
            } catch (Exception error) {
                lastError = error;
            }
        }
        throw lastError == null ? new IllegalStateException("Update manifest request failed") : lastError;
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

    private void validateTrustedGithubReleaseAssetUrl(String value) throws Exception {
        URL url = new URL(normalizeHttpsUrl(value));
        if (
            !"github.com".equalsIgnoreCase(url.getHost())
                || url.getPort() != -1
                || url.getUserInfo() != null
                || url.getQuery() != null
                || url.getRef() != null
                || !GITHUB_RELEASE_ASSET_PATH.matcher(url.getPath()).matches()
        ) {
            throw new IllegalArgumentException("Android update assets must use an official GitHub Release URL");
        }
    }

    private List<String> normalizeHttpsUrls(String value) {
        List<String> result = new ArrayList<>();
        for (String candidate : splitUrlCandidates(value)) {
            String url = normalizeHttpsUrl(candidate);
            if (!result.contains(url)) result.add(url);
        }
        if (result.isEmpty()) {
            throw new IllegalArgumentException("Update URLs must use HTTPS");
        }
        return result;
    }

    private List<String> collectAssetUrls(JSONObject asset) {
        List<String> result = new ArrayList<>();
        org.json.JSONArray array = asset.optJSONArray("urls");
        if (array != null) {
            for (int index = 0; index < array.length(); index += 1) {
                String url = normalizeHttpsUrl(array.optString(index, ""));
                if (!result.contains(url)) result.add(url);
            }
        }
        String url = asset.optString("url", "").trim();
        if (!url.isEmpty()) {
            String normalized = normalizeHttpsUrl(url);
            if (!result.contains(normalized)) result.add(normalized);
        }
        return result;
    }

    private List<String> assetUrlCandidates(JSONObject asset) {
        org.json.JSONArray array = asset.optJSONArray("urls");
        if (array != null && array.length() > 0) return collectAssetUrls(asset);
        List<String> result = new ArrayList<>();
        result.add(normalizeHttpsUrl(asset.optString("url", "")));
        return result;
    }

    private List<String> splitUrlCandidates(String value) {
        List<String> result = new ArrayList<>();
        String[] parts = (value == null ? "" : value).split("[\\s,;]+");
        for (String part : parts) {
            String candidate = part.trim();
            if (!candidate.isEmpty() && !result.contains(candidate)) result.add(candidate);
        }
        return result;
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
        if (!name.toLowerCase(Locale.ROOT).endsWith(".apk")) {
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

    private static final class ManifestFetchResult {
        final String url;
        final JSONObject manifest;

        ManifestFetchResult(String url, JSONObject manifest) {
            this.url = url;
            this.manifest = manifest;
        }
    }
}
