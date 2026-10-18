#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <TJpg_Decoder.h>
#include <LittleFS.h>
#include "secrets.h"

// ---------------- CONFIG ----------------
// Copy secrets.h.example to secrets.h and fill in your own values.

// ---------------- DISPLAY ----------------

TFT_eSPI tft = TFT_eSPI();

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

// JPEG drawing callback
bool tft_output(int16_t x, int16_t y, uint16_t w, uint16_t h, uint16_t *bitmap) {
  if (y >= tft.height()) return 0;
  tft.pushImage(x, y, w, h, bitmap);
  return 1;
}

// ---------------- WIFI ----------------

bool connectWiFi() {
  WiFi.mode(WIFI_STA);

  if (WIFI_PASSWORD[0] == '\0') {
    WiFi.begin(WIFI_SSID);
  } else {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }

  Serial.print("Connecting to WiFi");

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (millis() - start > 20000) {
      Serial.println("\nWiFi connection timed out");
      return false;
    }
  }

  Serial.println("\nWiFi connected!");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
  return true;
}

// ---------------- DOWNLOAD IMAGE ----------------

String fitText(String text, int maxWidth) {
  // Check whether the text already fits
  if (tft.textWidth(text) <= maxWidth) {
    return text;
  }

  // Shorten the text until it fits
  while (text.length() > 0 &&
         tft.textWidth(text + "...") > maxWidth) {
    text.remove(text.length() - 1);
  }

  return text + "...";
}


bool downloadImage(String url, String path) {
  WiFiClientSecure client;
  client.setInsecure(); // Testing only

  HTTPClient http;
  http.setTimeout(10000);
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  Serial.println("Downloading image...");
  unsigned long start = millis();

  if (!http.begin(client, url)) {
    Serial.println("HTTP initialization failed");
    return false;
  }

  int response = http.GET();

  Serial.printf("Image HTTP status: %d\n", response);

  if (response != HTTP_CODE_OK) {
    http.end();
    return false;
  }

  File file = LittleFS.open(path, "w");

  if (!file) {
    Serial.println("Cannot create image file");
    http.end();
    return false;
  }

  // Let HTTPClient handle the download
  int bytes = http.writeToStream(&file);

  file.close();
  http.end();

  if (bytes <= 0) {
    LittleFS.remove(path);
    Serial.println("Image download failed");
    return false;
  }

  Serial.printf("Downloaded %d bytes\n", bytes);
  Serial.printf("Took %lu ms\n", millis() - start);

  return true;
}


// ---------------- DRAW UI ----------------

void drawPlaceholderArt() {
  tft.fillRect(10, 30, 100, 100, TFT_DARKGREY);
  tft.drawRect(10, 30, 100, 100, TFT_WHITE);
  tft.setTextColor(TFT_WHITE, TFT_DARKGREY);
  tft.setTextSize(1);
  tft.setCursor(26, 75);
  tft.print("No Cover");
}



void drawScreen(
  String song,
  String artist,
  String album,
  bool nowPlaying
) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextWrap(false);
  tft.setTextFont(1);
  tft.setTextDatum(TC_DATUM);

  const int centerX = tft.width() / 2;

  // ---------- HEADER ----------
  tft.setTextSize(1);
  tft.setTextColor(TFT_GREEN, TFT_BLACK);

  tft.drawString(
    nowPlaying ? "NOW PLAYING" : "LAST PLAYED",
    centerX,
    3
  );

  // ---------- CENTERED ALBUM ART ----------
  if (LittleFS.exists("/cover.jpg")) {
    uint16_t w = 0;
    uint16_t h = 0;

    TJpgDec.getFsJpgSize(
      &w, &h, "/cover.jpg", LittleFS
    );

    if (w > 0 && h > 0) {
      // Scale to fit within 120 x 120
      uint8_t scale = 1;

      while (scale < 8 &&
             (w / scale > 120 ||
              h / scale > 120)) {
        scale *= 2;
      }

      TJpgDec.setJpgScale(scale);

      int displayW = (w + scale - 1) / scale;
      int x = (tft.width() - displayW) / 2;

      TJpgDec.drawFsJpg(
        x, 17, "/cover.jpg", LittleFS
      );
    }
  } else {
    tft.drawRect(
      centerX - 60, 17,
      120, 120, TFT_DARKGREY
    );
  }


  // ---------- SONG INFORMATION ----------
  tft.setTextFont(1);
  tft.setTextSize(2);
  tft.setTextDatum(TC_DATUM);

  const int maxWidth = 300;

  // ---------- SONG TITLE ----------
  tft.setTextColor(TFT_WHITE, TFT_BLACK);

  tft.drawString(
    fitText("Title: " + song, maxWidth),
    centerX, 148
  );

  // ---------- ARTIST ----------
  tft.setTextColor(TFT_CYAN, TFT_BLACK);

  tft.drawString(
    fitText("Artist: " + artist, maxWidth),
    centerX, 178
  );

  // ---------- ALBUM ----------
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);

  tft.drawString(
    fitText("Album: " + album, maxWidth),
    centerX, 208
  );

  tft.setTextDatum(TL_DATUM);
}




