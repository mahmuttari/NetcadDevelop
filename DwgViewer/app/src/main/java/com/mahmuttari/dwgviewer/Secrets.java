package com.mahmuttari.dwgviewer;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Küçük sır deposu: Android Keystore'da üretilen AES-256/GCM anahtarıyla şifreler (WebDAV parolaları için).
 * Anahtar ("dwg_webdav") cihazdan çıkmaz; şifreli metin SharedPreferences'ta durur.
 *
 * Biçim (ilk sürüm): Base64(iv[12] + şifreli metin + GCM etiketi), NO_WRAP. Anahtar bulunamaz ya da
 * geçersiz hale gelirse (cihaz sıfırlama, yedekten geri yükleme) decrypt() null döner; çağıran parolayı
 * yeniden ister. Ek kütüphane gerektirmez (security-crypto yerine).
 */
final class Secrets {
    private static final String TAG = "DwgViewer.Secrets";
    private static final String STORE = "AndroidKeyStore";
    private static final String ALIAS = "dwg_webdav";
    private static final int IV_LEN = 12, TAG_BITS = 128;

    private Secrets() { }

    private static synchronized SecretKey key(boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance(STORE);
        ks.load(null);
        if (ks.containsAlias(ALIAS)) {
            KeyStore.Entry e = ks.getEntry(ALIAS, null);
            if (e instanceof KeyStore.SecretKeyEntry) return ((KeyStore.SecretKeyEntry) e).getSecretKey();
            if (!create) return null;
            ks.deleteEntry(ALIAS);
        }
        if (!create) return null;
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, STORE);
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return kg.generateKey();
    }

    /** Şifreler; boş metin boş döner. Keystore hatasında istisna (çağıran kullanıcıya bildirir). */
    static String encrypt(String plain) throws Exception {
        if (plain == null || plain.isEmpty()) return "";
        try {
            return encryptWith(key(true), plain);
        } catch (java.security.InvalidKeyException | java.security.UnrecoverableKeyException e) {
            // anahtar bozulmuş (ör. geri yükleme): yenisi üretilir, eski sırlar zaten çözülemez
            Log.w(TAG, "anahtar yenileniyor: " + e);
            KeyStore ks = KeyStore.getInstance(STORE); ks.load(null); ks.deleteEntry(ALIAS);
            return encryptWith(key(true), plain);
        }
    }
    private static String encryptWith(SecretKey k, String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, k);
        byte[] iv = c.getIV();
        byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, out, 0, iv.length); System.arraycopy(ct, 0, out, iv.length, ct.length);
        return Base64.encodeToString(out, Base64.NO_WRAP);
    }

    /** Çözer; boş girdi boş, çözülemeyen girdi null döner (istisna fırlatmaz). */
    static String decrypt(String enc) {
        if (enc == null || enc.isEmpty()) return "";
        try {
            SecretKey k = key(false);
            if (k == null) return null;
            byte[] all = Base64.decode(enc, Base64.NO_WRAP);
            if (all.length <= IV_LEN) return null;
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(TAG_BITS, all, 0, IV_LEN));
            return new String(c.doFinal(all, IV_LEN, all.length - IV_LEN), StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.w(TAG, "decrypt: " + e);
            return null;
        }
    }
}
