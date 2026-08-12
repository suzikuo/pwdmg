package com.suzikuo.mypwdmg;

import android.content.Intent;
import android.os.Build;
import android.os.Parcelable;

final class AndroidIntentCompat {
    private AndroidIntentCompat() {}

    @SuppressWarnings("deprecation")
    static <T extends Parcelable> T getParcelableExtra(Intent intent, String name, Class<T> type) {
        if (intent == null || name == null || type == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(name, type);
        }
        Parcelable value = intent.getParcelableExtra(name);
        return type.isInstance(value) ? type.cast(value) : null;
    }
}
