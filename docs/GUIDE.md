# Nabbit

*(Formerly Clipsmith. Renamed because another app already uses that name.)*

A desktop media toolbox built with Electron: **Video Downloader · File Converter · Trimmer · Compressor**.

## Run it

You need [Node.js](https://nodejs.org) (LTS) installed.

```bat
cd F:\Apps\DL
npm install
npm run setup     :: downloads yt-dlp and Deno (which yt-dlp needs for YouTube), plus the converter's ffmpeg and Ghostscript
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

Turn it on with **Add Nabbit to the right-click menu in File Explorer** on the Converter page, or with **Explorer right-click menu** in the tray menu. Right-clicking a file then shows **Nabbit ▸**. On songs and videos it starts with **Play**, **Play next**, **Add to queue** and **Add to playlist…**, then **Separate stems** and **Search on Soulseek**, then **Share link** (videos), **Open In Trimmer**, **Compress ▸** and **Convert to ▸**: Explorer stops showing a static menu after about a hundred entries, so the quick actions come first, and videos don't list still-image or document formats under Other. Pictures get **Compress ▸** and **Convert to ▸**. The entries:
- **Play / Play next / Add to queue** put the file in Nabbit's player: Play starts it (and shows the window); Play next and Add to queue happen quietly, with a notification. Select several files to play or queue them all, in order. **Add to playlist…** shows your playlists (and **New playlist**) in Nabbit. Songs from outside your music folders work in playlists too.
- **Separate stems** opens Audio Tools → Split vocals and instruments with the file added, and splits it straight away with the model and settings picked there.
- **Search on Soulseek** opens the Music Downloader on Soulseek, searching for the song's artist and title (from its tags, else its file name).
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
- **Compress ▸** (videos, audio and pictures): **High quality**, **Balanced**, **Smallest file**, and for videos **Fit 10 / 25 / 50 / 100 MB**. **Open in Compressor…** opens the Compressor with the file loaded.

Inside Nabbit, right-clicking a song in the **Player** or a file in **Recent downloads** gives the same: Play, Play next, Add to queue, Add to playlist, **Separate stems**, **Compress** (opens the Compressor with it) and **Search on Soulseek**, for the kinds of file each fits.
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

### Audio Tools

The **Audio Tools** tab (06) lists its tools as rows you can fold open or shut (**Collapse all / Expand all** does them all); they all start folded. Ready now: the **Key & BPM finder**, **Mastering**, **Split vocals and instruments** and **Change pitch and tempo** (below).

### Look and motion

Nabbit has a monochrome Y2K / tech-manual look: square corners, monospace labels, hairline borders, corner brackets, ticks and barcodes, with red as the only accent. In light or dark.

- **Motion**: page headings type in, each tool's content fades up, the title-bar ruler and sidebar barcode scroll, progress bars pulse with a red shine, running jobs show a pulsing red dot, and changing the theme gives a short glitch.
- **Hover**: buttons fill from the left, the main buttons lift with a red and black shadow, thumbnail brackets widen, ✕ buttons spin.
- **Tooltips**: hover anything with extra info for a HUD bubble (black box, red offset shadow), in place of Windows' plain tooltips.
- **Accent colour**: Settings → Appearance → **Accent colour** changes Nabbit's red (highlights, the playing song, meters, waveforms, buttons that are on) to one of eight colours or any colour from the picker; **Default** brings the red back. Text on the accent switches to dark on light colours so it stays readable. The Jobs window follows it too.
- **Cursor effects**: faint points drift over the window, and the ones near the pointer light up and link to it. Turn them off in Settings → Appearance → Cursor effects.
- Windows' "Show animations in Windows" off stops all of it.
- Fonts: drop Space Mono, Michroma and Silkscreen into `src/assets/fonts` (see the README there) for the full look; otherwise Consolas and Bahnschrift are used.
- The line-art shapes in `src/assets/hud` are from the STUDIO DISK – CYBER Y2K ELEMENTS pack.

### Settings

**Settings** (bottom of the sidebar, also in Player mode, where it switches to the Toolbox; or Settings… in the tray menu) saves each change straight away:

- **Startup**: start Nabbit when Windows starts (on by default), and start minimized in the system tray (on by default). Works from source (start.bat) too; the login item is refreshed at every launch, so whichever copy you ran last is the one Windows starts.
- **Window**: keep running in the tray when the window is closed (on by default). Off: closing quits.
- **Appearance**: System, Light or Dark (same as the switch under the sidebar), cursor effects, and **Window blur**: Windows 11's acrylic material, so the desktop shows through the window background, blurred. It's on by default on Windows 11 22H2 or later and hidden on older Windows. The tool panels stay solid so text stays easy to read. Windows drops the blur for good once a window is maximized, so a blurred window is never maximized: Nabbit draws its own minimize / maximize / close buttons, and **maximize** (or double-clicking the title bar) fills the screen as a normal window and goes back the same way. Turning blur on asks for a restart; turning it off makes the window solid straight away.
- **File Explorer**: the right-click menu (on by default).
- **Where results go**: **Nabbit folders** (the default) or **Next to the original**. Nabbit's folders, made when first used:
  - **Music → Nabbit**: **Music** (music downloads), **Masters**, **Stems**, **Converted**, **Trimmed**, **Compressed**, **Pitch and Tempo**
  - **Videos → Nabbit**: **Videos** (video downloads), **Converted**, **Trimmed**, **Compressed**, **Frames** (Trimmer snapshots)
  - **Documents → Nabbit → Misc**: everything else (pictures, documents, data)

  A result goes by what it is: a video turned into an MP3 lands in Music → Nabbit → Converted, a song's spectrogram picture in Documents → Nabbit → Misc. Click a folder in Settings to open it. **Next to the original** saves converted, trimmed, compressed and mastered files, stems and frames beside the file they came from, as before. A converter preset whose output name points at a folder of its own keeps it; a folder picked under Split vocals and instruments → Save to is used for stems either way. The folder (`folders.js`, tested in `test/folders.test.js`) is chosen in one place for every tool.
- **Downloads**: the folder downloads are saved to. Not set: Videos → Nabbit → Videos for videos and Music → Nabbit → Music for music (the Music Downloader asks, starting there); **Reset** goes back to that.
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

Nabbit ships yt-dlp with **Deno** beside it (`bin\deno.exe`): since late 2025 yt-dlp needs a JavaScript runtime to read YouTube, and without one most videos show few or no formats. The bundled yt-dlp also **updates itself once a day** (a minute after Nabbit starts), so it keeps up with YouTube's changes after you install.

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

**DRM-protected or blocked SoundCloud tracks.** Some SoundCloud tracks are DRM-protected (SoundCloud Go+ only), and some SoundCloud refuses to give out at all ("HTTP Error 403: Forbidden": blocked in your country, private or removed); neither can be downloaded or streamed. (SoundCloud also answers 403 for a while after many lookups in a row, so the player asks twice more, 3 and 8 seconds later, before looking elsewhere.) When you open one, Nabbit looks for the same song on YouTube Music ("{artist} - {title}", matching title, artist and length) and opens that instead, with a note saying why. The player does the same and shows **Via YT Music**. If YouTube Music doesn't have it, you get a message saying so. Nabbit never tries to get around the DRM itself.

**Higher quality on YouTube Music.** When you open a SoundCloud song or album, Nabbit looks for the same release on YouTube Music in the background. It matches the title, the artist, and the length (or the track count for albums). If YouTube Music's best audio is clearly better, a notice at the top of the card shows both, for example **48 kHz · 160 kbps · Opus vs SoundCloud 44.1 kHz · 128 kbps · MP3**, with **Open song** / **Open album** to switch. It stays quiet when the artist offers their original file on SoundCloud, since that's full quality. Turn it off in Settings → Downloads. The numbers are what each site really serves: YouTube Music's free audio is usually Opus at about 130–160 kbps, 48 kHz (256 kbps AAC needs Premium).

**Highest quality · FLAC** or **Highest quality · MP3 320** (both up to 48 kHz). For **YouTube / YouTube Music only**: at the top of the format list (and in the browser extension's menu), FLAC being the default for its songs and albums. SoundCloud's streams don't go that high, so SoundCloud doesn't offer them and starts on the artist's original file when there is one (else the best stream). Nabbit takes the same stream as **OGG (remux)**, YouTube's 48 kHz Opus, and converts it: to **FLAC** (16-bit, which keeps the decoded audio exactly) or to **MP3** at 320 kbps, at the stream's own sample rate and never above 48 kHz. Both open in every player and hold the tags, cover art and lyrics. A file already in the chosen format is kept as it is, and so is an MP3 when FLAC is chosen, since converting can't improve it. The album view shows the result as "16-bit" or "320 kbps" and "Up to 48 kHz".

**Source quality.** When you convert, the card (or the album, from its first track) shows what the conversion starts from, for example **Source: Opus · 48 kHz · 140 kbps**. If the output asks for more than the source has, the line turns red and says so: a higher bitrate (**320 kbps from a 140 kbps Opus source**), a higher sample rate, or FLAC/WAV from a lossy stream. You get a bigger file, not better sound.

**Search or paste a link.** Type words to search YouTube Music, choosing **Songs**, **Albums** or **Playlists** with the chips under the search bar. Results show artwork, artist, album, year and length. They come from YouTube Music's own search endpoint, the same request yt-dlp makes (client WEB_REMIX), because yt-dlp's search listing only carries links. If that request fails, Nabbit falls back to yt-dlp's listing with fewer details. Switch the search between **YouTube Music** and **SoundCloud** with the toggle at the right of the chips (remembered between runs). SoundCloud results come from SoundCloud's own web search (api-v2, using the client_id from its page scripts, as yt-dlp does); if that fails, song searches fall back to yt-dlp's `scsearch`. Or paste a link to a song, album or playlist. Click a result to open it: songs, albums and playlists open beside the results (the open one is highlighted), so you can click through them. A pasted link opens on its own.

**Streaming (play without downloading).** Click ▶ on a song in the search results, an artist's songs or an album's tracks, or **▶ Play** / **▶ Play all** in the bottom bar. It plays in the same player as Player mode: its play bar runs across the bottom of the window while a song is loaded (see **Play bar** under Player mode), and the list you played from is the queue.

- **Title** opens the song in the Music Downloader; **artist** opens their artist page; the **cover** opens Player mode, where the now-playing panel shows the song's picture, its synced lyrics from LRCLIB (click a line to jump to it) and up next
- Under the artist, the status: **Downloading 40 %**, **Local file**, **Streaming**, **Buffering**, **Cached**, **Via YT Music** or **Couldn't play** (point at it for the reason)
- **✕** at the right end stops, closes the play bar and deletes the temporary song files
- The quality is set in Settings → **Streaming**: Low (~64 kbps), Normal (~128 kbps) or High (best)

**Download first or stream** (Settings → Streaming → **Download each song before it plays**; on by default): when on, each song (YouTube Music, SoundCloud or any other source) is downloaded whole into a temporary folder (`%TEMP%\nabbit-play`) and played from that file, so it never stutters and seeking is instant; the status shows the download's progress, then **Local file**. When you change songs the old file is deleted (the next song in the queue is downloaded ahead and kept until it plays); closing the player or Nabbit deletes them all. When off, songs play from the site straight away, as described next.

How streaming works: yt-dlp finds the song's audio stream for the chosen quality, and Nabbit's own small server on 127.0.0.1 (`streamer.js`) passes it to the player, so it starts quickly and seeking works. At the same time the whole song is saved to the **cache** (`%APPDATA%\Nabbit\stream-cache`), so the next play is instant and works offline; the status next to the time shows **Streaming** or **Cached**. The **next 10 songs** in the queue are fetched ahead, one after another, the next one first, their lookups 5 seconds apart (SoundCloud refuses a burst of them for a while; if it does, the rest wait for the next song) (downloaded whole, or saved to the cache), each with its details and artwork, so Up next fills in their pictures and lengths; a song that leaves those 10 (the queue changed) loses its temporary file. SoundCloud's segmented streams are joined by ffmpeg and play as they arrive (saved alongside; a stream that can't be copied as it is gets converted to MP3 on the fly); jumping ahead in one works once it's cached, a few seconds in. SoundCloud's "original file" downloads are never used for streaming. Songs are looked up while the pointer rests on their ▶, and the next song in the queue straight after the current one starts, so most songs begin within a second or two. If a song can't play, the reason shows under the title. Settings → **Streaming** sets the default quality, how much music to keep cached (256 MB to 10 GB, oldest songs go first) and clears the cache. As each song is cached (or downloaded first), its **details** (title, artist, album, album artist, year, genre, track number) and its **artwork** are kept too (`%APPDATA%\Nabbit\stream-meta`): YouTube's full-size picture or SoundCloud's 500 px artwork, cropped square. The player, the Up next list and Windows' media overlay then show that picture, offline too, and a cached song comes back with its details without a lookup. They go with **Clear cache**, and a week after their song is no longer on this PC.

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
- **Synced lyrics** from [LRCLIB](https://lrclib.net), a free and open lyrics database matched on artist, title, album and length. Embedded in the audio file itself (no separate `.lrc` file): an ID3 lyrics frame in MP3, a lyrics tag in M4A, FLAC, OGG and Opus. Synced lyrics keep their time stamps, which players that show synced lyrics follow. WAV, AAC and WEBM files can't hold lyrics, so they get none. Lookups go one at a time, with a short pause, as LRCLIB asks. When the exact match (artist, title, album, length) misses, LRCLIB is searched more loosely, in turn: by artist and title; as free text; by an "Artist - Song" title (when the uploader isn't the artist); and by title alone. A result is taken only if its length is within 3 seconds, and, for the looser searches, its artist matches however it's written ("A + B", "A, B", "A x B", "A feat. B"). Synced lyrics win over plain ones.

If a site only has combined video+audio, the audio is extracted as MP3.

**Separate state:** each tab keeps its own search, results, album or song, and choices, so you can switch between them without losing either.

### DRM services (Spotify, Apple Music, TIDAL, Deezer, Amazon Music, Qobuz…)

These use DRM, which Nabbit never gets around. Paste one of their links anyway (in either downloader): Nabbit reads what it is from the service's public page or API (no account) and opens the same music from **YouTube Music**, with a note saying so. A song or album opens its YouTube Music copy; a playlist (or an album YouTube Music doesn't have as one) is rebuilt song by song, and downloads, plays and tags like any album. Songs that aren't on YouTube Music are left out of the list.

### Soulseek

Choose **Soulseek** next to SoundCloud to search the Soulseek network: other users' shared folders, the same network Nicotine+ and SoulseekQt use. The search works the way [sockseek](https://github.com/fiso64/sockseek) does (its ideas, none of its code). Sign in first under **Settings → Soulseek**. Signing in with a new username and password creates the account. The client is built into Nabbit (`slsk.js`, written from the [Nicotine+ protocol documentation](https://nicotine-plus.org/doc/SLSKPROTOCOL.html)), so there's nothing else to install.

- **Albums or Songs.** Type `Artist - Album` (or `Artist - Title` for songs): the part before the spaced hyphen is used as the artist for matching and ranking. Featured artists and punctuation are dropped from the search.
- **Fallback searches.** If fewer than 3 albums (5 songs) match after the first search, Nabbit also searches with the first artist only, then each other artist, and (if set) the title alone. Soulseek penalises clients that search too often, so searches are limited to 34 every 220 seconds; you'll see a short wait if you hit it.
- **Filters and ranking.** Required conditions hide files (allowed formats, lowest lossy bitrate, exact match, banned users, a song's length within 3 s when it came from YouTube Music / SoundCloud). Preferences only reorder: lossless or MP3 first, hi-res, the title / album / artist in the path, a free upload slot, a short queue, speed. An album folder counts when at least 70 % of its audio files pass. *Lossless only* and *Exact match* are one click above the results; the rest is in **Settings → Soulseek → Search**.
- **One entry per album / song.** The same album shared by several users (matched by name without format / year tags, and track count) is one entry with its copies inside, best first; more copies rank it higher. Click an entry to see the copies and (for albums) the tracks of the copy you pick.
- **Downloads move on by themselves.** *Download album* starts with the best copy. If that user declines, can't be reached, stalls for 30 s, or keeps you queued for 2 minutes while other copies are left, the remaining tracks come from the next copy (matched by track title, else position). Users whose downloads failed are ranked lower, and hidden after two failures. Files go to `<Downloads>\Soulseek\<album>`.
- **Other inputs (as in sockseek).** With Soulseek selected, the search box also takes `title=Song, artist=Name, length=3:35` (or `album=…`), playlist / album / track links from YouTube, YouTube Music, SoundCloud (read with yt-dlp), Spotify (from its public embed page; no account), Bandcamp (track, album or artist page), MusicBrainz (release, release group, recording, collection), `slsk://user/path/file` and `slsk://user/path/folder/`, and the path of a `.csv` or `.txt` list. One song or album searches straight away; more open in **Batch**.
- **Batch.** Paste or drop any mix of the inputs above, one per line, click **Preview** to check what was read, then **Find & download all**: each item is searched (stopping at the first good match) and downloaded with the same fallbacks, one after another, in one job. Plain lines follow the Songs / Albums chip; `s:` makes a line a song. A line can carry sockseek-style conditions in quotes: `"Artist - Album" "format=flac; br>=320; strict-album=true; album-track-count>=10" "format=flac"` (required, then preferred). Lines starting with `#` are skipped. CSV columns are found by name (Artist, Title/Track Name, Album, Length/Duration, Exportify's headers included): rows with a title are songs, rows with only an album are albums. Spotify liked songs and private playlists need an export (e.g. Exportify) to CSV.
- **Simple or Advanced.** *Simple* (the default) shows one row per album with the matching YouTube Music album's cover, title, artist and year, the best copy's quality and size, and its track list; Nabbit picks the copy. *Advanced* shows every copy, user and file.
- **YouTube Music tags.** When a Soulseek album matches a YouTube Music album, the downloaded files get its cover (embedded in FLAC, MP3 and M4A, and saved as `cover.jpg`), album, artist, year, track numbers and track titles.
- **Find on Soulseek.** An album or song opened from YouTube Music or SoundCloud has a *Find on Soulseek* button: it searches with the exact artist, title / album, length and track count.
- A download waits in the user's queue until they have a free slot; the job shows your place. If the connection drops, it resumes where it stopped when they retry.
- Nabbit doesn't share your files. Some users only upload to people who share, so some requests are declined. Forwarding the listening port (default 2234) on your router lets more users connect to you; otherwise Nabbit connects out to them through the server.
- The password is stored encrypted with Windows' data protection (Electron `safeStorage`).
- Only download music you have the right to.

## Player mode

**Nabbit** himself (the pixel bunny from the icon) hops around the bottom of the window (along the play bar when it's showing): crouch, spring, land, a few hops at a time, then a rest where he blinks. **Drag him** anywhere: he dangles and swings as you move him. **Throw him** (let go while moving): he flies at the speed you threw him, tumbling, bounces off the window's edges and the floor, and skids to a stop, with puffs of dust where he hits; after a real fall or a throw he lies there a moment and gets back up. His scarf, and the logo's, take the accent colour (Settings → Appearance). He stands still when Windows is set to reduce animations.

**Toolbox / Player** under the logo switches the whole window between the tools and a music player for your own files. Nabbit remembers which one you used last.

**Sources** (the switcher in the list's header, kept): **Nabbit Home** (the first time you open Player mode), **Local Files** (your library, as below), **YouTube Music**, **SoundCloud** and **Nabbit Holes**. Choosing anything in the sidebar goes back to Local Files.

- **YouTube Music / SoundCloud: your home.** **Sign in with your browser** opens the site in your browser; sign in there (if you already are, nothing more to do) and the **Nabbit browser extension** (connected: Settings → Browser extension) hands your sign-in for that site to Nabbit, and your home shows. The extension only does this while Nabbit is waiting for it (for 15 minutes after you click, for that one site, once), only to the Nabbit app on this computer; Firefox asks you once to let it read that site's sign-in (if it hasn't asked, click the Nabbit toolbar button: it shows **Sign Nabbit in to …**). Without the extension, **or sign in here, in a Nabbit window** opens the site's sign-in page in a window of Nabbit's instead. Nabbit only reads your own lists, and songs play as they do from the Music Downloader (through the play bar, cached or downloaded first, never with Go+ / Premium streams). **Refresh** loads it again; **Sign out** forgets the sign-in and empties that window's storage.
  - **YouTube Music:** your home's own shelves (Quick picks, Listen again, Mixed for you, …), then **Recently played**, **Liked songs** and **Your playlists**. Your sign-in is kept in Nabbit's own storage for YouTube on this PC (Nabbit notes only that you're signed in, and your name). (Google sometimes refuses sign-ins in an app's window, "This browser or app may not be secure": signing in with your browser avoids that.)
  - **SoundCloud:** SoundCloud's picks for you (your mixes, stations, Weekly Wave …), **From your feed**, **New sets in your feed**, **Recently played**, **Your likes** and **Your playlists and albums**. The sign-in is kept encrypted for your Windows account (`%APPDATA%\Nabbit\accounts.json`).
  - Songs: click ▶ or double-click to play, the section as the queue (8 show; **+ N more** for the rest). Albums, playlists and mixes: click to play from the first song, all of it as the queue (a mix SoundCloud or YouTube Music won't list is read the way the Music Downloader opens it). Artists open their page in the Music Downloader.
- **Nabbit Home: a home page made from your own music.** A greeting with your numbers, **Shuffle everything**, and quick links (Loved, 4 stars and up, Recently added, All songs). Then **Listen again** (what you played last, your files and streamed songs), **On repeat** (your most played in the last 30 days), **Your mixes** (your top artists with songs of the same genre, your top genres, Never played, Loved mix; reshuffled each time), **New in your library** (albums added in the last 30 days), **Forgotten favourites** (loved or 4-star songs not played in 60 days), **Your playlists** (right-click one to open it) and the top of your **YouTube Music / SoundCloud** homes once they've loaded. A song counts as played once half of it (or 4 minutes) has played; your plays are kept on this PC. **Customize** hides the parts you don't want.
- **Nabbit Holes: a map of your taste**, drawn like a brain. **You** sit in the middle, wired to your artists (your library's, weighted by how many songs, loved and 4-star ones counting more, plus the artists of your likes and recently played on YouTube Music and SoundCloud when you're signed in; the top 12). Each of them is wired to the artists their fans also like (YouTube Music's "Fans might also like"). Artists new to you glow red: the more of yours lead to one, the bigger and brighter. Signals run along the wires; faint neurons fill the background.
  - Click an artist: why it's there ("Because you listen to …"), **▶ Top songs**, its songs to play one by one, **Grow from here** (adds the artists their fans like; double-clicking an artist does the same) and **Artist page** (in the Music Downloader). **Picks for you** along the bottom lists the strongest new ones.
  - **Last.fm** (when it's set up and signed in: Settings → Last.fm): your **top artists** over the period you pick at the top (7 days, Month, 3 months, 6 months, Year, All time; kept) join your taste, counting by plays (on a log scale, so a few favourites don't crowd out the rest), and the top shows you ("Last.fm · you · 48,213 scrobbles since 2018 · 2,310 artists"). Last.fm's **similar artists** join YouTube Music's (those both name come first), and a clicked artist shows **your plays**, its **listeners** and **scrobbles**, how much it's like your artists ("92% like your artists"), and its **tags**.
  - **Views** (top right, kept; the same map in each): **Brain** (as above) and **Tree** (from "Your taste" down: your artists, then theirs, with a badge on each branch: ♥ yours, the fit % for a new one, LIB for one already in your library; drag sideways for the rest of it).
  - Drag to move around (or move an artist), scroll to zoom, **Centre** goes back to you, **Remap** reads your taste again. What each artist leads to is kept a week (`%APPDATA%\Nabbit\discovery.json`).

- **Library (sidebar):** a filter box; **Local Files** (all your music), **Recently added** (last 30 days), **Loved** and **4 stars and up**; your **Artists**, which are your artist folders, the first folder inside each library folder (`Music\Artist\Album\song`), whatever the tags say (click one to show only theirs, again to show all; songs sitting right in a library folder aren't under any); your **Folders**. Music and your download folder are there at first; **+ Add folder** adds another, ✕ (on hover) stops showing one (the files stay), **Rescan** looks for new and changed files. Nabbit also looks each time it starts.
- **Albums (middle):** grouped like a classic library: the album's name and year, e.g. "The Autumn Effect (2005)", and its length, its cover (a cover image in its folder first: cover, front, folder, albumart … also in an Artwork / Covers / Scans subfolder; else the picture embedded in the file; else any image in the folder), the artist, year, format and sample rate, then "Disc 1", "Disc 2" … and the tracks with number, title, artist, rating and time. Several artists written "A; B; C" become separate names (each its own link, each in the Artists list). Files without an album tag group by their folder; files without tags take "Artist - Title" from their name. Double-click a song (or its cover for the album) to play from there; right-click shows it in its folder. Click the stars to rate a song. An artist's name (in the list, the panel or the play bar) opens their YouTube Music page in the Music Downloader. **Sort: Album / Folder** switches between albums and your folder tree (folders in order, files by name; each folder is headed by its album's name and year, or the folder's name if it holds several albums; point at the header to see the folder's path).
- **Now playing (right):** **Speed** (tick it, then −50 % to 300 %; kept between runs; like changing the sample rate, faster is higher; scrolling on it moves one semitone, 100 cents, at a time; double-click the slider for 100 %), the album's name above the cover (click it to go to the album: yours in the library, a streamed one in the Music Downloader), the cover (double-click it to see it at full size; click or Esc closes it). When the song has a music video, a **Loop** takes the cover's place: 8 silent seconds of it, filling the top of the panel behind the speed and album name, down to where the cover sits (zoomed to fill; nothing in the panel moves), fading into the panel at the bottom, repeating while the song plays, with a small cover beside the title (double-click it, too, for the full-size cover) (cut from about 40 % in, the last second faded into the first so it never jumps; from a video beside the song, else just that part fetched from YouTube's music video, kept in `%APPDATA%\Nabbit\loops`, the newest 400; the next two songs' loops are made while this one plays, and the music videos of the ten after them are looked up, so jumping ahead needs only the clip). Songs played from the Music Downloader get one too (their music video is looked up by first artist and title; the answer is remembered, and a miss is tried again after a week). A song from the Music Downloader is looked up (lyrics, loop) once it's downloaded or fetched ahead, so its own artist and details are known first. Lyrics, music videos and the same song on YouTube Music are looked up by the song's name only: anything in brackets ("(feat. …)", "[prod. …]", "(Official Video)", "*SPED UP*") and an unbracketed "ft. / feat. / prod. …" are left out of the search. A song with no music video keeps its cover. Next to the cover, **Switch to video** (both show when you point at the cover; the video is shown 16:9): the song's music video in place of the cover (double-click it for full screen; Nabbit remembers the choice, so the next songs show theirs too). A local video comes first: the file itself, or a video beside it with the same name. Otherwise Nabbit looks for the official music video on YouTube by artist and title (skipping lyric, live, cover, remix and "Topic" uploads), remembers it for the song, and downloads it at up to 720p into the temp folder (only the one showing is kept). **Local / YouTube** on the video picks the sound: **YouTube** plays the video with its own audio (from the point your song had reached); **Local** keeps your file playing and the video follows it, muted and kept in step (best when the video is the same length as the song). Nabbit remembers the choice. Songs streamed from **YouTube Music** and **SoundCloud** have **Switch to video** too: their music video is found the same way (by first artist and title; "(Official Music Video)", then "(Music Video)", then "(Video)" first; videos YouTube won't play on this PC are skipped) and always plays muted, in step with the song. **Switch to loop** (or **Switch to cover**) goes back to your file at the same point. **Not this one** tries the next result. a small cover beside the title and artist, ♥ and rating, the format (e.g. "FLAC 44.1 kHz, 16-bit, 1,051k, Stereo, 3:32"), the lyrics (synced ones follow the song and scroll; click a line to jump to it), found in the file's tags, else a .lrc file beside it (same name as the song, or ending in its title), else on LRCLIB (online, matched on artist, title, album and length; each song is looked up once and kept; a miss is tried again after a week). The panel says where they came from, and, at the bottom, **Next** (the next song and how many are left): click it for the next 10 songs in a pop-up over the lyrics (double-click a song to play it; click outside or Esc closes it). The panel itself doesn't scroll; only the lyrics do. The library sidebar scrolls when it's long.
- **Playlists** (sidebar, under Library): **+ New** makes one; click one to see its songs in their order. Drag a row to move it, ✕ takes it out (the file stays), **Rename** (or double-click the title) and **Delete playlist** (click twice). Add songs by right-clicking them, or by dragging them from the list onto a playlist in the sidebar. **Save as playlist** in the Up next pop-up keeps the queue. Playlists are kept in `%APPDATA%\Nabbit\playlists.json`; a song that's no longer in your library shows crossed out.
- **Right-click a song:** Play, **Play next**, **Add to queue**, **Add to playlist** (or a new one), Take out of this playlist (in a playlist), Show in folder.
- **Last.fm** (Settings → Last.fm): Nabbit sends what you play in Player mode to your Last.fm profile, your own songs and ones from the Music Downloader alike. It needs your own free Last.fm API account (**create one** opens the page; any name, no callback URL needed): paste its **API key** and **shared secret**, click **Save**, then **Sign in to Last.fm** and approve Nabbit in the browser that opens. After that, **now playing** shows on your profile as a song starts, and it's **scrobbled** once you've heard half of it or 4 minutes (songs under 30 seconds aren't; skipped-over parts don't count). Only the song's own details are sent: a song played from a playlist, your likes or a mix has no album (the playlist's name, owner and picture aren't the song's); one played from a real album (YouTube Music's albums, a SoundCloud set by the songs' own artist) has that album, and a song whose lookup finds its album gets it then. Plays made offline wait in `%APPDATA%\Nabbit\lastfm-queue.json` and are sent later. **Send ♥ as Last.fm loves** loves / unloves the song on Last.fm when you click ♥. The secret and the sign-in are stored encrypted for your Windows account.
- **Picks up where you left off:** the song you were playing and its queue (up to 2,000 songs) come back when Nabbit starts, paused at the same point; press play to carry on. Songs no longer in your library are left out.
- **Gapless:** a few seconds into a song, the next one (your own file, with no video showing) is loaded on a second player and starts right as this one ends, so albums that run straight through (live albums, mixes) don't pause between tracks. Songs from the Music Downloader and music videos still change the usual way.
- **Keys** (in Player mode, unless you're typing in a box; **?** shows them): Space play / pause, ← → 5 seconds back / on, Shift + ← → previous / next song, ↑ ↓ volume, **M** mute, **S** shuffle, **R** repeat, **Q** up next, **V** video / loop, Ctrl + F filter the library. The media keys work anywhere.
- **Windows media controls:** Nabbit acts like a Windows media player. While a song is loaded (playing or paused), the keyboard's **media keys** (play / pause, next, previous, stop) always go to Nabbit, so a browser tab or another app that starts playing can't take them over; with the player closed they go back to other apps. Settings → Window → **Media keys always control Nabbit while a song is loaded** turns this off (then Windows gives them to whichever app played last). Hover Nabbit on the taskbar for **⏮ ⏯ ⏭** buttons under its thumbnail. Windows' media overlay (by the volume flyout) shows the song, its cover and Nabbit's name, and headphone buttons work too.
- **In step with the effects:** effects make the sound a little later than the player's clock (the Mastering preset's spectral compressor, plugins); the lyric highlight and a synced music video wait for it, so they match what you hear.
- **DJ mode** (the **DJ** button on the play bar, or **D**): your songs blend into each other instead of changing at the end. Click the button for its pop-up: on / off, the **crossfade** length (2–32 seconds, 12 by default), **Match the tempo and beats**, and **When shuffling, play next what goes best**. Under them it shows the playing and next song's tempo and key and how they'll mix.
  - Each song is analysed once, with the same key and BPM finder as the Audio Tools: its tempo, where its first beat is, its key (with its Camelot number), where its sound starts and stops, and its loudness every half second. That takes a second or two a song, in the background, and is kept in `%APPDATA%\Nabbit\dj`. The tempo and key show under the song's format while DJ mode is on.
  - The mix starts on a bar line of the playing song, the crossfade's length before its sound stops (skipping silence at the end), and the next song comes in on its first beat (skipping silence at the start), on an equal-power curve so the loudness holds.
  - **Stretch** (in the pop-up, 70–130 %, double-click for 100 %): the playing song's tempo, separate from **Speed** (Speed is never touched by Stretch or by tempo matching). The song plays at Speed × Stretch. By default Stretch works like a turntable's pitch fader: tempo and pitch move together, with no stretching, so the sound stays clean (a 2 % change is about a third of a semitone). **Key lock** (in the pop-up) makes Stretch keep the pitch instead: the player stretches the tempo, and with Speed away from 100 % too, Nabbit's own pitch shifter (about 46 ms of delay, on only then, with a short dip as it comes or goes) moves the pitch by Speed. DJ mode uses Stretch for tempo matching and Speed for key shifts; you can also set Stretch by hand.
  - **Key shift** engine (in the pop-up): DJ mode's and Speed's own pitch engine, separate from Audio Tools' (so Mono, Chord or Resynth picked there never reach a mix, and Audio Tools' formant and chord settings don't either). **Auto** is **WSOLA** (punchy drums and natural voices: what works best in a mix); **Pro** keeps the formants (voices when the key moves a lot); **Phase vocoder** for the shortest delay. The beat holding allows for each engine's delay.
  - **Transition** (in the pop-up): an effect on the song going out, on its beat grid (the one you set in Audio Tools → Beat grid, else the analysis), done live by the time shaper:
    - **Auto**: a **Brake** when the beats can't be held (tempos too far apart), else a plain crossfade.
    - **Brake**: a tape stop over the mix's last bar (or its last beats), at full level until it starts, then gone.
    - **Stutter** (a beat roll): from the first bar line past halfway through the crossfade.
    - **None**: a plain crossfade. The pop-up's plan says which one is coming ("· goes out brake").
  - **Match the tempo and beats:** when the two tempos are within 3 % (8 % with Key lock on), or one is half or double the other, the next song comes in with **Stretch** set to the playing one's tempo and is held on its beats (within about 10 ms) by small speed changes. Once the old song has gone, Stretch eases back to 100 %, so the song returns to its own tempo (at the Speed setting). Off, or when the tempos are further apart, it's a plain crossfade.
  - **With Speed on**, songs keep that speed (tempo and pitch, like a sample rate) and the tempo matching goes on Stretch on top of it.
  - **Shift the next song into key** (off by default): the next song is moved by whole semitones, from −5 to +8, so its key fits the playing song (same key, a step round the Camelot wheel, or the relative major / minor; smaller shifts win ties). The shift goes on **Speed** (it switches on and its slider glides there as the song comes in: 105.9 % for +1 semitone; the song fading out stays where it was) and the tempo match on **Stretch**, so the beats are held whenever the two tempos are within 3 % (8 % with Key lock), whatever the shift. After the mix Stretch eases back to 100 %: the song then plays at the shift's speed (tempo and pitch, like a sample rate), and the next mix starts from there. When a later song needs no shift, Speed goes back to 100 % and switches off again (unless you'd switched it on yourself). The tempo, key and shift you hear show under the song ("128 BPM (124) · 4A · F minor · +1 st"), and the pop-up shows what's planned ("→ +1 st: 4A F minor · beats held · Stretch 97.4 %"). With **When shuffling, play next what goes best** on as well, songs are picked counting the shift they'd get. (With Key lock on but no pitch shifter available, a shift is chosen for the key or for bringing the tempos within about 1 %, and played like a record.)
  - **Cut to the action** (on by default): skips long intros and outros. **Go straight to** says where the next song comes in: **the first vocals** (the default), **the first chorus**, or **where it gets loud**. The first two read the song's synced lyrics (from the same places as the lyrics panel: tags, a .lrc file beside it, or LRCLIB; for the next song they're fetched while it loads): the next song starts so that its first sung line, or its first chorus (the first two lines in a row that come back later in the same order), arrives as the crossfade ends, on the bar it starts on; the playing song hands over to end its crossfade just after its last sung line. A song without synced lyrics (or with a chorus past halfway) uses its loudness, below. The pop-up says which it's using ("straight to the vocals"). Each song's main part is found from its loudness and bass (where it's within 6 dB of its usual loud level, on a bar line; not more than 40 % in from either end). The playing song hands over as its main part ends, and the next one starts far enough in that its main part (the drop, the kick coming in) arrives just as the crossfade ends. A song whose intro is shorter than the crossfade starts from the top. The next song only goes straight in when its beats are matched to the playing one; when the tempos are too far apart (as can happen when a same-key song is picked), it comes in from its intro, and the pop-up says so (the playing song's outro is still skipped). The pop-up shows where the mix will happen and what's skipped.
  - **When shuffling, play next what goes best:** of the next 20 songs in the queue (analysed ahead in the background, one at a time), a song in the **same key** is moved up to play next whenever there is one (with Shift into key on: the same key once shifted), the closest in tempo of those. With none, it's the one closest in tempo and in key on the Camelot wheel (a step round, or the relative major / minor).
  - **Reroll the queue** (button in the pop-up): shuffles the songs still to come again (the ones already played stay put) and turns Shuffle on. With the option above on, the best of the new next 20 is picked to play next; don't like it, reroll again.
  - **Next** (the button, Shift + → or the media key) in DJ mode jumps the playing song to where its crossfade starts, so the change is still a mix; press it again during a mix to finish the mix at once. When the next song can't be mixed it changes as usual.
  - **Songs from the Music Downloader mix too**, with each other and with your own files. The next one is fetched ahead as usual (downloaded whole first, or saved to the cache), then analysed and loaded for the mix from that copy; the song mixing out keeps its temporary file until the mix ends. A streamed song is analysed once it's whole on your PC, so with **Download songs before playing** off, the first mix into a song still arriving may be a plain crossfade. Songs with a video showing and **Repeat: this song** change as usual. Pausing pauses both songs; choosing another song stops the mix.
- **Play bar extras:** an **oscilloscope** of what you're hearing, after the effects and the volume (it follows the pitch, so a note's wave stands still; in Player mode it sits in the sidebar under the Toolbox / Player switch, in the Toolbox on the play bar left of the controls, hidden on narrow windows), the **position bar as the song's waveform** (the played part in red; click or drag anywhere on it to jump; a song streamed from the Music Downloader gets its waveform once it's cached or downloaded), and the **volume slider as a left / right output meter** after the volume (a side's whole bar, and the light at its right end, turn red for a moment when it reaches 0 dB, i.e. clips). Waveforms are worked out once per song and kept in `%APPDATA%\Nabbit\waves`.
- **Play bar** (across the whole bottom of the window, under the sidebar; in the Toolbox too while a song is loaded, so the music carries on as you work): cover, title, artist, ♥ and rating; **repeat** (click for the whole list, again for this song, marked with a 1, again for off; remembered), previous, play / pause (Space), next, shuffle; the position and length; an **Effects** button, mute, volume and **✕** (stop and close). Drag the cover or title in the play bar out of the window to drop the song's file into a folder, a chat or another app (your own files; not songs streamed from the Music Downloader).
- **Effects** (the sliders button; red while any are on): a chain applied live to whatever the player plays, top to bottom, each with **On / Off** and **↑ ↓** to change the order (all remembered). The play bar's volume comes after all of it.
  - **Stereo**: Mid (0–100 %), Width (0–200 %) and Pan, as in the Mastering tool
  - **EQ**: the Mastering tool's graphic EQ: drag a point (left / right for the frequency, up / down for the gain), scroll on it for the width, double-click to turn a band on or off; **Flat** resets the gains. The spectrum of what you're hearing moves behind it while a song plays
  - **Mastering preset**: the Audio Tools chain at its preset values (Stereo → Spectral compressor → EQ → Clipper)
  - **Plugins (VST3)**: your VST3 effects, in their own order. **Add a plugin ▾** opens a list you can type in to find one (it stays open while the lyrics move) of the ones in `C:\Program Files\Common Files\VST3` and any folder you add (**Add folder…**). Click a plugin's name to open its window; its settings are kept a moment after you change them (and when you close its window or Nabbit). Plugins run in a separate helper program, `bin\nabbit-vsthost.exe`, which you build once from `vsthost\` (see `vsthost\README.md`); if a plugin crashes, only the helper stops, the music plays on and **Start the plugins again** brings them back. Plugins add about 0.07 s of delay and get the audio in small blocks (about 94 a second), so their analysers move smoothly; if Nabbit falls behind and a block comes back late, the delay grows a little (up to about a quarter second) so it doesn't keep crackling; the Plugins section shows the audio going out to them and coming back, and the level going in. VST2 (`.dll`) plugins and instruments aren't supported.
  Nothing is processed until an effect is first turned on, and with every effect off the chain is taken out of the path. The effects run on the audio thread, so a busy window doesn't make them crackle. While they're set up, your files play through Nabbit's local stream server (Web Audio can't read `file://` audio). While something plays, small moving bars show next to **Player** under the logo. Scrolling anywhere on the play bar changes the volume; scrolling on the position bar skips 5 seconds back or forward. Windows' media keys and the volume flyout control it too.

Ratings and loved songs are kept by Nabbit (library.json), not written into the files. Files the window can't play (e.g. WMA, ALAC) are listed greyed out.

## Recent downloads

The box on the right of the window (it replaces the old Jobs list). **Now** shows what's running, with progress; ✕ cancels one. A finished job moves down to **Done** after a few seconds; a failed one stays with its error. **Done** lists the files Nabbit made lately (downloads, conversions, trims, masters …), newest first, with a picture of each (a frame of a video, an audio file's cover):
- **Drag a file out** of the window onto the desktop, a folder, Explorer, Discord or an editor to copy it there, like a browser's downloads.
- **▶ Play:** point at a song or video and its grip (⋮⋮) turns into ▶: it plays in Nabbit's player (on the play bar), then the rest of the list; the one playing is marked red, and clicking it again pauses. The same ▶ is on the **Converter**'s and **Compressor**'s files (the compressed result once it's done), and in the stem splitter (the number plays the song; **Play: Vocals / Drums / …** each stem). Files outside your library play like library songs (cover, waveform, effects) for as long as Nabbit is open.
- Double-click (or Enter) opens it in its own app; ▤ shows it in its folder; right-click: **Open**, **Show in folder**, **Download again** (puts its link back in the Video Downloader), **Remove from list**, **Delete file…** (to the Recycle Bin).
- **Filter** finds one by name; **Clear** empties the list (the files stay); **Open folder** opens the download folder.

