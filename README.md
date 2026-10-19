# Digital CD Library and ESP32 Music Display

An ESP32 sketch that shows the latest track from Last.fm on a TFT display, including album art.

## Digital CD Library webpage

The companion website is at the repository root. Serve this folder locally (for example, `python -m http.server 8000`) and open `http://localhost:8000/`.

Select **Add CD**, enter an album and artist, choose the matching CD edition, review its cover and track list, then save it. Search and track data come from [MusicBrainz](https://musicbrainz.org/); cover images come from the [Cover Art Archive](https://coverartarchive.org/). MusicBrainz requests are spaced apart, successful results are reused during the page session, and temporary busy responses are retried. A missing cover displays a placeholder.

The library currently uses browser local storage. It stays on the same browser and origin, with no account or sync yet. NFC integration is a future step.

Once you have saved CDs, switch between **Grid** and **Stack** views. Your view choice is saved in this browser and restored after refresh. Stack view shows your albums as a pile of clear jewel cases. Drag the top case left or right, select a case underneath, or use the arrow buttons and left/right arrow keys to browse. Select the top case or **View CD details** to open it.

## Setup

1. Copy `music_display/secrets.h.example` to `music_display/secrets.h`.
2. Enter your Wi-Fi name and password, Last.fm username, and Last.fm API key in `music_display/secrets.h`. Use an empty password (`""`) for an open Wi-Fi network.
3. Install the ESP32 Arduino core and the ArduinoJson, TFT_eSPI, and TJpg_Decoder libraries. Configure TFT_eSPI for your display and select your ESP32 board.
4. Open `music_display/music_display.ino` in the Arduino IDE and upload it to the board.

The display redraws only when the track, artwork, or playback status changes. If Last.fm stops reporting a now-playing track during an ad, it shows the last track the device saw playing. After a restart, it falls back to Last.fm's latest completed scrobble until it sees a new now-playing track.

Keep `secrets.h` private. Git ignores it, but verify staged files before pushing. The sketch currently uses `WiFiClientSecure::setInsecure()` for HTTPS requests, which skips certificate validation. This is suitable only for testing; a network attacker could intercept the Last.fm API key or alter responses.
