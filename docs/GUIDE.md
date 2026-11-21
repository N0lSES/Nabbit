# Nabbit

*(Formerly Clipsmith. Renamed because another app already uses that name.)*

A desktop media toolbox built with Electron: **Video Downloader · File Converter · Trimmer · Compressor**.

## Run it

You need [Node.js](https://nodejs.org) (LTS) installed.

```bat
cd F:\Apps\DL
npm install
npm run setup     :: downloads yt-dlp, plus the converter's ffmpeg and Ghostscript
npm start
```

### Development vs. the installed app

- **`start.bat`** (or `npm start`) runs Nabbit straight from this folder. The window title says **Nabbit (dev)**, and edits show up with Ctrl+R.
- **The installed app** (from `dist\Nabbit Setup.exe`) is a snapshot taken when you ran `build.bat`. Edits to this folder don't reach it until you rebuild and reinstall.

### Audio → MIDI

The **To Midi** presets turn audio (or a video's soundtrack) into a `.mid` file. They're based on [NFJones/audio-to-midi](https://github.com/NFJones/audio-to-midi) (MIT license), ported to JavaScript in `converter/midi.js`, so nothing extra needs installing. The audio is cut into short windows, each window goes through an FFT, the frequencies are grouped into MIDI notes, and the loud ones are written out.

- **To Midi**: dense and detailed. Overlapping 46 ms windows every 11.6 ms, every note louder than its neighbours (no cap per window), velocity on a decibel curve (60 dB range, loudest note = 110, floor ≈ 9), notes up to G7 (103). Expect lots of short notes, the "audio played on a piano" sound.
- **To Midi (clean)**: the earlier behaviour. 80 ms windows, the 4 loudest notes per window, linear velocity, piano range.
- **To Midi (single note)**: one note at a time, for melodies, whistling or humming.

Extra keys in a preset's settings: `MidiHop` (ms between windows; 0 = no overlap), `MidiVelocity` (`Linear` or `Log`), `MidiRange` (dB, for Log) and `MidiMaxVelocity`. An unedited "To Midi" from an older version is switched to the new settings automatically; one you've edited is left alone.
- **To Midi:** up to 4 notes at a time, 80 ms windows. For chords and simple arrangements.
- **To Midi (single note):** the loudest note only, 60 ms windows. For melodies, whistling, humming, or a solo instrument.

It works best on clean, simple recordings. A full mix with drums and vocals comes out as an approximation, not a transcription. You can tune the result in **Edit presets…** with these `Midi…` settings:

| Setting | Default | What it does |
|---|---|---|
| `MidiTimeWindow` | 80 | Window length in ms. Longer gives better pitch; shorter gives finer timing. |
| `MidiActivation` | 0.15 | Drops notes quieter than this share (0–1) of the loudest note. |
| `MidiNoteCount` | 4 | Keeps the n loudest notes per window (0 = all). |
| `MidiCondense` / `MidiCondenseMax` | True / False | Joins a held note into one long note, using the average or the loudest velocity. |
| `MidiMaxNoteLength` | 0 | Longest joined note, in windows (0 = no limit). |
| `MidiTranspose` | 0 | Shifts every note by this many semitones. |
| `MidiMinNote` / `MidiMaxNote` | 21 / 108 | Note range (the default is a piano's). |
| `MidiBpm` | 120 | Tempo written to the file. |
| `MidiSeparateChannels` | False | Puts left and right on separate MIDI channels. |
| `MidiPeaksOnly` | True | Keeps only notes louder than the notes either side, so a tone doesn't bleed into its neighbours. |

### Explorer right-click menu (Windows)

Turn it on with **Add Nabbit to the right-click menu in File Explorer** on the Converter page, or with **Explorer right-click menu** in the tray menu. Right-clicking a file then shows **Nabbit ▸**. On videos and audio it starts with **Open In Trimmer** and (videos) **Compress ▸**, then **Convert to ▸**: Explorer stops showing a static menu after about a hundred entries, so the quick actions come first, and videos don't list still-image or document formats under Other. The entries:
- **Convert to ▸** lists every converter preset that fits the file, like File Converter's menu. Click one and the file converts in the background next to the original, with progress in the jobs popup at the bottom right. **Open in Converter…** at the bottom opens the Converter with the file added.
- **Other ▸**, below the presets in the same menu, lists every other format Nabbit can reach from that file ("convert to anything"), plus the three **Midi** presets (under Audio). For **video files**, the audio formats are in their own **Audio ▸** submenu: Ogg, Flac, Wav, Mp3 and Aac, then **Other ▸** with the rest of the audio formats and the Midi presets. Formats a preset already makes aren't repeated. Short lists are split by lines into Video, Audio, Image, Document, Text, Data and Visualise; long ones (videos) get a submenu per group. When no single converter does it, it chains several and shows the route, for example **MP4 (via GIF)** from a PNG, **YAML (via JSON)** from a CSV, or **PDF (via HTML)** from Markdown. This is the same idea as [p2r3/convert](https://github.com/p2r3/convert), built only on Nabbit's own converters, with no code from it. The converter presets are used first; `converter/extra.js` adds the unusual formats using ffmpeg's built-in encoders, plain JavaScript, and Word:
  - **Audio:** M4A (AAC or Apple Lossless), Opus, AIFF, CAF, AU, WavPack, TTA, AC3, E-AC3, MP2, MKA, WMA
  - **Video:** FLV, TS, M4V, 3GP, MPG (MPEG-2), WMV, plus APNG from a video or GIF
  - **Image:** BMP, TIFF, TGA, PPM, PGM, PAM, PCX, SGI, Sun raster, XWD, QOI, JPEG 2000, Radiance HDR. A video gives its first frame.
  - **Visualise:** spectrogram picture, waveform picture, visualizer video (MP4), contact sheet (16 frames), all frames as a ZIP (1 per second)
  - **Text:** SRT ⇄ WebVTT ⇄ ASS subtitles, a video's own subtitles as SRT, and pictures as ASCII art
  - **Data:** CSV ⇄ JSON ⇄ TSV, and JSON → YAML / XML
  - **Documents:** Markdown → HTML, HTML / Markdown → TXT, and TXT / RTF / HTML → PDF (with Microsoft Word on Windows)
  - **Limits:** chains are at most 3 steps. A step that makes one file per page is always the last. Pictures can't turn into audio. Frames, contact sheets and subtitles only come from the original video. Each step works in a temporary folder, and the result is saved next to the original.
  - **New file types:** unusual inputs (WavPack, AC3, TS, MTS, BMP, TGA, QOI, SRT, CSV, JSON, Markdown and more) get the right-click menu too.
- **Compress ▸** (videos): **High quality**, **Balanced**, **Smallest file**, or **Fit 10 / 25 / 50 / 100 MB**. **Open in Compressor…** opens the Compressor with the file loaded.
- **Open In Trimmer** (videos and audio) opens the Trimmer with the file loaded.

Notes:
- **Several files:** select several files to convert or compress them all at once; each becomes its own job.
- **Nabbit not running:** it starts in the tray to do the work.
- **Windows 11:** the entries are under **Show more options** (or Shift+F10), like other classic menu entries.
- **Where it's stored:** the menu is registered for your user only (`HKCU\Software\Classes\SystemFileAssociations\.<ext>\shell\Nabbit`), so no admin rights are needed. Turning the option off removes it. Nabbit refreshes it at startup, so preset changes show up after a restart.

### System tray

Closing the window doesn't quit Nabbit. It keeps running in the system tray, so downloads in progress and the browser extension keep working. The first time you close it, a notification says where it went.
- **Click** the tray icon to open the window.
- **Right-click** it for the menu: **Open Nabbit**, each tool (Video Downloader, Music Downloader, Converter, Trimmer, Compressor), how many jobs are running, **Open Downloads folder**, **Explorer right-click menu**, **Start with Windows**, **Settings…** and **Quit Nabbit**. Quit asks first if jobs are still running.

### Audio Editor (preview)

The **Audio Editor** tab (06) is a placeholder for tools on the way: **Key finder** (key and Camelot code), **BPM finder** (tempo and beat grid, written to the tags), and later trim / fades, pitch and tempo, loudness normalizing, vocal / instrument splitting and tag editing. The page is laid out but its controls are disabled for now.

### Look and motion

Nabbit has a monochrome Y2K / tech-manual look: square corners, monospace labels, hairline borders, corner brackets, ticks and barcodes, with red as the only accent. In light or dark.

- **Motion**: page headings type in, each tool's content fades up, the title-bar ruler and sidebar barcode scroll, progress bars pulse with a red shine, running jobs show a pulsing red dot, and changing the theme gives a short glitch.
- **Hover**: buttons fill from the left, the main buttons lift with a red and black shadow, thumbnail brackets widen, ✕ buttons spin.
- **Tooltips**: hover anything with extra info for a HUD bubble (black box, red offset shadow), in place of Windows' plain tooltips.
- **Cursor effects**: faint points drift over the window, and the ones near the pointer light up and link to it. Turn them off in Settings → Appearance → Cursor effects.
- Windows' "Show animations in Windows" off stops all of it.
- Fonts: drop Space Mono, Michroma and Silkscreen into `src/assets/fonts` (see the README there) for the full look; otherwise Consolas and Bahnschrift are used.
- The line-art shapes in `src/assets/hud` are from the STUDIO DISK – CYBER Y2K ELEMENTS pack.

### Settings

**Settings** (bottom of the sidebar, or Settings… in the tray menu) saves each change straight away:

- **Startup**: start Nabbit when Windows starts (on by default), and start minimized in the system tray (on by default). Works from source (start.bat) too; the login item is refreshed at every launch, so whichever copy you ran last is the one Windows starts.
- **Window**: keep running in the tray when the window is closed (on by default). Off: closing quits.
- **Appearance**: System, Light or Dark (same as the switch under the sidebar), cursor effects, and **Window blur**: Windows 11's acrylic material, so the desktop shows through the window background, blurred. It's on by default on Windows 11 22H2 or later and hidden on older Windows. The tool panels stay solid so text stays easy to read. Windows drops the blur for good once a window is maximized, so a blurred window is never maximized: Nabbit draws its own minimize / maximize / close buttons, and **maximize** (or double-clicking the title bar) fills the screen as a normal window and goes back the same way. Turning blur on asks for a restart; turning it off makes the window solid straight away.
- **File Explorer**: the right-click menu (on by default).
- **Downloads**: the default save folder.
- **Converter**: hardware encoding, also used for conversions from the right-click menu.
- **Browser extension**: which browsers are connected, and Disconnect all.

Older installs get the new defaults (start with Windows, start in the tray, right-click menu) once on the first launch of this version; after that your choices stick.
- Hovering over the icon shows how many jobs are running.
- Opening Nabbit again brings the running copy back instead of starting a second one.

### Keyboard shortcuts

| Keys | What it does |
| --- | --- |
| **Ctrl+R** or **F5** | Refresh. Reloads the window if you only changed UI files (`src/`). Restarts the app if you changed `main.js`, `preload.js`, `converter/` or `downloader/`. |
| **Ctrl+Shift+R** | Always restart the whole app |
| **F12** or **Ctrl+Shift+I** | Developer tools (only when running with `npm start`) |

If jobs are running, Nabbit asks before reloading or restarting.

## Video Downloader

Paste a link and press **Search** (or Enter; pasting a link searches automatically). Nabbit asks yt-dlp for the video's details without downloading it and shows a card with:

- the thumbnail, title and uploader
- duration · views · likes · dislikes
- the upload date (Mon DD, YYYY)
- resolution · FPS · bitrate of the stream that will be downloaded
- the source website

Under the card are the download options. Each dropdown only offers what the site actually has for the choices to its left:

- **Video row:** Format (container · codec, e.g. `MP4 · H.264`, `WEBM · VP9`, `MP4 · AV1 · HDR10`) → Resolution → FPS → Bitrate, plus the estimated size
- **Audio row:** Format (`M4A · AAC`, `WEBM · Opus`) → Sample rate → Bitrate, plus the estimated size

The **Format** lists are grouped:

| Group | What it does | Formats |
| --- | --- | --- |
| **Original** | The site's own streams, downloaded as-is | e.g. `MP4 · H.264`, `WEBM · VP9`, `M4A · AAC` |
| **Remux (lossless)** | The same streams copied into another container. No re-encoding, no quality loss. Only offered when a stream can be copied (e.g. MP4 lists only MP4-compatible streams). | Video: MP4, MOV, MKV, WEBM. Audio: AAC, OGG (and MP3/FLAC when the site has them) |
| **Convert (re-encode)** | Downloaded, then re-encoded with the Converter's preset ("To Mp4", "To Avi", "To Mp3", …), at any resolution and frame rate | Video: MP4, MOV, MKV, WEBM, AVI, OGV, GIF. Audio: AAC, MP3, OGG, FLAC, WAV |

The audio Remux and Convert formats are always listed (marked **audio only** while a video is selected). Picking one switches Video to **None** and downloads just the audio. Picking a video again restores a matching original audio track. Original audio streams are limited to ones that fit the selected video's container. The temporary download is removed after a remux or conversion, and existing files in the folder are never touched.

**Resolution / FPS / Bitrate for Convert:** any standard resolution (144p–4320p), frame rate (15–240 fps), video bitrate (250 kbps–100 Mbps) and audio bitrate (32–320 kbps), with no restrictions or warnings, because converting re-encodes anyway. **Auto** keeps the preset's quality setting. Choosing a bitrate replaces it and gives an estimated size. FLAC/WAV are lossless: instead of a bitrate they get a **Sample size** choice (16-bit or 24-bit, default 16-bit) with a size estimate (WAV from sample rate × bit depth × duration, FLAC about 60% of that). GIF has no bitrate. The best real stream is downloaded automatically as the source. The Converter preset's quality settings are kept, and the exact size and frame rate are applied on top. It starts at the video's best real resolution and frame rate.

**Out-of-range resolution / FPS (Remux only):** with a Remux format selected, the Resolution and FPS lists offer every standard value (144p–4320p, 15–240 fps). Values the site doesn't have are **red** and marked **(out of range)**, and a note explains what happens: the closest real stream is downloaded (the smallest one at or above your choice, so quality isn't lost to upscaling when avoidable) and re-encoded to that size and frame rate. That uses H.264 for MP4/MOV/MKV and VP9 for WebM. This makes it a re-encode rather than a lossless remux, so the size shows "re-encoded".

**MP4 · H.264** is picked first because it plays everywhere. Audio is matched to the video format automatically (AAC for MP4, Opus for WebM) until you choose one yourself. Pick **None** in either row for video-only or audio-only. The card's resolution · fps · bitrate line follows your selection. Video and audio are merged into MP4, WebM or MKV, depending on what fits. Then choose a folder in the bottom bar and press **Download**.

- **Dislikes:** for YouTube, dislikes are estimates from [Return YouTube Dislike](https://returnyoutubedislike.com), which its terms require us to credit and link. Lookups are cached for 10 minutes, and Nabbit backs off if their rate limit (100 per minute) is hit. If the service is down, the card shows everything else.
- **Other sites:** any site yt-dlp supports works. Fields a site doesn't provide are simply left out.
- **Thumbnails:** hover over the thumbnail and click the download icon in its corner. Pick a size and format from the menu, and it's saved to the chosen folder as `<title> (1280x720).jpg`. Sizes the site doesn't actually have fail with a clear message.
- **Links:** links open in your browser, never inside the app.

## Music Downloader

A separate sidebar tab for audio-only downloads.

**SoundCloud quality.** When the artist allows downloads, SoundCloud has the original uploaded file, often WAV or FLAC. Nabbit picks it by default: the song card lists it as **Original file**, and SoundCloud albums default to **Best · Original file if offered**. Converting also starts from the original file when there is one. Otherwise the best free stream is used, usually AAC at 160 kbps. SoundCloud's 256 kbps streams need your own Go+ subscription and aren't used.

**DRM-protected SoundCloud tracks.** Some SoundCloud tracks are DRM-protected (SoundCloud Go+ only) and can't be downloaded or streamed. When you open one, Nabbit looks for the same song on YouTube Music ("{artist} - {title}", matching title, artist and length) and opens that instead, with a note saying why. The player does the same and shows **Via YT Music**. If YouTube Music doesn't have it, you get a message saying so. Nabbit never tries to get around the DRM itself.

**Higher quality on YouTube Music.** When you open a SoundCloud song or album, Nabbit looks for the same release on YouTube Music in the background. It matches the title, the artist, and the length (or the track count for albums). If YouTube Music's best audio is clearly better, a notice at the top of the card shows both, for example **48 kHz · 160 kbps · Opus vs SoundCloud 44.1 kHz · 128 kbps · MP3**, with **Open song** / **Open album** to switch. It stays quiet when the artist offers their original file on SoundCloud, since that's full quality. Turn it off in Settings → Downloads. The numbers are what each site really serves: YouTube Music's free audio is usually Opus at about 130–160 kbps, 48 kHz (256 kbps AAC needs Premium).

**Highest quality possible (FLAC).** For **YouTube / YouTube Music only**: the default format for its songs and albums, at the top of the format list (and in the browser extension's menu). SoundCloud's streams don't go that high, so SoundCloud doesn't offer it and starts on the artist's original file when there is one (else the best stream). Nabbit takes YouTube's 48 kHz Opus stream (unless another is clearly higher). It then saves it as FLAC, which every player opens and which holds the tags and cover art. Opus/AAC streams become 16-bit FLAC at the stream's sample rate: the decoded audio is kept exactly, at a smaller size than 24-bit. Lossless originals (WAV/AIFF) become FLAC at their own bit depth. A file that's already FLAC, or an MP3, is kept as-is, since FLAC can't add anything to it. OGG (remux) is still in the list but isn't the default: not every player opens .ogg files or shows their cover art.

**Source quality.** When you convert, the card (or the album, from its first track) shows what the conversion starts from, for example **Source: Opus · 48 kHz · 140 kbps**. If the output asks for more than the source has, the line turns red and says so: a higher bitrate (**320 kbps from a 140 kbps Opus source**), a higher sample rate, or FLAC/WAV from a lossy stream. You get a bigger file, not better sound.

**Search or paste a link.** Type words to search YouTube Music, choosing **Songs**, **Albums** or **Playlists** with the chips under the search bar. Results show artwork, artist, album, year and length. They come from YouTube Music's own search endpoint, the same request yt-dlp makes (client WEB_REMIX), because yt-dlp's search listing only carries links. If that request fails, Nabbit falls back to yt-dlp's listing with fewer details. Switch the search between **YouTube Music** and **SoundCloud** with the toggle at the right of the chips (remembered between runs). SoundCloud results come from SoundCloud's own web search (api-v2, using the client_id from its page scripts, as yt-dlp does); if that fails, song searches fall back to yt-dlp's `scsearch`. Or paste a link to a song, album or playlist. Click a result to open it: songs, albums and playlists open beside the results (the open one is highlighted), so you can click through them. A pasted link opens on its own.

**Streaming (play without downloading).** Click ▶ on a song in the search results, an artist's songs or an album's tracks, or **▶ Play** / **▶ Play all** in the bottom bar. The player docks at the bottom:

- Cover, **title** (opens the song), **artist** (opens their artist page) and **album** (opens the album), all clickable
- Previous / play-pause / next; the list you played from is the queue, and it carries on to the next song
- A progress bar to click or drag (← → keys skip 5 s), with the buffered part shown
- **Lyrics**: synced lyrics from LRCLIB slide up above the player, the current line highlighted (click a line to jump to it); the current line also shows under the title. Lyrics with word timings light up word by word as they're sung
- **Quality**: Low (~64 kbps), Normal (~128 kbps) or High (best); changing it reloads the song at the same point
- Volume and mute (remembered), and Windows' media keys (play/pause, next, previous)

How it works: yt-dlp finds the song's audio stream for the chosen quality, and Nabbit's own small server on 127.0.0.1 (`streamer.js`) passes it to the player, so it starts quickly and seeking works. At the same time the whole song is saved to the **cache** (`%APPDATA%\Nabbit\stream-cache`), so the next play is instant and works offline; the status next to the time shows **Streaming** or **Cached**. The next song in the queue is cached ahead. SoundCloud's segmented streams are joined by ffmpeg and play as they arrive (saved alongside; a stream that can't be copied as it is gets converted to MP3 on the fly); jumping ahead in one works once it's cached, a few seconds in. SoundCloud's "original file" downloads are never used for streaming. Songs are looked up while the pointer rests on their ▶, and the next song in the queue straight after the current one starts, so most songs begin within a second or two. If a song can't play, the reason shows under the title. Settings → **Streaming** sets the default quality, how much music to keep cached (256 MB to 10 GB, oldest songs go first) and clears the cache.

**Artist pages.** Click an artist's name anywhere in the Music Downloader (results, song cards, albums), or search with the **Artists** chip, to open their page inside Nabbit: picture, name, subscribers / followers, bio (click to expand), and their lists. YouTube Music pages come from the same "browse" request its website makes: top songs, albums, singles & EPs, videos, featured playlists and related artists. SoundCloud pages come from its web API: popular tracks, albums, latest tracks and playlists. Songs and albums open in their usual views with **← Back to <artist>**; related artists open their own page; **Open on YouTube Music / SoundCloud ↗** opens the real page in your browser.

**Songs** open a card (cover, artist and album when the site provides them); the audio options sit in the bar at the bottom, and **Get song** asks where to save, starting in the folder used last time. The audio options: Remux (AAC, OGG), Convert (AAC, MP3, OGG, FLAC, WAV, with any bitrate, or 16/24-bit for FLAC/WAV), or the original stream. Files are named **"Artist - Title"**.

**Albums and playlists** open a track list with cover, artist, track count, total length and year. Tick the tracks you want (all by default). The options sit in the bar at the bottom:

- **Format for every track:** Remux, Convert, or Original (best M4A or WEBM/Opus)
- **Quality:** a bitrate for lossy conversions, 16/24-bit for FLAC/WAV
- **Save as:** a **Folder** (`Artist - Album/01 - Title.ext`) or a single **Zip file**

Click **Get album** (or **Get playlist**): Nabbit asks where to save, starting in the folder you picked last time, then starts downloading. Tracks that fail to download are skipped, and the rest still finish.

**Tags, cover art and lyrics** (both on by default, in the bottom bar):

- **Tags:** title, artist, album, album artist, **track number** (`3/12` for albums) and **disc number**, written by yt-dlp's `--embed-metadata`. **Album** is the album's name for album downloads; a song downloaded on its own keeps its album only when it's on one, and **singles get no album tag** (no album given, or an "album" named like the song, e.g. "Song" or "Song - Single")
- **Cover art:** the thumbnail, cropped to a square (max 1000 px) and embedded in MP3, M4A, FLAC, OGG and Opus. AAC, WAV and WebM files can't hold cover art.
- **Synced lyrics** from [LRCLIB](https://lrclib.net), a free and open lyrics database matched on artist, title, album and length. Saved as a `.lrc` file next to each track, which most music players pick up, and embedded as a tag in M4A, FLAC, OGG and Opus. Lookups go one at a time, with a short pause, as LRCLIB asks.

If a site only has combined video+audio, the audio is extracted as MP3.

**Separate state:** each tab keeps its own search, results, album or song, and choices, so you can switch between them without losing either.

## Browser extension (Firefox)

The extension in `extension/firefox/` sends links from Firefox to the app. Nabbit opens the link in the **Video** or **Music Downloader**, looked up as if you'd pasted it. You still pick the format and click Download.

**Ways to send a link**
- Click the toolbar button, then **Video** or **Music**. This sends the page you're on.
- Right-click a page, a link, or a video or audio player, then choose **Nabbit → Open in …**.
- On **YouTube**, the **Download** button left of Like opens a download menu for the video. Its **♪** part opens one for the audio. On **SoundCloud** track, album and playlist pages, the download button in the action row opens one too.
  - **Video options:** Quality (Best down to 360p) and Format (MP4, MKV, WEBM).
  - **Music options:** the same as the app's album row: Format, Quality, Sample rate, and Folder or Zip for albums and playlists.
  - **Download** starts right away, saves to your Downloads folder, and remembers your choices. A small **jobs window** pops up at the bottom right of the screen with progress and **Show in folder**. **✕** closes it, and **Open app** opens Nabbit. The jobs also appear in the app's Jobs list.
  - **Show in app** opens the link in Nabbit so you can choose formats there instead.
  - The menu needs the extension to be connected and allowed to reach the app.

**Look:** the popup and the download menu use the app's HUD style: square edges, Space Mono and Michroma (bundled in `extension/firefox/fonts`), the red accent and the same dropdowns. They follow the app's light or dark theme. The buttons placed on YouTube and SoundCloud pages keep each site's own look so they fit in.
- Press **Alt+Shift+V** (video) or **Alt+Shift+M** (music). You can change these in Firefox under Add-ons → ⚙ → Manage Extension Shortcuts.

**Install it**
- **For testing:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `extension/firefox/manifest.json`. It stays until Firefox restarts.
- **To keep it installed:** run `npm run pack:ext` (`build.bat` does this too) to get `dist/nabbit-firefox.xpi`. Release Firefox only installs signed add-ons, so sign it for free as an *unlisted* add-on at addons.mozilla.org (Developer Hub → Submit a New Add-on → "On your own"), or use `web-ext sign`. Firefox Developer Edition and Nightly can install it unsigned after you set `xpinstall.signatures.required` to `false` in `about:config`.

**Connect it (once):** with Nabbit running, open the extension and click **Connect**. Nabbit asks you to allow it and shows a 6-character code. Click **Allow** only if the code matches the one in the extension. **Disconnect** in the extension removes that browser. To remove every connected browser, delete `browser-extensions.json` from Nabbit's data folder (`%APPDATA%\Nabbit`).

**How it talks to the app (`bridge.js`):** Nabbit runs a small server on `127.0.0.1:47815`.
- It only accepts connections from this computer, and it checks the Host header.
- It refuses requests from web pages: any request with a website's Origin is rejected.
- Pairing needs your approval in the app. After that, the extension sends a random token with every request, and the app stores only a hash of each token.
- The only thing the extension can do is open an http(s) link in a downloader tab.

## Trimmer

Cut video and audio without re-encoding, LosslessCut-style (ideas only; no code from it, which is GPL).

- **Open a file** with **Open file…**, by dropping it on the Trimmer, or from Explorer's right-click **Nabbit → Open In Trimmer**. The file line shows its codec, size, frame rate, tracks and length. A file the built-in player can't play (H.265, AVI, WMV …) gets a small H.264 **preview copy** made automatically, with a percentage while it's being made. Cutting always uses the original, so nothing is lost.
- **Segments** are the parts to keep. A new file starts as one segment covering everything. Use **Set start** / **Set end** (**I** / **O**) at the playhead, **Split** (**S**) a segment at the playhead, **+ Add** a new one, and **✕** (**Delete**) to remove the selected one. You can also drag a segment's edges on the timeline; they snap to keyframes within 8 px (hold **Alt** not to snap). The list shows each segment's times and length, plus the total kept.
- **Timeline:** a ruler, the video's **keyframes**, the segments, and the audio **waveform** (lit where it's kept). Click or drag to seek.
- **Audio scrubbing** (AudioStretch-style): while you drag on the timeline, or drag a segment's edge, the audio follows the pointer at its speed (slow drag = slow playback) without changing pitch. **Hold still** and the sound at that spot keeps ringing, so you can hear the exact note or beat where you're cutting. Release, and playback carries on if it was playing. It works on files up to 2 hours long. **−** / **+** or **Ctrl + wheel** zooms (up to 64×), and the wheel scrolls a zoomed timeline.
- **Moving around:** **Space** plays and pauses, **← / →** step a frame, **Shift + ← / →** jump between keyframes. The preview shows the time, frame number and whether you're on a keyframe (or where the next one is). The camera button saves the current frame as a PNG next to the file.
- **Tracks:** tick the video, audio and subtitle tracks to keep, for example to drop a commentary track.
- **Export** runs as a job; the files go next to the original. Options:
  - **Cut: Keyframe** (lossless and instant) copies the streams. A video segment starts on the keyframe at or before its start, and the list marks segments that will start earlier with **⚠**, saying by how much. **Exact** re-encodes (x264 CRF 18, VP9 for WebM, the audio format's own encoder) to start and end on the exact frame; formats Nabbit can't encode into (AVI, WMV …) become MP4. **Smart** (lossless except a few frames at each cut) is coming.
  - **Segments: Keep** exports the segments; **Cut away** exports everything except them.
  - **Output: Merge** joins the segments into `name_trim.ext`; **Separate** writes `name_part01.ext`, `name_part02.ext` …
  - **Format: Same as input** keeps the file's format (no re-encoding). Or pick any **Converter preset** that takes this file (Video, Audio, Scale …, Rotate …; image and PDF presets aren't offered), and each finished cut goes through it, keeping its tags.
  - Tags (title, artist …) are kept. Chapters are dropped, since they'd point at the wrong times.

## Compressor

Drop any mix of files or folders (video, audio, images, GIFs, PDFs; up to 500 files, five folders deep). Each kind has its own settings, edited in the right-hand panel for the selected file and remembered between sessions:

- **Video** → MP4. *Fit size* (8 / 10 / 25 / 50 / 100 MB, two-pass so it lands just under the limit) or *Quality*; H.264, H.265 or AV1; resolution; audio keep / 128k / 96k / mute; CPU, NVIDIA (NVENC) or AMD (AMF), falling back to the CPU when the card can't.
- **How video is squeezed:** two-pass x264 / x265 with adaptive quantisation tuned for dark and flat areas, 10-bit H.265 and AV1 (no banding, fewer bits), SVT-AV1 in visual-quality mode, NVENC's highest-quality preset with look-ahead, spatial AQ and a full-resolution first pass. *Effort* (Fast / Balanced / Best) picks the presets. For tight size targets Nabbit finds the best resolution for *that* video: it encodes an 8-second sample at a few heights, scales each back up, scores it against the original (VMAF when the ffmpeg build has it, else SSIM) and uses the winner. High-frame-rate clips drop to 30 fps when bits are short.
- **Images** → quality, keep / JPEG / WebP / AVIF, longest side. Location and camera info is removed; HEIC, BMP and TIFF become JPEG; PNGs below High quality are reduced to 256 colours.
- **Audio** → 64–256 kbps MP3 / AAC / Opus (WAV and FLAC become MP3), optional mono.
- **GIF** → MP4 (much smaller) or a smaller GIF (colours, frame rate).
- **PDF** → Ghostscript Screen / eBook / Printer.
- **Fun mode** (video, images, audio) → deliberately crushed, for laughs. Sliders for *Compression* (down to CRF 51 / 8 kbit/s video, JPEG quantiser 69, 8 kbps MP3), *Resolution* (down to 1 %, never under 16 px, nearest-neighbour when small) and *Audio* (down to 8 kHz mono with a 4-bit crusher). Saved as MP4 / JPEG / MP3.

Each row shows the size before → estimated after; the files run one after another as jobs, and results are saved next to the originals as `name_small.ext`. *Keep the original if the result is bigger* deletes a result that didn't help. The rules and estimates live in `compressor.js` (tested in `test/compressor.test.js`); Explorer's **Compress ▸** uses the same job.

## The converter engine

Nabbit has its own conversion engine, a JavaScript port of [File Converter 2.3 CustomVer](https://github.com/Th3Nekit/FileConverter). File Converter isn't installed or launched, and there's no separate window. Progress shows in Nabbit's job list.

What was ported (in `converter/`):

| File Converter (C#) | Nabbit (JS) |
| --- | --- |
| `Settings.default.xml` (presets) | `presets.default.json` (68 presets plus a new **To Mov**) and `presets.js` |
| `ConversionJob_FFMPEG.cs` and `.Converters.cs` | `ffmpeg-args.js`: same codecs, quality tables, scaling, rotation, NVENC/AMF |
| `ConversionJob_ImageMagick.cs`, `_Ico.cs`, `_Gif.cs` | `image.js` and `pdf.js`: same sizing rules; ffmpeg replaces Magick.NET |
| `ConversionJob_Word/Excel/PowerPoint.cs` | `office-to-pdf.ps1`: same Office automation and busy-retry logic |
| `ConversionJobFactory.cs`, `ConversionJob.cs`, `PathHelpers.cs` | `index.js` and `paths.js`: routing, output name templates, timestamps, archive/delete actions |

- **Engines:** `npm run setup` downloads the same ffmpeg 8.0.1 and Ghostscript 10.02.1 builds that File Converter ships, pinned to a commit of its repository, into `vendor\engines`. `npm run dist` packs them into the installer.
- **Presets:** 69 presets are built in: File Converter's 68 plus **To Mov** (H.264 + AAC). New built-in presets are added to your list automatically, and presets you've deleted stay deleted. **Edit presets…** opens your own copy (`presets.json` in Nabbit's app-data folder) to change or add presets. **Reset presets** restores the defaults. To import presets from a File Converter settings file, run `node scripts/import-presets.js <Settings.xml>`.
- **Inputs:** video, audio, images (PNG, JPG, BMP, TIFF, WebP, AVIF, PSD, TGA, ICO, GIF, and more), PDF, and Word/Excel/PowerPoint (Office documents need Microsoft Office installed).
- **Hardware encoding:** NVIDIA NVENC or AMD AMF for MP4/MKV, chosen in the Converter tab.
- **Not ported:** CD audio and DVD ripping (they rely on File Converter's native Windows libraries). Camera RAW files (CR2, NEF, ARW, RAF), SVG and XCF also aren't ported, since File Converter reads those through ImageMagick plugins.

## Tests

```bat
npm test
```

This runs unit tests for the converter port, checking it against File Converter's original logic.

## Build a Windows installer

Double-click **`build.bat`** or run it from a terminal:

```bat
build.bat          :: install deps, fetch engines if missing, run tests, build the installer
build.bat clean    :: full rebuild from scratch
```

When it finishes, it opens the `dist\` folder containing `Nabbit Setup <version>.exe`.

## Layout

```
main.js            Main process: windows, dialogs, job runner (multi-step jobs, progress, cancel)
preload.js         Secure bridge (contextIsolation): exposes window.api to the UI
bridge.js          Local server the browser extension talks to (127.0.0.1:47815, paired with a token)
extension/firefox/ Firefox extension: toolbar popup, right-click menu, shortcuts (npm run pack:ext → dist/*.xpi)
converter/         Conversion engine ported from File Converter (see table above)
downloader/info.js Turns yt-dlp metadata + dislike votes into the Downloader card fields
downloader/formats.js Video/audio format choices for the Downloader dropdowns (shared by the window and tests)
downloader/ytmusic.js YouTube Music search request + parser (full result details)
downloader/soundcloud.js SoundCloud search (client_id lookup, request URL, result parser)
downloader/music.js  Music search fallback, album formats, numbering, cover art + lyrics (LRCLIB) embedding, zip writer
src/               UI: index.html, styles.css, renderer.js
scripts/setup.js   Downloads yt-dlp and the converter engines
scripts/pack-extension.js  Packs the Firefox extension into dist/nabbit-firefox.xpi
scripts/import-presets.js  Converts a File Converter Settings.xml into Nabbit presets
test/              Unit tests (npm test)
vendor/, bin/      Downloaded engines (not in git)
ROADMAP_PROMPT.md  Master prompt for building the app out in phases
```

## License

Nabbit is licensed under **GPL-3.0-or-later** (see `LICENSE`), because its converter engine is derived from File Converter (GPL-3.0, © Adrien Allard, with 2.3 CustomVer changes by Th3Nekit). If you share Nabbit, you must also make its source code available under the GPL. The bundled engines have their own licenses: ffmpeg is GPL-3.0 and Ghostscript is AGPL-3.0. Their notices are in `vendor\engines`.

## Notes

- Only download content you own or have permission to download. Many sites' terms of service forbid downloading.
- Compressor target size computes a bitrate from the file's duration. The quality presets use CRF.
