package com.mahmuttari.dwgviewer;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.zip.CRC32;

/*
 * RAR5 ARŞİV OKUYUCU — saf Java, dış bağımlılık yok.
 *
 * NEDEN VAR
 *   junrar yalnız RAR 2/3/4 açar; WinRAR 5 ve sonrası varsayılan olarak RAR5 biçiminde yazar
 *   ("Rar!" 1A 07 01 00 imzası). Kullanıcıya gelen arşivlerin çoğu bugün RAR5'tir.
 *
 * NE KAPSAR
 *   - Başlıklar: ana başlık, dosya (2) ve hizmet (3) başlıkları, arşiv sonu (5), şifreleme (4).
 *     Değişken uzunluklu tam sayı (vint), başlık bayrakları, ek alan (extra) kayıtları.
 *   - Sıkıştırma: yöntem 0 (saklanmış) ve 1–5 (RAR 5.0 çözme algoritması, unpack sürümü 0):
 *     Huffman tabloları, LZSS penceresi, eski uzaklık listesi, süzgeçler (delta, E8, E8E9, ARM).
 *   - Katı (solid) arşivler: hedef dosyadan önceki zincir çözülür, penceresi devralınır.
 *   - Adlar UTF-8'dir; RAR'ın UTF-8 olmayan yerel adlar için kullandığı U+FFFE imli kaçış düzeni
 *     (her ham bayt U+E000 + bayt) geri çözülür — Türkçe adlar bozulmaz.
 *   - CRC32 doğrulaması (RAR5 her dosya için saklar): sessiz bozuk çıktı olmaz.
 *
 * NE KAPSAMAZ (açık iletiyle reddedilir)
 *   - Şifreli arşiv / şifreli başlık, çok parçalı (volume) arşivin devam eden dosyaları,
 *     RAR 7.0'ın yeni sıkıştırma sürümü (unpack sürümü > 0).
 *
 * KAYNAK
 *   Algoritma unrar'ın unpack50.cpp / unpack.cpp dosyalarındaki açık kaynak çözücüsünün
 *   davranışıyla birebir aynıdır (bit düzeni, tablo kuruluşu, süzgeç sırası); değişken adları
 *   izlenebilirlik için korunmuştur.
 */
public final class Rar5 {
    private Rar5() { }

    /** Arşiv girdisi (yalnız dosya başlıkları; hizmet başlıkları listeye girmez) */
    public static final class Entry {
        public String name = "";
        public long size;          // açılmış boy
        public long packSize;      // sıkıştırılmış boy
        public boolean dir;
        public long time;          // ms (0 = yok)
        public long crc = -1;      // -1 = yok
        public boolean solid;
        public boolean encrypted;
        public int method;         // 0 saklanmış, 1-5 sıkıştırılmış
        public int version;        // 0 = RAR 5.0 algoritması
        public long winSize = 0x20000;
        public boolean splitBefore, splitAfter;
        long dataPos;
    }

    public static class Rar5Exception extends IOException {
        private static final long serialVersionUID = 1L;
        public Rar5Exception(String m) { super(m); }
    }

    private static final byte[] SIG = { 0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00 };
    /** Bir başlığı tek seferde okumak için yeter; daha büyükse büyütülerek yeniden okunur */
    private static final int HEAD_CHUNK = 0x10000;
    /** Cihaz belleğini korumak için en büyük sözlük; RAR5 kuramsal olarak 4 GB'a kadar izin verir */
    public static final long MAX_WIN = 256L << 20;

