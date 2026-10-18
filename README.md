# ESP32 Music Display

An ESP32 sketch that shows the latest track from Last.fm on a TFT display, including album art.

## Setup

1. Copy `music_display/secrets.h.example` to `music_display/secrets.h`.
2. Enter your Wi-Fi name and password, Last.fm username, and Last.fm API key in `music_display/secrets.h`. Use an empty password (`""`) for an open Wi-Fi network.
3. Install the ESP32 Arduino core and the ArduinoJson, TFT_eSPI, and TJpg_Decoder libraries. Configure TFT_eSPI for your display and select your ESP32 board.
4. Open `music_display/music_display.ino` in the Arduino IDE and upload it to the board.

The display redraws only when the track, artwork, or playback status changes. If Last.fm stops reporting a now-playing track during an ad, it shows the last track the device saw playing. After a restart, it falls back to Last.fm's latest completed scrobble until it sees a new now-playing track.

Keep `secrets.h` private. Git ignores it, but verify staged files before pushing. The sketch currently uses `WiFiClientSecure::setInsecure()` for HTTPS requests, which skips certificate validation. This is suitable only for testing; a network attacker could intercept the Last.fm API key or alter responses.
