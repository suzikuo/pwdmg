package com.suzikuo.mypwdmg;

import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class QrScannerContractTest {
    private static String source(String relativePath) throws Exception {
        Path root = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        Path path = root.resolve("src/main/" + relativePath);
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
    }

    @Test
    public void nativeCameraScannerIsRemoved() throws Exception {
        Path scannerPath = Paths.get(System.getProperty("user.dir")).toAbsolutePath()
            .resolve("src/main/java/com/suzikuo/mypwdmg/QrScannerController.java");
        assertTrue(Files.notExists(scannerPath));
    }

    @Test
    public void mainActivityUsesTheSystemImagePickerForQrImages() throws Exception {
        String main = source("java/com/suzikuo/mypwdmg/MainActivity.java");
        assertTrue(main.contains("onShowFileChooser"));
        assertTrue(main.contains("QR_IMAGE_PICKER_REQUEST_CODE"));
        assertTrue(main.contains("FileChooserParams.parseResult"));
        assertTrue(main.contains("image/png"));
        assertTrue(main.contains("filePathCallback.onReceiveValue(null)"));
    }

    @Test
    public void manifestKeepsCameraOptionalAndPermissionScoped() throws Exception {
        String manifest = source("AndroidManifest.xml");
        assertTrue(!manifest.contains("android.permission.CAMERA"));
        assertTrue(!manifest.contains("android.hardware.camera.any"));
    }

    @Test
    public void bridgeUsesSingleBoundedConsumableTask() throws Exception {
        String bridge = source("java/com/suzikuo/mypwdmg/AndroidPasswordBridge.java");
        assertTrue(!bridge.contains("startQrScan"));
        assertTrue(!bridge.contains("getQrScanTaskState"));
    }
}
