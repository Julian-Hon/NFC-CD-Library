#include <SPI.h>
#include <Adafruit_PN532.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>

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

void drawAlbum(const String &uid, const String &album,
               const String &artist, int trackCount) {
  drawFrame("DIGITAL CD LIBRARY");

  // A simple disc graphic keeps this screen useful without downloading art.
  const int discX = 75;
  const int discY = 125;
  tft.fillCircle(discX, discY, 63, TFT_LIGHTGREY);
  tft.drawCircle(discX, discY, 55, TFT_WHITE);
  tft.drawCircle(discX, discY, 44, TFT_DARKGREY);
  tft.fillCircle(discX, discY, 14, TFT_DARKGREY);
  tft.fillCircle(discX, discY, 5, TFT_BLACK);

  const int infoX = 153;
  const int infoWidth = tft.width() - infoX - 12;
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("ALBUM", infoX, 61);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(fitText(album, infoWidth), infoX, 84);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("ARTIST", infoX, 119);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(fitText(artist, infoWidth), infoX, 142);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.drawString(String(trackCount) + " tracks", infoX, 179);

  tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
  tft.drawString(fitText("Tag " + uid, tft.width() - 24), 12, tft.height() - 25);
}

void handleBridgeLine(const String &line) {
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
  delay(1000);

  pinMode(21, OUTPUT); // Display backlight on this board.
  digitalWrite(21, HIGH);
  tft.init();
  tft.setRotation(1);
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