    public static boolean isRar5(File f) {
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) { return sigOk(raf); } catch (IOException e) { return false; }
    }
    private static boolean sigOk(RandomAccessFile raf) throws IOException {
        if (raf.length() < 8) return false;
        raf.seek(0);
        byte[] b = new byte[8];
        raf.readFully(b);
        return Arrays.equals(b, SIG);
    }

    // ---------------------------------------------------------------------------------
    // Başlıklar
    // ---------------------------------------------------------------------------------
    /** Bayt dizisi üzerinde imleçli okuyucu (vint / u32 / u64) */
    private static final class Cur {
        final byte[] b; final int len; int pos;
        Cur(byte[] b, int len) { this.b = b; this.len = len; }
        int u8() { if (pos >= len) throw new IllegalStateException("başlık kısa"); return b[pos++] & 0xff; }
        long u32() { long v = (u8()) | ((long) u8() << 8) | ((long) u8() << 16) | ((long) u8() << 24); return v; }
        long vint() {
            long v = 0; int sh = 0;
            while (true) {
                int c = u8();
                v |= ((long) (c & 0x7f)) << sh;
                if ((c & 0x80) == 0) break;
                sh += 7;
                if (sh > 63) throw new IllegalStateException("vint taşması");
            }
            return v;
        }
    }

    /** Ham arşiv: dosya girdileri (sırayla) + arşiv düzeyi bayraklar */
    public static final class Info {
        public final List<Entry> entries = new ArrayList<>();
        public boolean volume;          // çok parçalı arşiv
        public boolean headerEncrypted; // başlıklar şifreli
        public boolean encrypted;       // en az bir girdi şifreli
    }

    public static Info read(File file) throws IOException {
        Info info = new Info();
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            if (!sigOk(raf)) throw new Rar5Exception("RAR5 imzası yok");
            long len = raf.length(), pos = 8;
            while (pos < len) {
                int want = (int) Math.min(HEAD_CHUNK, len - pos);
                byte[] head = new byte[want];
                raf.seek(pos);
                int got = readFully(raf, head);
                if (got < 7) break;
                Cur c = new Cur(head, got);
                long hSize, type, flags, extra = 0, data = 0;
                int hStart;
                try {
                    c.pos = 4;                       // başlık CRC32 (doğrulanmaz: bozuk arşivde de listeyi verebilmek için)
                    hSize = c.vint();
                    hStart = c.pos;
                    type = c.vint();
                    flags = c.vint();
                    if ((flags & 1) != 0) extra = c.vint();
                    if ((flags & 2) != 0) data = c.vint();
                } catch (RuntimeException e) { break; }
                if (hSize <= 0 || hSize > 0x1000000) break;
                long hEnd = hStart + hSize;
                if (hEnd > got) {                     // başlık okunan parçaya sığmadı: büyüterek yeniden oku
                    if (pos + hEnd > len) break;
                    head = new byte[(int) hEnd];
                    raf.seek(pos);
                    got = readFully(raf, head);
                    c = new Cur(head, got);
                    c.pos = hStart;
                    try { c.vint(); c.vint(); if ((flags & 1) != 0) c.vint(); if ((flags & 2) != 0) c.vint(); } catch (RuntimeException e) { break; }
                }
                if (type == 4) { info.headerEncrypted = true; break; }     // şifreli başlık: devamı okunamaz
                if (type == 5) break;                                       // arşiv sonu
                if (type == 1) {
                    try { long af = c.vint(); if ((af & 1) != 0) info.volume = true; } catch (RuntimeException ignored) { }
                } else if (type == 2 || type == 3) {
                    Entry e = parseFile(c, (int) hEnd, (int) extra, flags, data, pos + hEnd);
                    if (e != null) {
                        if (e.encrypted) info.encrypted = true;
                        if (type == 2) info.entries.add(e);
                    }
                }
                pos += hEnd + data;
            }
        }
        return info;
    }

    /** dataPos: başlığın bittiği mutlak konum — veri alanı orada başlar */
    private static Entry parseFile(Cur c, int hEnd, int extraSize, long hFlags, long data, long dataPos) {
        Entry e = new Entry();
        try {
            long fFlags = c.vint();
            e.size = c.vint();
            c.vint();                                   // öznitelikler
            if ((fFlags & 2) != 0) e.time = c.u32() * 1000L;
            if ((fFlags & 4) != 0) e.crc = c.u32();
            long comp = c.vint();
            c.vint();                                   // ana işletim sistemi
            int nameLen = (int) c.vint();
            if (nameLen < 0 || c.pos + nameLen > c.len) return null;
            e.name = decodeName(c.b, c.pos, nameLen);
            c.pos += nameLen;
            e.dir = (fFlags & 1) != 0;
            e.version = (int) (comp & 0x3f);
            e.solid = (comp & 0x40) != 0;
            e.method = (int) ((comp >> 7) & 7);
            e.winSize = e.dir ? 0 : (0x20000L << ((comp >> 10) & 0xf));
            e.packSize = data;
            e.dataPos = dataPos;
            e.splitBefore = (hFlags & 0x0008) != 0;
            e.splitAfter = (hFlags & 0x0010) != 0;
            if (extraSize > 0) {                        // ek alan: 1 = şifreleme kaydı
                int q = hEnd - extraSize;
                while (q < hEnd && q < c.len) {
                    Cur x = new Cur(c.b, c.len); x.pos = q;
                    long rSize = x.vint();
                    if (rSize <= 0) break;
                    int after = x.pos;
                    long rType = x.vint();
                    if (rType == 1) e.encrypted = true;
                    q = (int) (after + rSize);
                }
            }
            return e;
        } catch (RuntimeException ex) { return null; }
    }

    /**
     * Ad çözümü. RAR5 adları UTF-8'dir; UTF-8'e çevrilemeyen yerel adlarda RAR, adın başına U+FFFE
     * koyar ve her ham baytı U+E000 + bayt olarak saklar (unrar'ın "broken UTF-8" düzeni). O düzen
     * geri çözülür, sonuç yine UTF-8 olarak yorumlanır — Linux'ta UTF-8 olmayan yerelde yazılmış
     * Türkçe adlar da doğru görünür.
     */
    static String decodeName(byte[] b, int off, int len) {
        String s = new String(b, off, len, StandardCharsets.UTF_8);
        if (s.indexOf('￾') < 0) return s;
        ByteArrayOutputStream raw = new ByteArrayOutputStream(len);
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            if (cp == 0xFFFE) continue;
            if (cp >= 0xE000 && cp <= 0xE0FF) { raw.write(cp - 0xE000); continue; }
            byte[] u = new String(Character.toChars(cp)).getBytes(StandardCharsets.UTF_8);
            raw.write(u, 0, u.length);
        }
        return new String(raw.toByteArray(), StandardCharsets.UTF_8);
    }

    /** v'yi kapsayan en küçük ikinin kuvveti (en az 128 KB) */
    private static long pow2(long v) {
        long p = 0x20000L;
        while (p < v && p < MAX_WIN) p <<= 1;
        return p;
    }

    private static int readFully(RandomAccessFile raf, byte[] b) throws IOException {
        int n = 0;
        while (n < b.length) { int r = raf.read(b, n, b.length - n); if (r <= 0) break; n += r; }
        return n;
    }

    // ---------------------------------------------------------------------------------
    // Çıkarma
    // ---------------------------------------------------------------------------------
    public static void extract(File file, String entryName, OutputStream out) throws IOException {
        Info info = read(file);
        // Ad karşılaştırması ayraçtan bağımsız: liste '/' ile sunulur, arşiv '\\' taşıyabilir
        String want = entryName == null ? "" : entryName.replace('\\', '/');
        Entry target = null;
        for (Entry e : info.entries) if (e.name.replace('\\', '/').equals(want)) { target = e; break; }
        if (target == null) throw new Rar5Exception("girdi bulunamadı");
        extract(file, info, target, out);
    }

    public static void extract(File file, Info info, Entry target, OutputStream out) throws IOException {
        if (info.headerEncrypted || target.encrypted) throw new Rar5Exception("Şifreli RAR desteklenmiyor");
        if (target.dir) throw new Rar5Exception("girdi bir klasör");
        if (target.splitBefore || target.splitAfter) throw new Rar5Exception("Çok parçalı RAR arşivinde bölünmüş dosya desteklenmiyor");
        if (target.version != 0) throw new Rar5Exception("RAR 7 sıkıştırma sürümü desteklenmiyor; arşivi RAR5 ya da ZIP olarak yeniden sıkıştırın");

        // Katı (solid) zincir: hedeften geriye, katı olmayan ilk veri girdisine kadar
        List<Entry> data = new ArrayList<>();
        for (Entry e : info.entries) if (!e.dir) data.add(e);
        int ti = data.indexOf(target);
        if (ti < 0) throw new Rar5Exception("girdi bulunamadı");
        int start = ti;
        while (start > 0 && data.get(start).solid) start--;
        if (data.get(start).solid)   // zincirin başı bu arşivde yok (çok parçalı arşivin devamı)
            throw new Rar5Exception("Katı (solid) zincirin başlangıcı bu dosyada yok; çok parçalı arşivin ilk parçasıyla birlikte açın");

        /*
         * PENCERE BOYU. Alt sınır arşivin bildirdiği sözlüktür; ancak pencere, bekleyen bir SÜZGEÇ bloğunu
         * da taşıyabilmelidir: süzgeç bloğu yazılmadan önce çözücü pencerede tur atarsa blok verisinin
         * üzerine yazılır ve çıktı bozulur (unrar aynı nedenle pencereyi en az süzgeç bloğunun iki katı
         * ayırır; RAR'da en büyük süzgeç bloğu 0x400000'dir). Bu yüzden pencere, zincirin açılmış toplam
         * boyunu (bir tur atmaya gerek kalmaz) ya da 8 MB'ı — hangisi küçükse — karşılayacak kadar büyütülür.
         */
        long declared = 0x20000L, need = 0;
        for (int i = start; i <= ti; i++) { declared = Math.max(declared, data.get(i).winSize); need += data.get(i).size; }
        long win = Math.max(declared, Math.min(2L * MAX_FILTER_BLOCK, pow2(need + 0x4000)));
        if (win > MAX_WIN) throw new Rar5Exception("Arşivin sözlüğü çok büyük (" + (win >> 20) + " MB); bu cihazda açılamıyor");

        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            Unp unp = null;
            for (int i = start; i <= ti; i++) {
                Entry e = data.get(i);
                boolean last = i == ti;
                OutputStream sink = last ? out : null;      // zincirdeki önceki dosyalar yalnız pencereyi doldurur
                CRC32 crc = last && e.crc >= 0 ? new CRC32() : null;
                if (e.method == 0) {                         // saklanmış: pencereye dokunmaz (unrar UnstoreFile)
                    copyStored(raf, e, sink, crc);
                } else {
                    if (e.version != 0) throw new Rar5Exception("RAR 7 sıkıştırma sürümü desteklenmiyor");
                    if (unp == null) {
                        try { unp = new Unp((int) win); }
                        catch (OutOfMemoryError err) { throw new Rar5Exception("Arşiv için gereken " + (win >> 20) + " MB'lık pencere ayrılamadı"); }
                    }
                    unp.run(raf, e, sink, crc);
                }
                if (crc != null && (crc.getValue() & 0xffffffffL) != (e.crc & 0xffffffffL))
                    throw new Rar5Exception("CRC uyuşmuyor: arşiv bozuk ya da desteklenmeyen sıkıştırma");
            }
        }
    }

    private static void copyStored(RandomAccessFile raf, Entry e, OutputStream out, CRC32 crc) throws IOException {
        raf.seek(e.dataPos);
        byte[] buf = new byte[65536];
        long left = Math.min(e.packSize, e.size);
        while (left > 0) {
            int n = raf.read(buf, 0, (int) Math.min(buf.length, left));
            if (n <= 0) throw new Rar5Exception("arşiv beklenenden kısa");
            if (out != null) out.write(buf, 0, n);
            if (crc != null) crc.update(buf, 0, n);
            left -= n;
        }
    }

    // ---------------------------------------------------------------------------------
    // RAR 5.0 çözücü (unpack50)
    // ---------------------------------------------------------------------------------
    private static final int NC = 306, DC = 64, LDC = 16, RC = 44, BC = 20;
    private static final int HUFF_TABLE_SIZE = NC + DC + RC + LDC;      // 430
    private static final int MAX_QUICK_BITS = 10;
    private static final int MAX_LZ_MATCH = 0x1001;
    private static final int UNPACK_MAX_WRITE = 0x400000;
    private static final int MAX_FILTERS = 8192;
    private static final int MAX_FILTER_BLOCK = 0x400000;
    private static final int IN_SIZE = 0x8000;                           // BitInput::MAX_SIZE

    /** Huffman çözme tablosu (unrar DecodeTable) */
    private static final class Dec {
        int maxNum;
        final int[] decodeLen = new int[16];
        final int[] decodePos = new int[16];
        int quickBits;
        final byte[] quickLen = new byte[1 << MAX_QUICK_BITS];
        final short[] quickNum = new short[1 << MAX_QUICK_BITS];
        final short[] decodeNum;
        Dec(int size) { decodeNum = new short[size]; }
        void reset() {
            maxNum = 0; quickBits = 0;
            Arrays.fill(decodeLen, 0); Arrays.fill(decodePos, 0);
            Arrays.fill(quickLen, (byte) 0); Arrays.fill(quickNum, (short) 0); Arrays.fill(decodeNum, (short) 0);
        }
    }

    private static final class Filter {
        int type = -1;      // -1 yok, 0 delta, 1 E8, 2 E8E9, 3 ARM
        int channels;
        int blockStart;
        int blockLength;
        boolean nextWindow;
    }

    private static final class Unp {
        final byte[] window;
        final int winSize, winMask;
        final byte[] inBuf = new byte[IN_SIZE + 64];     // getbits 4 bayt ileri bakar: kuyrukta sıfır payı
        int inAddr, inBit, readTop, readBorder;
        int unpPtr, wrPtr, writeBorder;
        long writtenFileSize, written, destUnpSize;
        OutputStream out; CRC32 crc;
        final int[] oldDist = new int[4];
        int lastLength;
        boolean tablesRead;
        int blockSize = -1, blockStart, blockBitSize;
        boolean lastBlockInFile, tablePresent;
        final Dec bd = new Dec(BC), ld = new Dec(NC), dd = new Dec(DC), ldd = new Dec(LDC), rd = new Dec(RC);
        final List<Filter> filters = new ArrayList<>();
        final byte[] tableBuf = new byte[HUFF_TABLE_SIZE];
        RandomAccessFile raf;
        long srcLeft;

        Unp(int win) {
            int w = Integer.highestOneBit(Math.max(win, 0x20000));
            if (w < win) w <<= 1;                        // ikinin kuvvetine yuvarla
            window = new byte[w]; winSize = w; winMask = w - 1;
        }

        // ---- bit okuma ----
        int getbits() {
            int bf = ((inBuf[inAddr] & 0xff) << 16) | ((inBuf[inAddr + 1] & 0xff) << 8) | (inBuf[inAddr + 2] & 0xff);
            return (bf >>> (8 - inBit)) & 0xffff;
        }
        long getbits32() {
            long bf = ((long) (inBuf[inAddr] & 0xff) << 24) | ((inBuf[inAddr + 1] & 0xff) << 16)
                    | ((inBuf[inAddr + 2] & 0xff) << 8) | (inBuf[inAddr + 3] & 0xff);
            bf = (bf << inBit) & 0xffffffffL;
            bf |= (inBuf[inAddr + 4] & 0xff) >>> (8 - inBit);
            return bf & 0xffffffffL;
        }
        void addbits(int bits) { bits += inBit; inAddr += bits >> 3; inBit = bits & 7; }

        int srcRead(byte[] b, int off, int len) throws IOException {
            if (srcLeft <= 0) return 0;
            int n = raf.read(b, off, (int) Math.min(len, srcLeft));
            if (n <= 0) return 0;
            srcLeft -= n;
            return n;
        }

        boolean unpReadBuf() throws IOException {
            int dataSize = readTop - inAddr;
            if (dataSize < 0) return false;
            blockSize -= inAddr - blockStart;
            if (inAddr > IN_SIZE / 2) {
                if (dataSize > 0) System.arraycopy(inBuf, inAddr, inBuf, 0, dataSize);
                inAddr = 0; readTop = dataSize;
            } else dataSize = readTop;
            int n = 0;
            if (IN_SIZE != dataSize) n = srcRead(inBuf, dataSize, IN_SIZE - dataSize);
            if (n > 0) readTop += n;
            Arrays.fill(inBuf, readTop, inBuf.length, (byte) 0);
            readBorder = readTop - 30;
            blockStart = inAddr;
            if (blockSize != -1) readBorder = Math.min(readBorder, blockStart + blockSize - 1);
            return true;
        }

        // ---- blok başlığı ve tablolar ----
        boolean readBlockHeader() throws IOException {
            if (inAddr > readTop - 7) if (!unpReadBuf()) return false;
            addbits((8 - inBit) & 7);
            int blockFlags = getbits() >>> 8; addbits(8);
            int byteCount = ((blockFlags >> 3) & 3) + 1;
            if (byteCount == 4) return false;
            blockBitSize = (blockFlags & 7) + 1;
            int savedCheckSum = getbits() >>> 8; addbits(8);
            int bs = 0;
            for (int i = 0; i < byteCount; i++) { bs += (getbits() >>> 8) << (i * 8); addbits(8); }
            blockSize = bs;
            int checkSum = 0x5a ^ blockFlags ^ bs ^ (bs >> 8) ^ (bs >> 16);
            if ((checkSum & 0xff) != savedCheckSum) return false;
            blockStart = inAddr;
            readBorder = Math.min(readBorder, blockStart + blockSize - 1);
            lastBlockInFile = (blockFlags & 0x40) != 0;
            tablePresent = (blockFlags & 0x80) != 0;
            return true;
        }

        boolean readTables() throws IOException {
            if (!tablePresent) return true;
            if (inAddr > readTop - 25) if (!unpReadBuf()) return false;
            byte[] bitLength = new byte[BC];
            for (int i = 0; i < BC; i++) {
                int length = (getbits() >>> 12) & 0xf; addbits(4);
                if (length == 15) {
                    int zeroCount = (getbits() >>> 12) & 0xf; addbits(4);
                    if (zeroCount == 0) bitLength[i] = 15;
                    else {
                        zeroCount += 2;
                        while (zeroCount-- > 0 && i < BC) bitLength[i++] = 0;
                        i--;
                    }
                } else bitLength[i] = (byte) length;
            }
            makeDecodeTables(bitLength, 0, bd, BC);
            byte[] table = tableBuf;
            for (int i = 0; i < HUFF_TABLE_SIZE; ) {
                if (inAddr > readTop - 5) if (!unpReadBuf()) return false;
                int number = decodeNumber(bd);
                if (number < 16) { table[i] = (byte) number; i++; }
                else if (number < 18) {
                    int n;
                    if (number == 16) { n = (getbits() >>> 13) + 3; addbits(3); }
                    else { n = (getbits() >>> 9) + 11; addbits(7); }
                    if (i == 0) return false;
                    while (n-- > 0 && i < HUFF_TABLE_SIZE) { table[i] = table[i - 1]; i++; }
                } else {
                    int n;
                    if (number == 18) { n = (getbits() >>> 13) + 3; addbits(3); }
                    else { n = (getbits() >>> 9) + 11; addbits(7); }
                    while (n-- > 0 && i < HUFF_TABLE_SIZE) table[i++] = 0;
                }
            }
            tablesRead = true;
            if (inAddr > readTop) return false;
            makeDecodeTables(table, 0, ld, NC);
            makeDecodeTables(table, NC, dd, DC);
            makeDecodeTables(table, NC + DC, ldd, LDC);
            makeDecodeTables(table, NC + DC + LDC, rd, RC);
            return true;
        }

        static void makeDecodeTables(byte[] lengthTable, int off, Dec dec, int size) {
            dec.maxNum = size;
            int[] lengthCount = new int[16];
            for (int i = 0; i < size; i++) lengthCount[lengthTable[off + i] & 0xf]++;
            lengthCount[0] = 0;
            Arrays.fill(dec.decodeNum, 0, size, (short) 0);
            dec.decodePos[0] = 0;
            dec.decodeLen[0] = 0;
            long upperLimit = 0;
            for (int i = 1; i < 16; i++) {
                upperLimit += lengthCount[i];
                long leftAligned = upperLimit << (16 - i);
                upperLimit *= 2;
                if (upperLimit > 0xffff) upperLimit = 0x10000;            // taşma koruması (bozuk tablo)
                dec.decodeLen[i] = (int) Math.min(leftAligned, 0x7fffffffL);
                dec.decodePos[i] = dec.decodePos[i - 1] + lengthCount[i - 1];
            }
            int[] copyPos = dec.decodePos.clone();
            for (int i = 0; i < size; i++) {
                int len = lengthTable[off + i] & 0xf;
                if (len != 0) { dec.decodeNum[copyPos[len]] = (short) i; copyPos[len]++; }
            }
            dec.quickBits = size == NC ? MAX_QUICK_BITS : MAX_QUICK_BITS - 3;
            int quickDataSize = 1 << dec.quickBits;
            int curBitLength = 1;
            for (int code = 0; code < quickDataSize; code++) {
                int bitField = code << (16 - dec.quickBits);
                while (curBitLength < 16 && bitField >= dec.decodeLen[curBitLength]) curBitLength++;
                dec.quickLen[code] = (byte) curBitLength;
                int dist = bitField - dec.decodeLen[curBitLength - 1];
                dist >>>= (16 - curBitLength);
                int pos;
                if (curBitLength < 16 && (pos = dec.decodePos[curBitLength] + dist) < size) dec.quickNum[code] = dec.decodeNum[pos];
                else dec.quickNum[code] = 0;
            }
        }

        int decodeNumber(Dec dec) {
            int bitField = getbits() & 0xfffe;
            if (bitField < dec.decodeLen[dec.quickBits]) {
                int code = bitField >>> (16 - dec.quickBits);
                addbits(dec.quickLen[code] & 0xff);
                return dec.quickNum[code] & 0xffff;
            }
            int bits = 15;
            for (int i = dec.quickBits + 1; i < 15; i++) if (bitField < dec.decodeLen[i]) { bits = i; break; }
            addbits(bits);
            int dist = bitField - dec.decodeLen[bits - 1];
            dist >>>= (16 - bits);
            int pos = dec.decodePos[bits] + dist;
            if (pos >= dec.maxNum) pos = 0;
            return dec.decodeNum[pos] & 0xffff;
        }

        // ---- dosya çözme ----
        void run(RandomAccessFile file, Entry e, OutputStream sink, CRC32 c) throws IOException {
            raf = file; raf.seek(e.dataPos); srcLeft = e.packSize;
            out = sink; crc = c; destUnpSize = e.size;
            initFile(e.solid);
            unpack5();
        }

        void initFile(boolean solid) {
            if (!solid) {
                tablesRead = false;
                Arrays.fill(oldDist, 0);
                lastLength = 0;
                unpPtr = 0; wrPtr = 0;
                bd.reset(); ld.reset(); dd.reset(); ldd.reset(); rd.reset();
            }
            filters.clear();
            inAddr = 0; inBit = 0;
            writtenFileSize = 0; written = 0;
            readTop = 0; readBorder = 0;
            blockSize = -1; blockStart = 0; blockBitSize = 0;
            lastBlockInFile = false; tablePresent = false;
            Arrays.fill(inBuf, (byte) 0);
            writeBorder = (wrPtr + Math.min(winSize, UNPACK_MAX_WRITE)) & winMask;
        }

        void unpack5() throws IOException {
            if (!unpReadBuf()) throw new Rar5Exception("arşiv verisi okunamadı");
            if (!readBlockHeader() || !readTables() || !tablesRead) throw new Rar5Exception("bozuk RAR5 verisi (Huffman tablosu)");
            while (true) {
                unpPtr &= winMask;
                if (inAddr >= readBorder) {
                    boolean fileDone = false;
                    while (inAddr > blockStart + blockSize - 1
                            || (inAddr == blockStart + blockSize - 1 && inBit >= blockBitSize)) {
                        if (lastBlockInFile) { fileDone = true; break; }
                        if (!readBlockHeader() || !readTables()) throw new Rar5Exception("bozuk RAR5 verisi (blok başlığı)");
                    }
                    if (fileDone || !unpReadBuf()) break;
                }
                if (((writeBorder - unpPtr) & winMask) < MAX_LZ_MATCH + 3 && writeBorder != unpPtr) {
                    unpWriteBuf();
                    if (writtenFileSize > destUnpSize) return;
                    writeBorder = (unpPtr + Math.min(winSize, UNPACK_MAX_WRITE)) & winMask;
                }
                int mainSlot = decodeNumber(ld);
                if (mainSlot < 256) { window[unpPtr++] = (byte) mainSlot; continue; }
                if (mainSlot >= 262) {
                    int length = slotToLength(mainSlot - 262);
                    long distance = 1;
                    int distSlot = decodeNumber(dd), dBits;
                    if (distSlot < 4) { dBits = 0; distance += distSlot; }
                    else { dBits = distSlot / 2 - 1; distance += ((long) (2 | (distSlot & 1))) << dBits; }
                    if (dBits > 0) {
                        if (dBits >= 4) {
                            if (dBits > 4) { distance += (getbits32() >>> (36 - dBits)) << 4; addbits(dBits - 4); }
                            distance += decodeNumber(ldd);
                        } else { distance += getbits32() >>> (32 - dBits); addbits(dBits); }
                    }
                    if (distance > 0x100) {
                        length++;
                        if (distance > 0x2000) { length++; if (distance > 0x40000) length++; }
                    }
                    if (distance > winSize) throw new Rar5Exception("bozuk RAR5 verisi (uzaklık pencereyi aşıyor)");
                    int d = (int) distance;
                    insertOldDist(d);
                    lastLength = length;
                    copyString(length, d);
                    continue;
                }
                if (mainSlot == 256) { readFilter(); continue; }
                if (mainSlot == 257) { if (lastLength != 0) copyString(lastLength, oldDist[0]); continue; }
                // 258..261: eski uzaklıklardan biri
                int distNum = mainSlot - 258;
                int distance = oldDist[distNum];
                for (int i = distNum; i > 0; i--) oldDist[i] = oldDist[i - 1];
                oldDist[0] = distance;
                int length = slotToLength(decodeNumber(rd));
                lastLength = length;
                copyString(length, distance);
            }
            unpWriteBuf();
        }

        int slotToLength(int slot) {
            int lBits, length = 2;
            if (slot < 8) { lBits = 0; length += slot; }
            else { lBits = slot / 4 - 1; length += (4 | (slot & 3)) << lBits; }
            if (lBits > 0) { length += getbits() >>> (16 - lBits); addbits(lBits); }
            return length;
        }

        void insertOldDist(int d) { oldDist[3] = oldDist[2]; oldDist[2] = oldDist[1]; oldDist[1] = oldDist[0]; oldDist[0] = d; }

        void copyString(int length, int distance) {
            int srcPtr = unpPtr - distance;
            if (srcPtr >= 0 && srcPtr < winSize - MAX_LZ_MATCH && unpPtr < winSize - MAX_LZ_MATCH) {
                int s = srcPtr, d = unpPtr;
                for (int i = 0; i < length; i++) window[d++] = window[s++];
                unpPtr += length;
            } else {
                while (length-- > 0) { window[unpPtr] = window[srcPtr++ & winMask]; unpPtr = (unpPtr + 1) & winMask; }
            }
        }

        // ---- süzgeçler ----
        int readFilterData() {
            int byteCount = (getbits() >>> 14) + 1; addbits(2);
            int data = 0;
            for (int i = 0; i < byteCount; i++) { data += (getbits() >>> 8) << (i * 8); addbits(8); }
            return data;
        }
        void readFilter() throws IOException {
            if (inAddr > readTop - 16) if (!unpReadBuf()) throw new Rar5Exception("arşiv verisi kısa (süzgeç)");
            Filter f = new Filter();
            int blockStartRel = readFilterData();
            f.blockLength = readFilterData();
            if (f.blockLength > MAX_FILTER_BLOCK || f.blockLength < 0) f.blockLength = 0;
            f.type = getbits() >>> 13; addbits(3);
            if (f.type == 0) { f.channels = (getbits() >>> 11) + 1; addbits(5); }
            if (filters.size() >= MAX_FILTERS) { unpWriteBuf(); if (filters.size() >= MAX_FILTERS) filters.clear(); }
            f.nextWindow = wrPtr != unpPtr && ((wrPtr - unpPtr) & winMask) <= blockStartRel;
            f.blockStart = (blockStartRel + unpPtr) & winMask;
            filters.add(f);
        }

        byte[] applyFilter(byte[] data, int dataSize, Filter flt) {
            switch (flt.type) {
                case 1: case 2: {                                   // E8 / E8E9 (x86 çağrı adresleri)
                    long fileOffset = writtenFileSize;
                    final int fileSize = 0x1000000;
                    int cmp2 = flt.type == 2 ? 0xe9 : 0xe8;
                    for (int curPos = 0; curPos + 4 < dataSize; ) {
                        int curByte = data[curPos] & 0xff;
                        curPos++;
                        if (curByte == 0xe8 || curByte == cmp2) {
                            int offset = (int) ((fileOffset + curPos) % fileSize);
                            int addr = rawGet4(data, curPos);
                            if ((addr & 0x80000000) != 0) {
                                if (((addr + offset) & 0x80000000) == 0) rawPut4(data, curPos, addr + fileSize);
                            } else {
                                if (((addr - fileSize) & 0x80000000) != 0) rawPut4(data, curPos, addr - offset);
                            }
                            curPos += 4;
                        }
                    }
                    return data;
                }
                case 3: {                                           // ARM dallanma adresleri
                    long fileOffset = writtenFileSize;
                    for (int curPos = 0; curPos + 3 < dataSize; curPos += 4) {
                        if ((data[curPos + 3] & 0xff) == 0xeb) {
                            int off = (data[curPos] & 0xff) + ((data[curPos + 1] & 0xff) << 8) + ((data[curPos + 2] & 0xff) << 16);
                            off -= (int) ((fileOffset + curPos) / 4);
                            data[curPos] = (byte) off;
                            data[curPos + 1] = (byte) (off >> 8);
                            data[curPos + 2] = (byte) (off >> 16);
                        }
                    }
                    return data;
                }
                case 0: {                                           // delta (kanallara ayrılmış bayt akışı)
                    int channels = flt.channels, srcPos = 0;
                    byte[] dst = new byte[dataSize];
                    for (int ch = 0; ch < channels; ch++) {
                        byte prev = 0;
                        for (int destPos = ch; destPos < dataSize; destPos += channels) {
                            prev = (byte) (prev - data[srcPos++]);
                            dst[destPos] = prev;
                        }
                    }
                    return dst;
                }
                default: return null;
            }
        }
        static int rawGet4(byte[] b, int p) {
            return (b[p] & 0xff) | ((b[p + 1] & 0xff) << 8) | ((b[p + 2] & 0xff) << 16) | ((b[p + 3] & 0xff) << 24);
        }
        static void rawPut4(byte[] b, int p, int v) {
            b[p] = (byte) v; b[p + 1] = (byte) (v >> 8); b[p + 2] = (byte) (v >> 16); b[p + 3] = (byte) (v >> 24);
        }

        // ---- çıkışa yazma ----
        void unpWrite(byte[] b, int off, int len) throws IOException {
            long left = destUnpSize - written;
            if (left <= 0 || len <= 0) return;
            int n = (int) Math.min(len, left);
            if (out != null) out.write(b, off, n);
            if (crc != null) crc.update(b, off, n);
            written += n;
        }
        void unpWriteData(byte[] w, int off, int size) throws IOException {
            if (writtenFileSize >= destUnpSize) return;
            long leftToWrite = destUnpSize - writtenFileSize;
            int writeSize = (int) Math.min(size, leftToWrite);
            unpWrite(w, off, writeSize);
            writtenFileSize += size;
        }
        void unpWriteArea(int startPtr, int endPtr) throws IOException {
            if (endPtr < startPtr) { unpWriteData(window, startPtr, winSize - startPtr); unpWriteData(window, 0, endPtr); }
            else unpWriteData(window, startPtr, endPtr - startPtr);
        }
        void unpWriteBuf() throws IOException {
            int writtenBorder = wrPtr;
            int fullWriteSize = (unpPtr - writtenBorder) & winMask;
            int writeSizeLeft = fullWriteSize;
            for (int i = 0; i < filters.size(); i++) {
                Filter flt = filters.get(i);
                if (flt.type < 0) continue;
                if (flt.nextWindow) {
                    if (((flt.blockStart - wrPtr) & winMask) <= fullWriteSize) flt.nextWindow = false;
                    continue;
                }
                int bStart = flt.blockStart, bLen = flt.blockLength;
                if (((bStart - writtenBorder) & winMask) < writeSizeLeft) {
                    if (writtenBorder != bStart) {
                        unpWriteArea(writtenBorder, bStart);
                        writtenBorder = bStart;
                        writeSizeLeft = (unpPtr - writtenBorder) & winMask;
                    }
                    if (bLen <= writeSizeLeft) {
                        if (bLen > 0) {
                            int bEnd = (bStart + bLen) & winMask;
                            byte[] mem = new byte[bLen];
                            if (bStart < bEnd || bEnd == 0) System.arraycopy(window, bStart, mem, 0, bLen);
                            else {
                                int first = winSize - bStart;
                                System.arraycopy(window, bStart, mem, 0, first);
                                System.arraycopy(window, 0, mem, first, bEnd);
                            }
                            byte[] outMem = applyFilter(mem, bLen, flt);
                            flt.type = -1;
                            if (outMem != null) unpWrite(outMem, 0, bLen);
                            writtenFileSize += bLen;
                            writtenBorder = bEnd;
                            writeSizeLeft = (unpPtr - writtenBorder) & winMask;
                        }
                    } else {
                        wrPtr = writtenBorder;
                        for (int j = i; j < filters.size(); j++) { Filter f2 = filters.get(j); if (f2.type >= 0) f2.nextWindow = false; }
                        return;
                    }
                }
            }
            unpWriteArea(writtenBorder, unpPtr);
            wrPtr = unpPtr;
        }
    }
}
