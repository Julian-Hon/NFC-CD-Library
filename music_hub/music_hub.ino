#include <SPI.h>
#include <Adafruit_PN532.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <TJpg_Decoder.h>
#include <XPT2046_Bitbang.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include "secrets.h"

// These pins are printed beside the SPI connector on this ESP32 display.
constexpr uint8_t NFC_SCK = 18;
constexpr uint8_t NFC_MISO = 19;
constexpr uint8_t NFC_MOSI = 23;
constexpr uint8_t NFC_CS = 27;
constexpr uint8_t TOUCH_MOSI = 32;
constexpr uint8_t TOUCH_MISO = 39;
constexpr uint8_t TOUCH_SCK = 25;
constexpr uint8_t TOUCH_CS = 33;

// This board's TFT_eSPI setup uses HSPI; keep the PN532 on VSPI.
// The same VSPI pins already work in nfc_test.ino.
Adafruit_PN532 nfc(NFC_CS, &SPI);
TFT_eSPI tft = TFT_eSPI();
XPT2046_Bitbang touchscreen(TOUCH_MOSI, TOUCH_MISO, TOUCH_SCK, TOUCH_CS);
Preferences preferences;

enum class Mode { Calibration, Home, Listening, Library };
Mode mode = Mode::Calibration;

struct StoredTouchCalibration {
  int rawXLeft;
  int rawXRight;
  int rawYTop;
  int rawYBottom;
  bool swapAxes;
};

StoredTouchCalibration touchCal;
TouchPoint calibrationSamples[3];
int calibrationStep = 0;
bool wasTouching = false;
unsigned long lastTouchPoll = 0;
bool nfcReady = false;
bool filesystemReady = false;
unsigned long lastNfcPoll = 0;

struct TrackInfo {
  String song;
  String artist;
  String album;
  String imageUrl;
  bool nowPlaying;
};

TrackInfo lastNowPlayingTrack;
TrackInfo displayedTrack;
bool hasLastNowPlayingTrack = false;
bool hasDisplayedTrack = false;
unsigned long lastTrackPoll = 0;
unsigned long lastWiFiAttempt = 0;

void drawListeningScreen(const TrackInfo &track);
void getCurrentSong();
void enterMode(Mode next);

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