// ---------------- LAST.FM ----------------

String pickImageUrl(JsonArray images) {
  // Try extralarge first
  for (JsonObject img : images) {
    const char* size = img["size"];
    const char* text = img["#text"];
    if (String(size) == "extralarge" && String(text).length() > 0) {
      return String(text);
    }
  }

  // Then large
  for (JsonObject img : images) {
    const char* size = img["size"];
    const char* text = img["#text"];
    if (String(size) == "large" && String(text).length() > 0) {
      return String(text);
    }
  }

  // Then medium
  for (JsonObject img : images) {
    const char* size = img["size"];
    const char* text = img["#text"];
    if (String(size) == "medium" && String(text).length() > 0) {
      return String(text);
    }
  }

  return "";
}

void getCurrentSong() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;

  String url =
    "https://ws.audioscrobbler.com/2.0/"
    "?method=user.getrecenttracks&user=" +
    String(LASTFM_USER) +
    "&api_key=" + String(LASTFM_KEY) +
    "&limit=1&format=json";

  if (!http.begin(client, url)) {
    Serial.println("HTTP init failed");
    return;
  }

  int response = http.GET();

  if (response != 200) {
    Serial.printf("HTTP error: %d\n", response);
    http.end();
    return;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, http.getStream());
  http.end();

  if (error) {
    Serial.println("JSON parsing failed");
    return;
  }

  JsonVariant track = doc["recenttracks"]["track"][0];
  if (track.isNull()) {
    Serial.println("No track found");
    return;
  }

  TrackInfo current;
  current.song = track["name"] | "Unknown";
  current.artist = track["artist"]["#text"] | "Unknown";
  current.album = track["album"]["#text"] | "Unknown";
  String playing = track["@attr"]["nowplaying"] | "false";
  current.nowPlaying = (playing == "true");
  current.imageUrl = pickImageUrl(track["image"].as<JsonArray>());

  // Convert artwork to a smaller JPEG.
  if (current.imageUrl.length() > 0) {
    current.imageUrl = "https://wsrv.nl/?url=" + current.imageUrl +
                       "&w=174&output=jpg&q=80";
  }

  if (current.nowPlaying) {
    // Remember the newest track even before Last.fm has scrobbled it.
    lastNowPlayingTrack = current;
    hasLastNowPlayingTrack = true;
  } else if (hasLastNowPlayingTrack) {
    // During ads, Last.fm may fall back to an older completed scrobble.
    current = lastNowPlayingTrack;
    current.nowPlaying = false;
  }

  bool artworkChanged = !hasDisplayedTrack ||
                        current.imageUrl != displayedTrack.imageUrl;
  bool artworkDownloaded = false;

  if (artworkChanged) {
    if (LittleFS.exists("/cover.jpg")) {
      LittleFS.remove("/cover.jpg");
    }
  }

  if (current.imageUrl.length() > 0 &&
      (artworkChanged || !LittleFS.exists("/cover.jpg"))) {
    artworkDownloaded = downloadImage(current.imageUrl, "/cover.jpg");
  }

  bool displayChanged = !hasDisplayedTrack ||
                        current.song != displayedTrack.song ||
                        current.artist != displayedTrack.artist ||
                        current.album != displayedTrack.album ||
                        current.imageUrl != displayedTrack.imageUrl ||
                        current.nowPlaying != displayedTrack.nowPlaying ||
                        artworkDownloaded;

  if (!displayChanged) {
    Serial.println("Track unchanged; keeping the current screen");
    return;
  }

  drawScreen(current.song, current.artist, current.album, current.nowPlaying);
  displayedTrack = current;
  hasDisplayedTrack = true;
}

// ---------------- SETUP / LOOP ----------------

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(21, OUTPUT);
  digitalWrite(21, HIGH);

  tft.init();
  tft.setRotation(1);
  tft.fillScreen(TFT_BLACK);

  TJpgDec.setJpgScale(1);
  TJpgDec.setSwapBytes(true);
  TJpgDec.setCallback(tft_output);

  if (!LittleFS.begin(true)) {
    Serial.println("LittleFS mount failed");
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.setTextSize(2);
    tft.setCursor(10, 20);
    tft.println("LittleFS failed");
    return;
  }

  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(2);
  tft.setCursor(10, 20);
  tft.println("Starting...");

  if (connectWiFi()) {
    getCurrentSong();
  } else {
    tft.fillScreen(TFT_BLACK);
    tft.setCursor(10, 20);
    tft.setTextColor(TFT_RED, TFT_BLACK);
    tft.println("WiFi failed");
  }
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (WiFi.status() == WL_CONNECTED) {
    getCurrentSong();
  }

  delay(20000);
}