The **Recent** button in the sidebar hides or shows the box. In a narrow window it's hidden and the button slides it over the page instead.

## Discord

**Settings → Discord** shows what you play in Player mode on your Discord profile, with your Nabbit as the picture: **Off**, **Songs** ("Listening to Nabbit": the song, "by" the artist, the album on hover, a progress bar that follows Speed, pauses and jumps) or **Songs + tools** (when nothing's playing, what the Toolbox is doing: "Converting 3 files", never file names). It goes through the Discord app on this PC (its local pipe, `discord-rpc.js`): no Discord sign-in and nothing else is sent; if Discord isn't open, Nabbit tries again every 15 seconds. A song paused for 5 minutes disappears from your profile.

- **Streamed songs** (YouTube Music, SoundCloud) show their own cover with your Nabbit as the small badge, and a **Play on YouTube Music / SoundCloud** button (Discord doesn't show your own buttons to you; others see them). **Your own files** show your Nabbit as the big picture: their covers never leave your PC.
- **Picture: My Nabbit** is him exactly as he looks (Settings → Nabbit: colour and clothes). Discord only shows pictures from the web, so it needs **Share links** on: Nabbit then serves the picture at your Share address (`…/nabbit/n/<token>-<hash>.png`, nothing else), and a new look gets a new address. With Share links off, or **Ready-made**: the ready-made Nabbit nearest his colour (no clothes), from Nabbit's Discord app.
- **Discord application ID:** Discord shows the app's name after "Listening to", so it needs Nabbit's app on discord.com/developers. `scripts/discord-assets/README.txt` says how to make it and upload the ready-made Nabbits; paste its Application ID in Settings (or build it in as `DISCORD_APP_ID` in `main.js`).

## Share links

Share a video on your PC as a link that plays right inside Discord, only while Nabbit is open. It goes through **Tailscale Funnel** (free for personal use), so your IP address stays hidden: viewers reach Tailscale's servers, which pass the request to your PC over an encrypted connection.

- **Set up (once):** **Get Tailscale** (Settings → Share links) downloads the current Windows installer straight from Tailscale (its name read from Tailscale's package list). Install it and sign in. Making your first link turns sharing on (or tick **Share links while Nabbit is open**); while Tailscale isn't installed or signed in yet, Nabbit checks again every 10 seconds and starts by itself. The first time, Tailscale asks for Funnel to be turned on for your tailnet: **Turn on Funnel for your tailnet** opens the page, approve it, and sharing starts. The status then shows your address, `https://<your-pc>.<tailnet>.ts.net`.
- **Make a link** (it's copied, ready to paste in Discord: `https://<your-pc>.<tailnet>.ts.net/nabbit/v/<code>`):
  - **Explorer:** right-click a video → **Nabbit ▸ Share link (copy)** (first in the menu). Works with Nabbit closed or in the tray; a notification says when the link is copied.
  - **Drop** a video on the Share links section in Settings.
  - **Recent:** right-click a video → **Share link (copy)**.
  - **Share a video…** in Settings picks one. **New links last** 1 hour, 1 day (the default), 1 week, 30 days or until you take them back.
- **Copy links as** (Settings): **Just the video** (the default) copies a link straight to the video file (`…/v/<code>.mp4`): posted on its own, Discord shows only the player, with no title, site name or link text. **With title and picture** copies the link's page instead (below). Each link in the list also has a button for the other kind. The clean link is the file itself, so when a video has a lighter copy for Discord (below), that copy is what anyone opening the clean link gets; the page link keeps the original for browsers.
- **In Discord:** the link shows the video's player with a picture from a few seconds in (Discord reads the page's Open Graph tags: `og:type video.other`, `og:video`, `og:image`). Discord's player only plays MP4 / MOV with H.264 video (and AAC or MP3 sound) and WebM with VP8 / VP9 / AV1 (and Opus or Vorbis), so anything else gets an **MP4 copy** for the link first, with progress at the bottom of the window: repackaged when only the container is wrong (an H.264 MKV: seconds, nothing re-encoded), the sound converted to AAC when only that is wrong, or re-encoded to H.264 (HEVC, AVI, …). MP4s that keep their index (the moov box) at the end, as OBS and phone recordings often do, also get a quick copy with it moved to the front (nothing re-encoded): Discord measures the video within 10 seconds, and a big file with its index at the end can't be measured that fast through your upload, so it would show as a plain link. The copy is kept in `%APPDATA%\\Nabbit\\share-files` and deleted when the link ends or you take it back; your original isn't touched. Opened in a browser, the link shows a simple player with a Download link.
- **The list** in Settings shows each link's views and when it ends, with **Copy link** and **Take back** (it stops working at once). Links that end drop off by themselves. Kept in `%APPDATA%\Nabbit\shares.json`.
- **Only while Nabbit is open:** Nabbit runs `tailscale funnel` itself and stops it when it closes (or when you turn sharing off); the files stay on your PC and are read from there each time someone watches.
- **What's reachable:** only the links you've made. Nabbit's share server listens on your PC only (127.0.0.1); the Funnel forwards `/nabbit` to it, and it answers nothing but a link's page, its video file (with seeking) and its picture. Each link's code is 128 random bits, so links can't be guessed, but anyone you give one to (or who sees it in a channel) can watch until it ends or you take it back.
- **Lighter copy for Discord's player** (on by default): Discord downloads the whole video, in one request, and drops it if the page and the video together take more than 10 seconds. So a video bigger than about 5 seconds of your upload gets a smaller copy that only Discord's fetcher (Discordbot) is given; anyone opening the link in a browser gets the original, full quality. The copy is H.264 in two passes, checked afterwards and made again at a lower bitrate if it came out over (up to three tries), so it always fits; its height (144p–1080p, never above the original) and sound (96 kbps stereo down to 24 kbps mono) follow from how much fits per second. Your upload speed is learned from Discord's own downloads of your videos, finished or given up on (shown in Settings); until then Nabbit assumes 1.2 MB/s, so copies are 6 MB, and always 3–45 MB. A video too long to fit even at the lowest quality is shared without one (Discord then shows a plain link that opens in a browser).
- **Embed not showing?** **See what was asked for** (under the list) opens `%APPDATA%\\Nabbit\\share-log.txt`: every request to your links, with the range asked for, the answer, whether it finished, how much was sent and how fast, how long it took and who asked (Discord's fetcher says Discordbot).
- **Speed:** viewers stream from your PC, so it depends on your upload speed; Tailscale also limits Funnel bandwidth (they don't publish the figure).

## Video Downloader · Batch

**One link / Batch** under the search box. In **Batch**, paste links one per line (a playlist adds each of its videos), choose **Each as** (quality and MP4 / MKV / WEBM, or audio only as MP3 or M4A) and press **Add to queue**. The **Queue** downloads two at a time into the folder in the bottom bar; each row shows the title, site, length, format, progress and state. Drag queued rows to change the order; ✕ removes one (or cancels it while it runs). **Pause** lets the running ones finish and starts no more until **Resume**; **Clear done** removes finished and failed rows. Each download also shows under **Now** and then **Done** in Recent downloads.

## Audio Tools · Key & BPM finder

Laid out like Antares Auto-Key. **Use file**: drop a song (or click to choose one) and Nabbit works out its **BPM**, **key** (with its relative major / minor: ⇅ switches to it), **tuning** (A=440 Hz, or what the song is tuned to, in orange when it's off) and **Camelot** code. **Manual**: pick a key and mode, and type or tap the tempo. **/2** and **X2** halve or double the tempo (whether a song is "90" or "180" is often taste). **Scale** shows the key's scale on the two-octave piano (major, minor, harmonic / melodic minor, the modes, pentatonics, blues, chromatic); its notes are lit and named, the tonic marked in red; click a key to hear it. **Tap tempo** (or press T): tap along to the beat. **Write to tags** saves BPM and key in the file (MP3: TBPM / TKEY; FLAC, Ogg, Opus: BPM / INITIALKEY). **Copy** copies "113 BPM · Ab Major (4B)".

How it works (`analyzer.js`, written for Nabbit from the standard methods; no outside code or service): the song (up to 10 minutes from its middle) is decoded to mono at 22 kHz. Tempo: the onset strength (spectral flux) is autocorrelated over 50–220 BPM with a preference for tempos near 120, then refined to 0.05 BPM by fitting a beat grid, which also gives the first beat. Tuning: strong spectral peaks' distance from the equal-tempered grid. Key: a pitch-class profile of the whole song compared with the published Krumhansl–Kessler and Temperley key profiles in all 24 keys. It runs in a background thread and takes a second or two.


## Audio Tools · Mastering

A mastering chain built from an FL Studio mixer preset, with that preset's settings as the defaults. Nabbit doesn't load the plugins; each stage is its own version of what the plugin does:

1. **Stereo** (like kHs Stereo): **Mid** is how much of the mono content passes (0–100 %), **Width** the level of the sides (0–200 %; it needs a stereo song), **Pan** the balance.
2. **Spectral compressor** (like Spectral Compressor, with the preset's exact settings: window 2048, overlap 16, 150 ms attack, 300 ms release, sidechain channel link 80 %, downwards −50 dB at 500:1 with a 6 dB knee, upwards 1:1): every one of 1,024 frequency bands is held down above −50 dB. **Amount** (the plugin's Output Gain: 0–20 dB, 10 dB by default) lifts only that compressed signal, which is then mixed 50 / 50 with the original, as in the plugin, so at the default settings this stage makes the song about 5 dB quieter, not louder.
3. **EQ** (in place of Fruity Parametric EQ 2, laid out like ZeroEQ): low cut, low shelf, five bells, high shelf, high cut, flat by default. Drag a point (left / right: frequency, up / down: gain), scroll on it for the width (Q), double-click to turn a band on or off. **Flat** sets every gain back to 0 dB. The live spectrum of what's playing is drawn behind the curve.
4. **Clipper** (like PeakEater): **Input** 0–15 dB (8 dB by default) into a cubic soft clipper with a 0 dB ceiling. Above about 10 dB it distorts hard.

Drop a song on the tool (or click to choose one): it goes onto the **play bar** at the bottom (marked *Mastering*), which plays it like any song: ▶ / ❚❚ (and the media keys), the waveform to seek, scrolling on it for 5 s, ⏮ back to the start, and the bar's **volume** for how loud you hear it (it doesn't change the export or the meters). The music pauses. The song plays through the chain, so every slider and every **On / Off** switch is heard as you change it. If you then play something in the Player, it takes the bar back; **▶ Play on the bar** in Mastering puts the song back on it. Clicking the title on the bar shows Mastering. **A/B** plays the original for comparison. **Out** shows the output peak of the left and right channels, **Clip** how many dB the clipper is taking off on each. The visualizers follow Pulse (a free audio visualizer), redrawn in Nabbit's style with a phosphor glow and afterglow on a CRT-like screen:
- **Lissajous**: the stereo image as a smooth trace (straight up is mono, the diagonals are left and right), with the correlation under it (+1 mono, 0 wide, below 0 out of phase, in red).
- **Oscilloscope**: the waveform, locked to the pitch so it stands still (up to 4 cycles); the header shows the pitch and note.
- **Loudness**: two analog VU needles (0 VU = −12 dBFS), and LUFS (EBU R128 / ITU BS.1770): momentary (400 ms) with a bar, short-term (3 s) and integrated (the whole play, gated), plus the highest peak. **Reset** starts integrated and peak again; a new song does too.
- **Spectrum**: mid (white) and side (red), or left and right (**M/S · L/R**), 20 Hz – 20 kHz with a +3 dB / octave slope so a mix reads level, and a spectrogram under it (red where it's loudest). Point at it for the frequency, level and note. Double-click a slider to put it back to the preset's value; **Reset** does them all. Each new song starts from the preset's settings.

**Export master** renders the whole song through the same chain and saves "<name> (master)" next to it, keeping the tags and cover, as **Auto** (MP3 stays MP3 at 320 kbps, WAV stays WAV, anything else becomes FLAC), **WAV 24-bit**, **FLAC 24-bit** or **MP3 320 kbps**. The master lines up with the original sample for sample. Progress shows under **Now** in the Recent downloads box.

## Browser extension (Firefox)

The extension in `extension/firefox/` sends links from Firefox to the app. Nabbit opens the link in the **Video** or **Music Downloader**, looked up as if you'd pasted it. You still pick the format and click Download.

**Signing Nabbit in (0.6.0):** when you choose Player → YouTube Music / SoundCloud → **Sign in with your browser**, the extension hands Nabbit your sign-in for that site, as described under Player mode. It needs the **cookies** permission and, asked for once, access to youtube.com / soundcloud.com; it sends nothing unless Nabbit is waiting for that sign-in. After updating, reload the extension (or install the new .xpi).

**Ways to send a link**
- Click the toolbar button, then **Video** or **Music**. This sends the page you're on.
- Right-click a page, a link, or a video or audio player, then choose **Nabbit → Open in …**.
- On **YouTube**, the **Download** button left of Like opens a download menu for the video. Its **♪** part opens one for the audio. On **SoundCloud** track, album and playlist pages, the download button in the action row opens one too.
  - **Video options:** Quality (Best down to 360p) and Format (MP4, MKV, WEBM).
  - **Music options:** the same as the app's album row: Format, Quality, Sample rate, and Folder or Zip for albums and playlists.
  - **Download** starts right away, saves to your Downloads folder, and remembers your choices. A small **jobs window** pops up at the bottom right of the screen with progress and **Show in folder**. **✕** closes it, and **Open app** opens Nabbit. The jobs also appear under **Now** in the app's Recent downloads box.
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
  - **Cut: Keyframe** (lossless and instant) copies the streams. A video segment starts on the keyframe at or before its start, and the list marks segments that will start earlier with **⚠**, saying by how much. **Exact** (the default) re-encodes (x264 CRF 18, VP9 for WebM, the audio format's own encoder) to start and end on the exact frame; formats Nabbit can't encode into (AVI, WMV …) become MP4. **Smart** (lossless except a few frames at each cut) is coming.
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

## Audio Tools · Change pitch and tempo

Drop a song on **Change pitch and tempo** (or click to choose one). It plays on the **play bar** through Nabbit's player, so every change is heard at once:
- **Pitch** in semitones (−12 to +12) and **Fine** in cents (±50), and **Tempo** (50–200 %), each on its own: the player changes the tempo with the pitch kept, and DJ mode's pitch shifter moves the pitch. Double-click a slider to put it back.
- **Key**, **Tempo** (BPM) and **Length** show before and after (the key and BPM come from DJ mode's analysis; the BPM is always a whole number). Under the key is its relative major / minor ("F♯ minor" ↔ "A major"); **⇅** swaps which one is shown big, and is kept. **To BPM** sets the tempo to reach a BPM.
- **Beat grid**: the song's waveform (fine: every 5 ms) with its beat grid over it: a thin line every beat, a numbered line every bar, bar 1 in red. Set the **BPM** (whole numbers; **÷2** / **×2**) and line the bars up with the downbeats with **Offset** (where the first bar starts, in ms; **− / +** nudge 5 ms, with Shift 1 ms; double-click it for the analysis's), or just **drag the grid** on the waveform. Zoom: **2 / 8 / 32 bars** or **All**; scroll to move along the song; click to play from there (the red line is where it's playing). **Reset** goes back to the analysis. **♩ Metronome** clicks on every beat of the grid while the song plays (higher on each bar's first beat), on the player's own audio clock and at the play bar's volume, so you can hear whether the grid sits right; it's kept on or off for next time. The grid is kept for that song and used everywhere: the play bar's grid, the Shaper, slice stretch / map and the export.
- **Pitch engine** (Nabbit's own code, `pitch.js`; for this tool's song, kept for next time; DJ mode has its own, under **Key shift** in its pop-up):
  - **Phase vocoder**: smooth; best on full mixes and held notes (46 ms delay).
  - **WSOLA**: time-domain, the idea SoundTouch uses: drums stay punchy and voices natural, no "phasey" sound; dense mixes can double a little (93 ms).
  - **Pro**: a finer phase vocoder that keeps the **formants** (the voice's resonances) where they were, so a voice moved up doesn't go chipmunk; **Formant** moves them on their own (±12 st), and **Fine** goes to ±100 cents (93 ms).
  - **Mono** (voice): for one voice or instrument (PSOLA): it follows the pitch period by period, formants kept, with **Formant** to make it deeper or brighter. The pitch tracking holds its octave (a jump is only believed when the old octave no longer fits), rides through short consonants and breaths (80 ms) and is smoothed over the last three readings, so it doesn't jump octaves or drop out. Very natural on solo vocals and stems; not for full mixes (93 ms).
  - **Resynth** (robot): the sound's tone colour sung on one steady note: the song's key note (shown as e.g. "A3 (robot)"), moved by **Pitch**; **Formant** changes the voice (46 ms).
  - **Chord** (harmonizer): the voice sung on every note you hold, each a **steady note** at exactly that pitch (like Resynth, but in the voice's own sound, not a robot): the voice engine (Mono's) lays its grains down at each note's period. Hold notes on the keyboard shown (click; **Latch** keeps them), on the computer keys **A W S E D F T G Y H U J K** (C to C), on a **MIDI** keyboard, or pick a preset (**Major, Minor, Power, Octaves, 7th, Sus4**, built on the song's key note, marked). **Pitch** / **Fine** move every note. With nothing held, the song plays as it is. Best on a vocal or one instrument (93 ms).
- **Rhythm** (all live, in the player; the export renders the same with `rhythm.js`):
  - **Slice stretch**: to the tempo set with **Tempo** / **To BPM**: the song is cut at its drum hits (found from rises in level, band by band) and the pieces stretched or squeezed to fit, each hit's first 25 ms untouched, so drums stay sharp.
  - **Slice map**: the same cuts, the pieces just moved to their new places, not stretched: tight drum loops (gaps when slower, tails cut when faster).
  - Both play **live**: the song is read once (a second or two, "Reading the song…"), then the player's slicer plays each slice from its start as the play bar reaches it, so dragging **Tempo**, seeking, or switching between the two (or the **Cut at** choice) is heard at once. Pitch and the engines stay live on top.
  - **Cut at** (both slice modes), as FL Studio does it: **Markers** uses the file's own slice markers when it has them (a WAV with cue points saved by FL Studio, Edison, ACID and the like; markers within 30 ms of a sixteenth are taken to be on it), otherwise the hits found in it; **Hits** always uses the hits found; **Grid** cuts at every sixteenth of the beat grid.
  - Which one: FL Studio's advice is **Slice stretch** when speeding a loop up (its tempo at or under the target) and **Slice map** when slowing it down; the note under the buttons says so when the other would fit better.
  - **Shaper** (live, like ShaperBox's TimeShaper): a curve of **how late the sound plays** across one cycle on the song's beat grid (0 at the top, a whole cycle late at the bottom; the hatched part reads from the cycle before). It only reads what has already played, so there's no added delay, and the export does exactly the same.
    - **Smooth**: the speed follows the curve, like a record or a tape: pitch and tempo together. **Steps**: the curve is held for each sixteenth of the cycle: pieces moved, the pitch untouched.
    - **Presets**: **Half-time** (a ramp to a quarter bar over each bar: the bar at ¾ speed), **Tripletize** (a ramp to a sixteenth in every beat: each beat at ¾ speed, its first three sixteenths spread across it as triplets), **Pitch** (the same ramp over a quarter: every beat an octave down), **Stutter** (each beat's first quarter four times), **Tape stop** (slowing to a stop over a bar), **Reverse** (half the cycle backwards), **Flat**.
    - **Length** of the cycle: triplet (1/16T … 1/2T), straight (1/128 … 32 bars) or dotted (1/16d … 3 bars).
    - **Editing**: drag a point (it snaps to the grid; **Alt**: free); double-click empty space to add one, double-click a point (or right-click it) to remove it; **Ctrl + double-click** a point for a second one at the same spot (a jump); drag a line up or down to bend it. **2×** puts the shape twice in the cycle, **◀ ▶** move it by a sixteenth, 🗑 makes it flat, **↶ ↷** undo / redo. A line shows where the song is in the cycle. The shape is kept for next time.
    - Jumps cross-fade over 3 ms, started 5 ms early, so there are no clicks.
- **The play bar's waveform** shows the beat grid (4/4): a faint line every beat and a stronger one every bar, from the song's tempo (rounded to a whole BPM) and first beat (DJ mode's analysis, now done for every song you play and kept), or the grid you set here.
- **Scrolling** on any slider in Nabbit moves it a step (Shift: five), here and in Mastering, the DJ pop-up and elsewhere.
- **Like a record** changes pitch and tempo together, from the pitch (like the player's Speed, or changing the sample rate): the cleanest sound.
- **Export** saves "name (+2 st, 110 %)" (plus the rhythm and engine, e.g. "half-time, chord") next to the song, keeping its tags and cover, as **Auto** (MP3 stays MP3, WAV stays WAV, anything else becomes FLAC), WAV, FLAC or MP3. With a rhythm mode, a formant shift or the Pro, Mono, Resynth or Chord engine, Nabbit renders it with the same code you heard (`pitchtempo-worker.js`), so the export matches the preview. With just the phase vocoder or WSOLA it uses ffmpeg: **Rubber Band** (high quality) when your ffmpeg has it (the tool's header then says so), else resampling for the pitch and ffmpeg's time-stretch for the rest of the tempo.

The settings apply to that song only (other songs play as usual); **Reset** puts it back as recorded. Tested in `test/pitch.test.js` (each engine: pitch, level, formants kept), `test/rhythm.test.js` (hits found and moved to the right times, still sharp) and `test/pitchtempo.test.js` (the ffmpeg filter).


**Audio Tools → Split vocals and instruments** splits songs (or a video's sound) into **stems**: vocals, drums, bass and the rest, or vocals / instrumental, with a neural network run on your own PC. Nothing is uploaded. It's modelled on Ultimate Vocal Remover (UVR).

- **Setup:** it needs ONNX Runtime, which `npm install` adds (about 70 MB in `node_modules`). Until it's there, the screen says so. **Models aren't bundled**: under **Models**, download only the ones you want.
  - **Kim Vocal 2** (64 MB, recommended, listed first and picked by default): vocals and instrumental. The fastest, and the cleanest split of the two.
  - **Demucs v4 · 4 stems** (~170 MB): vocals, drums, bass, other, plus the **instrumental** (all but the vocals). For when you need the drums or bass on their own; slower. Meta's Demucs (MIT), from the ONNX export Microsoft made for its WebNN stem separator.
  - **More of UVR's MDX-Net models** (50–64 MB each): **Inst HQ 3** (very clean instrumentals), **Voc FT** (clean vocals, for acapellas), **Karaoke 2** (takes the lead vocal out and keeps the backing vocals: best run on a vocals stem). Each gives its stem and the mix minus it.
  - **Change folder…** keeps the models somewhere else (another drive); the downloaded ones move with it. **Delete** frees the space again.
- **Your own models:** **+ Add your own model (.onnx)…** (or drop .onnx files on the screen). Two kinds work: UVR's **MDX-Net** models (any from UVR's own folder) and **Demucs** ONNX exports (inputs `x` + `xt`, or a waveform in and stems out). They're used where they are, not copied, so they take no extra space; **Remove** only takes one off the list. An MDX-Net model is recognised the way UVR does it (a hash of the file, looked up in UVR's model table, fetched once and kept a month), which gives its settings. If UVR doesn't know it, **Set up…** asks for them (`n_fft`, `dim_f`, `dim_t`, compensation and the stem it gives, from the model's notes; the usual values are filled in). UVR's PyTorch models (`.ckpt`, `.pth`: Roformers, VR Arch, MDX23C) can't run here.
- **Settings:** the **model**; which stems to **save** (all by default); **WAV** (24-bit), **FLAC** or **MP3** (320 kbps); **GPU** or **CPU**; and for Demucs, **Fast** (segments overlap by a quarter) or **Best** (by half: smoother joins, ~1.5× slower). **Try 30 seconds first** splits 30 s from a third of the way in, to check a model on a song before the whole thing.
- **GPU:** your graphics card through **DirectML** (any DirectX 12 GPU: NVIDIA, AMD or Intel). If it can't load or run a model, that song goes on the CPU instead, and the job says so. How long a song takes depends on your hardware; a GPU is usually several times faster than the CPU (try 30 seconds first to get a feel).
- **Output:** a folder for each song, `name - stems`, with `name (Vocals).wav` and so on, tagged like the song (title + the stem). It goes next to the song unless you click **Save to** and pick a folder (each song still gets its own folder in it); **· next to the song** goes back.
- **Master:** a finished song's row has **Master: Vocals / Instrumental** buttons (any stem, if you saved neither), which open that stem in **Mastering** just above, ready to work on. The songs run one after another as jobs (they show under Recent, and can be cancelled there). Stems are 44.1 kHz, which the models were trained on.
- It runs in its own process, so a GPU driver crash can't take Nabbit down; the model is unloaded a minute and a half after the last song. The signal processing (STFT, the models' chunking and overlap) is `stems.js` (tested in `test/stems.test.js` with stand-in models); the model runs in `stems-worker.js`.

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
stems.js           Stem splitter's signal processing (Demucs and MDX-Net); stems-worker.js runs the model (ONNX Runtime)
scripts/setup.js   Downloads yt-dlp, Deno and the converter engines
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