void drawHomeButton() {
  tft.fillRoundRect(255, 4, 59, 27, 5, TFT_DARKGREY);
  tft.drawRoundRect(255, 4, 59, 27, 5, TFT_WHITE);
  tft.setTextFont(2);
  tft.setTextSize(1);
  tft.setTextDatum(MC_DATUM);
  tft.setTextColor(TFT_WHITE, TFT_DARKGREY);
  tft.drawString("HOME", 284, 17);
  tft.setTextDatum(TL_DATUM);
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
  if (mode == Mode::Library || mode == Mode::Listening) drawHomeButton();
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
  Serial.printf("Cover received %u/%d bytes\n", static_cast<unsigned>(received), length);
  if (received == static_cast<size_t>(length) && mode == Mode::Library && uid == shownUid &&
      shownSummary != "new" && shownSummary != "waiting") {
    JRESULT result = TJpgDec.drawJpg(COVER_X, COVER_Y, jpeg, length);
    Serial.printf("JPEG decode result %d\n", static_cast<int>(result));
    if (result != JDR_OK) {
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
  if (mode != Mode::Library) return;

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

bool loadTouchCalibration() {
  preferences.begin("touch-cal", true);
  bool ready = preferences.getBool("ready", false);
  touchCal.rawXLeft = preferences.getInt("xl", 0);
  touchCal.rawXRight = preferences.getInt("xr", 0);
  touchCal.rawYTop = preferences.getInt("yt", 0);
  touchCal.rawYBottom = preferences.getInt("yb", 0);
  touchCal.swapAxes = preferences.getBool("swap", false);
  preferences.end();
  return ready && abs(touchCal.rawXRight - touchCal.rawXLeft) > 800 &&
         abs(touchCal.rawYBottom - touchCal.rawYTop) > 800;
}

void saveTouchCalibration() {
  preferences.begin("touch-cal", false);
  preferences.putInt("xl", touchCal.rawXLeft);
  preferences.putInt("xr", touchCal.rawXRight);
  preferences.putInt("yt", touchCal.rawYTop);
  preferences.putInt("yb", touchCal.rawYBottom);
  preferences.putBool("swap", touchCal.swapAxes);
  preferences.putBool("ready", true);
  preferences.end();
}

void drawCalibration() {
  static const int targets[3][2] = {{30, 55}, {290, 55}, {30, 205}};
  static const char *labels[3] = {"TOP LEFT", "TOP RIGHT", "BOTTOM LEFT"};
  drawFrame("CALIBRATE TOUCH");
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString("Tap the cross, then lift your finger", 12, 98);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.drawString(String(calibrationStep + 1) + "/3  " + labels[calibrationStep], 12, 124);
  int x = targets[calibrationStep][0];
  int y = targets[calibrationStep][1];
  tft.drawCircle(x, y, 14, TFT_CYAN);
  tft.drawFastHLine(x - 20, y, 41, TFT_WHITE);
  tft.drawFastVLine(x, y - 20, 41, TFT_WHITE);
}

void drawHome() {
  drawFrame("MUSIC HUB");
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.drawString("Choose a mode", 16, 48);
  tft.fillRoundRect(28, 72, 264, 58, 9, 0x0471);
  tft.drawRoundRect(28, 72, 264, 58, 9, TFT_CYAN);
  tft.fillRoundRect(28, 143, 264, 58, 9, 0x4208);
  tft.drawRoundRect(28, 143, 264, 58, 9, TFT_LIGHTGREY);
  tft.setTextDatum(MC_DATUM);
  tft.setTextFont(4);
  tft.setTextColor(TFT_WHITE, 0x0471);
  tft.drawString("Listening", 160, 101);
  tft.setTextColor(TFT_WHITE, 0x4208);
  tft.drawString("CD Library", 160, 172);
  tft.setTextFont(2);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);
  tft.drawString("Calibrate touch", 204, 217);
}

int mapTouchAxis(int raw, int firstRaw, int secondRaw,
                 int firstPixel, int secondPixel, int maximum) {
  long scaled = firstPixel + (static_cast<long>(raw - firstRaw) *
                               (secondPixel - firstPixel)) /
                              (secondRaw - firstRaw);
  return constrain(static_cast<int>(scaled), 0, maximum);
}

void finishCalibration() {
  const TouchPoint &topLeft = calibrationSamples[0];
  const TouchPoint &topRight = calibrationSamples[1];
  const TouchPoint &bottomLeft = calibrationSamples[2];
  touchCal.swapAxes = abs(static_cast<int>(topRight.yRaw) - topLeft.yRaw) >
                      abs(static_cast<int>(topRight.xRaw) - topLeft.xRaw);
  touchCal.rawXLeft = touchCal.swapAxes ? topLeft.yRaw : topLeft.xRaw;
  touchCal.rawXRight = touchCal.swapAxes ? topRight.yRaw : topRight.xRaw;
  touchCal.rawYTop = touchCal.swapAxes ? topLeft.xRaw : topLeft.yRaw;
  touchCal.rawYBottom = touchCal.swapAxes ? bottomLeft.xRaw : bottomLeft.yRaw;

  if (abs(touchCal.rawXRight - touchCal.rawXLeft) < 800 ||
      abs(touchCal.rawYBottom - touchCal.rawYTop) < 800) {
    Serial.println("Touch calibration points too close; starting over");
    calibrationStep = 0;
    drawCalibration();
    return;
  }
  saveTouchCalibration();
  Serial.printf("Touch calibrated: x %d..%d, y %d..%d, swap %d\n",
                touchCal.rawXLeft, touchCal.rawXRight,
                touchCal.rawYTop, touchCal.rawYBottom, touchCal.swapAxes);
  enterMode(Mode::Home);
}

void handleTouch(const TouchPoint &touch) {
  if (mode == Mode::Calibration) {
    calibrationSamples[calibrationStep] = touch;
    Serial.printf("Touch target %d: raw %u,%u pressure %u\n",
                  calibrationStep + 1, touch.xRaw, touch.yRaw, touch.zRaw);
    ++calibrationStep;
    if (calibrationStep == 3) finishCalibration();
    else drawCalibration();
    return;
  }

  int rawX = touchCal.swapAxes ? touch.yRaw : touch.xRaw;
  int rawY = touchCal.swapAxes ? touch.xRaw : touch.yRaw;
  int x = mapTouchAxis(rawX, touchCal.rawXLeft, touchCal.rawXRight, 30, 290, 319);
  int y = mapTouchAxis(rawY, touchCal.rawYTop, touchCal.rawYBottom, 55, 205, 239);
  Serial.printf("Touch: %d,%d (raw %u,%u)\n", x, y, touch.xRaw, touch.yRaw);

  if (mode == Mode::Home) {
    if (x >= 28 && x <= 292 && y >= 72 && y <= 130) enterMode(Mode::Listening);
    else if (x >= 28 && x <= 292 && y >= 143 && y <= 201) enterMode(Mode::Library);
    else if (x >= 190 && y >= 208) enterMode(Mode::Calibration);
  } else if (x >= 250 && y <= 36) {
    enterMode(Mode::Home);
  }
}

void pollTouch() {
  if (millis() - lastTouchPoll < 60) return;
  lastTouchPoll = millis();
  TouchPoint touch = touchscreen.getTouch();
  digitalWrite(TOUCH_CS, HIGH); // Some library versions leave CS low after an empty read.
  bool pressed = touch.zRaw >= 300;
  if (pressed && !wasTouching) handleTouch(touch);
  wasTouching = pressed;
}

void enterMode(Mode next) {
  mode = next;
  if (mode == Mode::Calibration) {
    calibrationStep = 0;
    drawCalibration();
  } else if (mode == Mode::Home) {
    drawHome();
  } else if (mode == Mode::Library) {
    shownUid = "";
    shownSummary = "";
    if (nfcReady) drawMessage("DIGITAL CD LIBRARY", "Ready to scan a CD", "Keep the USB bridge running");
    else drawMessage("NFC READER ERROR", "Check PN532 wiring", "and its SPI mode switches");
    Serial.println("NFC_MODE_READY");
  } else {
    if (hasDisplayedTrack) drawListeningScreen(displayedTrack);
    else drawMessage("LISTENING", "Connecting to Last.fm...", "");
    if (WiFi.status() != WL_CONNECTED) {
      WiFi.mode(WIFI_STA);
      if (WIFI_PASSWORD[0] == '\0') WiFi.begin(WIFI_SSID);
      else WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      lastWiFiAttempt = millis();
    }
    lastTrackPoll = millis() - 20000UL;
  }
}

String pickImageUrl(JsonArray images) {
  for (const char *size : {"extralarge", "large", "medium"}) {
    for (JsonObject image : images) {
      const char *imageSize = image["size"] | "";
      const char *url = image["#text"] | "";
      if (strcmp(imageSize, size) == 0 && url[0]) return String(url);
    }
  }
  return "";
}

bool downloadImage(const String &url) {
  if (!filesystemReady) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if (!http.begin(client, url)) return false;
  int response = http.GET();
  if (response != HTTP_CODE_OK) {
    Serial.printf("Image HTTP status: %d\n", response);
    http.end();
    return false;
  }
  File file = LittleFS.open("/cover.jpg", "w");
  if (!file) {
    http.end();
    return false;
  }
  int bytes = http.writeToStream(&file);
  file.close();
  http.end();
  if (bytes <= 0) LittleFS.remove("/cover.jpg");
  return bytes > 0;
}

void drawListeningScreen(const TrackInfo &track) {
  drawFrame("LISTENING");
  tft.setTextFont(1);
  tft.setTextDatum(TC_DATUM);
  tft.setTextColor(track.nowPlaying ? TFT_GREEN : TFT_LIGHTGREY, TFT_BLACK);
  tft.drawString(track.nowPlaying ? "NOW PLAYING" : "LAST PLAYED", 160, 41);

  bool artDrawn = false;
  if (filesystemReady && LittleFS.exists("/cover.jpg")) {
    uint16_t width = 0, height = 0;
    TJpgDec.getFsJpgSize(&width, &height, "/cover.jpg", LittleFS);
    if (width && height) {
      uint8_t scale = 1;
      while (scale < 8 && (width / scale > 110 || height / scale > 100)) scale *= 2;
      TJpgDec.setJpgScale(scale);
      TJpgDec.drawFsJpg((320 - (width + scale - 1) / scale) / 2,
                        57, "/cover.jpg", LittleFS);
      artDrawn = true;
    }
  }
  if (!artDrawn) tft.drawRect(105, 57, 110, 100, TFT_DARKGREY);
  tft.setTextSize(2);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.drawString(fitText(track.song, 300), 160, 166);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString(fitText(track.artist, 300), 160, 191);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.drawString(fitText(track.album, 300), 160, 216);
  tft.setTextSize(1);
  tft.setTextFont(2);
  tft.setTextDatum(TL_DATUM);
  TJpgDec.setJpgScale(1);
}

void getCurrentSong() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  String url = "https://ws.audioscrobbler.com/2.0/"
               "?method=user.getrecenttracks&user=" + String(LASTFM_USER) +
               "&api_key=" + String(LASTFM_KEY) + "&limit=1&format=json";
  if (!http.begin(client, url)) return;
  int response = http.GET();
  if (response != HTTP_CODE_OK) {
    Serial.printf("Last.fm HTTP status: %d\n", response);
    http.end();
    return;
  }
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, http.getStream());
  http.end();
  if (error) {
    Serial.printf("Last.fm JSON error: %s\n", error.c_str());
    return;
  }
  JsonVariant track = doc["recenttracks"]["track"][0];
  if (track.isNull()) return;
  TrackInfo current;
  current.song = track["name"] | "Unknown";
  current.artist = track["artist"]["#text"] | "Unknown";
  current.album = track["album"]["#text"] | "Unknown";
  String playing = track["@attr"]["nowplaying"] | "false";
  current.nowPlaying = playing == "true";
  current.imageUrl = pickImageUrl(track["image"].as<JsonArray>());
  if (current.imageUrl.length()) {
    current.imageUrl = "https://wsrv.nl/?url=" + current.imageUrl +
                       "&w=174&output=jpg&q=80";
  }
  if (current.nowPlaying) {
    lastNowPlayingTrack = current;
    hasLastNowPlayingTrack = true;
  } else if (hasLastNowPlayingTrack) {
    current = lastNowPlayingTrack;
    current.nowPlaying = false;
  }

  bool artworkChanged = !hasDisplayedTrack ||
                        current.imageUrl != displayedTrack.imageUrl;
  if (artworkChanged && filesystemReady) LittleFS.remove("/cover.jpg");
  bool artworkDownloaded = false;
  if (current.imageUrl.length() && filesystemReady &&
      (artworkChanged || !LittleFS.exists("/cover.jpg"))) {
    artworkDownloaded = downloadImage(current.imageUrl);
  }
  bool changed = !hasDisplayedTrack ||
                 current.song != displayedTrack.song ||
                 current.artist != displayedTrack.artist ||
                 current.album != displayedTrack.album ||
                 current.imageUrl != displayedTrack.imageUrl ||
                 current.nowPlaying != displayedTrack.nowPlaying ||
                 artworkDownloaded;
  if (!changed) {
    Serial.println("Track unchanged; keeping the current screen");
    return;
  }
  displayedTrack = current;
  hasDisplayedTrack = true;
  if (mode == Mode::Listening) drawListeningScreen(current);
}

