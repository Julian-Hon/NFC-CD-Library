#include <SPI.h>
#include <Adafruit_PN532.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <TJpg_Decoder.h>

// These pins are printed beside the SPI connector on this ESP32 display.
constexpr uint8_t NFC_SCK = 18;
constexpr uint8_t NFC_MISO = 19;
constexpr uint8_t NFC_MOSI = 23;
constexpr uint8_t NFC_CS = 27;

// This board's TFT_eSPI setup uses HSPI; keep the PN532 on VSPI.
// The same VSPI pins already work in nfc_test.ino.
Adafruit_PN532 nfc(NFC_CS, &SPI);
TFT_eSPI tft = TFT_eSPI();

String serialLine;
String shownUid;
String shownSummary;
unsigned long pendingSince = 0;

constexpr int COVER_X = 30;
constexpr int COVER_Y = 53;
constexpr int COVER_SIZE = 160;

bool tftOutput(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t *bitmap) {
  if (y >= tft.height()) return false;
  tft.pushImage(x, y, w, h, bitmap);
  return true;
}

String fitText(String value, int maxWidth) {
  if (tft.textWidth(value) <= maxWidth) return value;
  while (value.length() && tft.textWidth(value + "...") > maxWidth) {
    value.remove(value.length() - 1);
  }
  return value + "...";
}

void drawFrame(const char *heading) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextWrap(false);
  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString(heading, 12, 10);
  tft.drawFastHLine(12, 35, tft.width() - 24, TFT_DARKGREY);
}

void drawMessage(const char *heading, const String &line1, const String &line2) {
  drawFrame(heading);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(fitText(line1, tft.width() - 24), 12, 73);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.drawString(fitText(line2, tft.width() - 24), 12, 104);
}

void drawCaseChrome() {
  // The pale edge, hinges, and highlights resemble a clear jewel case.
  tft.drawRect(8, 40, 195, 186, TFT_WHITE);
  tft.drawRect(10, 42, 191, 182, TFT_LIGHTGREY);
  tft.drawRect(COVER_X - 2, COVER_Y - 2, COVER_SIZE + 4, COVER_SIZE + 4, TFT_WHITE);
  tft.fillRect(12, 46, 11, 173, 0xC638);
  tft.drawFastVLine(14, 48, 168, TFT_WHITE);
  tft.drawFastVLine(24, 48, 168, TFT_DARKGREY);
  tft.fillRect(12, 56, 13, 13, TFT_LIGHTGREY);
  tft.fillRect(12, 194, 13, 13, TFT_LIGHTGREY);
  tft.drawFastHLine(31, 48, 160, TFT_WHITE);
  tft.drawFastVLine(196, 46, 174, TFT_WHITE);
  tft.drawFastHLine(30, 218, 162, TFT_LIGHTGREY);
}

void drawCoverPlaceholder() {
  tft.fillRect(COVER_X, COVER_Y, COVER_SIZE, COVER_SIZE, 0x39E7);
  tft.fillCircle(110, 133, 53, TFT_LIGHTGREY);
  tft.drawCircle(110, 133, 44, TFT_WHITE);
  tft.drawCircle(110, 133, 35, TFT_DARKGREY);
  tft.fillCircle(110, 133, 11, TFT_DARKGREY);
  tft.fillCircle(110, 133, 4, TFT_BLACK);
  drawCaseChrome();
}

void drawTwoLines(String value, int x, int y, int width) {
  if (tft.textWidth(value) <= width) {
    tft.drawString(value, x, y);
    return;
  }
  int split = value.length();
  while (split > 0 && tft.textWidth(value.substring(0, split)) > width) --split;
  int wordBreak = value.lastIndexOf(' ', split);
  if (wordBreak > 0) split = wordBreak;
  tft.drawString(fitText(value.substring(0, split), width), x, y);
  value = value.substring(split);
  value.trim();
  tft.drawString(fitText(value, width), x, y + 19);
}

void drawAlbum(const String &uid, const String &album,
               const String &artist, int trackCount) {
  drawFrame("DIGITAL CD LIBRARY");
  tft.fillRect(11, 43, 195, 185, TFT_DARKGREY); // Case shadow.
  tft.fillRect(8, 40, 195, 186, 0xBDF7);
  drawCoverPlaceholder();

  const int infoX = 212;
  const int infoWidth = tft.width() - infoX - 8;
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("ALBUM", infoX, 55);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  drawTwoLines(album, infoX, 77, infoWidth);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("ARTIST", infoX, 125);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  drawTwoLines(artist, infoX, 147, infoWidth);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.drawString(String(trackCount) + " tracks", infoX, 194);

  tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
  tft.setTextFont(1);
  tft.drawString(fitText("Tag " + uid, tft.width() - 24), 12, tft.height() - 10);
  tft.setTextFont(2);
}

