#!/bin/bash
# RAR çözücülerinin JVM sınaması (tarayıcı sınamalarından ayrı; javac gerekir).
#   - Rar5.java: RAR5 arşivleri (her zaman koşar)
#   - Rar4.java: RAR 2/3/4 katı zinciri — yalnız junrar jar'ı Gradle önbelleğinde bulunursa
# Koşum: tools/test_rar5.sh   → "SONUÇ: N geçti, 0 kaldı"
set -u
cd "$(dirname "$0")/.."
OUT="${TMPDIR:-/tmp}/dwg_rar5_test"
rm -rf "$OUT"; mkdir -p "$OUT"

JUNRAR=$(find "$HOME/.gradle/caches" -name "junrar-*.jar" 2>/dev/null | head -1)
SLF4J=$(find "$HOME/.gradle/caches" -name "slf4j-api-*.jar" 2>/dev/null | head -1)
SRC="app/src/main/java/com/mahmuttari/dwgviewer/Rar5.java tools/rar5/Rar5Test.java tools/rar5/Rar4Bridge.java"
CP=""
if [ -n "$JUNRAR" ] && [ -n "$SLF4J" ]; then
  SRC="$SRC app/src/main/java/com/mahmuttari/dwgviewer/Rar4.java"
  CP="$JUNRAR:$SLF4J"
  echo "junrar: $(basename "$JUNRAR")"
else
  echo "junrar bulunamadı: RAR 2/3/4 denetimleri atlanacak"
fi

javac -nowarn -encoding UTF-8 ${CP:+-cp "$CP"} -d "$OUT" $SRC 2>&1 | grep -v "^Picked up"
java -Dfile.encoding=UTF-8 -Xmx256m -cp "$OUT${CP:+:$CP}" Rar5Test tools/rar5 2>&1 | grep -v "^Picked up" | grep -v "^SLF4J"