void setup() {
  // The bridge can send up to 35 KB of JPEG data while NFC polling is busy.
  // The default 256-byte UART receive buffer loses most of that packet.
  Serial.setRxBufferSize(40000);
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
  drawMessage("MUSIC HUB", "Starting...", "");

  touchscreen.begin();
  digitalWrite(TOUCH_CS, HIGH);
  filesystemReady = LittleFS.begin(true);
  if (!filesystemReady) Serial.println("LittleFS mount failed; music art unavailable");

  SPI.begin(NFC_SCK, NFC_MISO, NFC_MOSI, NFC_CS);
  nfc.begin();
  nfcReady = nfc.getFirmwareVersion() && nfc.SAMConfig();
  if (!nfcReady) Serial.println("PN532 unavailable; check wiring and SPI switches");

  enterMode(loadTouchCalibration() ? Mode::Home : Mode::Calibration);
  Serial.println("Music Hub ready");
}

void loop() {
  readBridgeReplies();
  pollTouch();
  if (mode == Mode::Listening) {
    if (WiFi.status() != WL_CONNECTED && millis() - lastWiFiAttempt >= 20000UL) {
      WiFi.disconnect();
      if (WIFI_PASSWORD[0] == '\0') WiFi.begin(WIFI_SSID);
      else WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      lastWiFiAttempt = millis();
    }
    if (WiFi.status() == WL_CONNECTED && millis() - lastTrackPoll >= 20000UL) {
      lastTrackPoll = millis();
      getCurrentSong();
    }
    return;
  }
  if (mode != Mode::Library) return;
  if (shownUid.length() && shownSummary.isEmpty() &&
      millis() - pendingSince > 3000) {
    drawMessage("BRIDGE NOT RESPONDING", "Open the local bridge", "on your computer and scan again");
    shownSummary = "waiting";
  }

  if (!nfcReady || millis() - lastNfcPoll < 700) return;
  lastNfcPoll = millis();
  uint8_t uid[7];
  uint8_t uidLength = 0;
  if (nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 100)) {
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
  }
}