void receiveCover(const String &line) {
  const String prefix = "NFC_COVER ";
  int separator = line.indexOf(' ', prefix.length());
  if (separator < 0) return;
  String uid = line.substring(prefix.length(), separator);
  int length = line.substring(separator + 1).toInt();
  if (length < 1 || length > 35000) return;

  uint8_t *jpeg = static_cast<uint8_t *>(malloc(length));
  if (!jpeg) {
    uint8_t scratch[64];
    for (int remaining = length; remaining > 0;) {
      size_t count = Serial.readBytes(scratch, min(remaining, 64));
      if (!count) break;
      remaining -= count;
    }
    return;
  }

  size_t received = Serial.readBytes(jpeg, length);
  if (received == static_cast<size_t>(length) && uid == shownUid &&
      shownSummary != "new" && shownSummary != "waiting") {
    if (TJpgDec.drawJpg(COVER_X, COVER_Y, jpeg, length) != JDR_OK) {
      drawCoverPlaceholder();
    } else {
      drawCaseChrome();
    }
  }
  free(jpeg);
}

void handleBridgeLine(const String &line) {
  if (line.startsWith("NFC_COVER ")) {
    receiveCover(line);
    return;
  }
  const String prefix = "NFC_RESULT ";
  if (!line.startsWith(prefix)) return;

  JsonDocument doc;
  if (deserializeJson(doc, line.substring(prefix.length()))) return;

  String uid = doc["uid"] | "";
  if (uid.isEmpty() || uid != shownUid) return; // Ignore an older scan's reply.

  JsonVariant cd = doc["cd"];
  if (cd.isNull()) {
    if (shownSummary != "new") {
      drawMessage("NEW STICKER", "Add this CD on the website", "127.0.0.1:8317 on your computer");
      shownSummary = "new";
    }
    return;
  }

  String album = cd["album"] | "";
  String artist = cd["artist"] | "";
  int trackCount = cd["trackCount"] | 0;
  String summary = album + "\n" + artist + "\n" + String(trackCount);
  if (summary == shownSummary) return;

  drawAlbum(uid, album, artist, trackCount);
  shownSummary = summary;
}

void readBridgeReplies() {
  while (Serial.available()) {
    char character = Serial.read();
    if (character == '\n') {
      serialLine.trim();
      handleBridgeLine(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 1500) {
      serialLine += character;
    } else {
      serialLine = ""; // Discard an invalid oversized response.
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(8000);
  delay(1000);

  pinMode(21, OUTPUT); // Display backlight on this board.
  digitalWrite(21, HIGH);
  tft.init();
  tft.setRotation(1);
  TJpgDec.setJpgScale(1);
  TJpgDec.setSwapBytes(true);
  TJpgDec.setCallback(tftOutput);
  drawMessage("DIGITAL CD LIBRARY", "Starting NFC reader...", "");

  SPI.begin(NFC_SCK, NFC_MISO, NFC_MOSI, NFC_CS);
  nfc.begin();
  if (!nfc.getFirmwareVersion() || !nfc.SAMConfig()) {
    drawMessage("NFC READER ERROR", "Check PN532 wiring", "and its SPI mode switches");
    while (true) delay(1000);
  }

  drawMessage("DIGITAL CD LIBRARY", "Ready to scan a CD", "Run the local bridge on your computer");
  Serial.println("Ready. Hold an NFC sticker near the reader.");
}

void loop() {
  readBridgeReplies();
  if (shownUid.length() && shownSummary.isEmpty() &&
      millis() - pendingSince > 3000) {
    drawMessage("BRIDGE NOT RESPONDING", "Open the local bridge", "on your computer and scan again");
    shownSummary = "waiting";
  }

  uint8_t uid[7];
  uint8_t uidLength = 0;
  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 250)) {
    String uidText;
    for (uint8_t i = 0; i < uidLength; ++i) {
      if (uid[i] < 0x10) uidText += '0';
      uidText += String(uid[i], HEX);
      if (i + 1 < uidLength) uidText += ':';
    }
    uidText.toUpperCase();

    if (uidText != shownUid) {
      shownUid = uidText;
      shownSummary = "";
      pendingSince = millis();
      drawMessage("LOOKING UP CD", "Tag " + uidText, "Checking your local library...");
    }

    Serial.print("Tag detected. UID: ");
    Serial.println(uidText);
    readBridgeReplies();
    delay(700);
  }
}
