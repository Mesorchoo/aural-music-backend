# Aural Music Backend

This project should be paired with aural-music-frontend.

Use with BunJS (Tested with version 1.2.13)


## How it works.


Create your set your environment variables
- Create a .env file (or rename .env-example to .env) and set the following, adjusting to suit your setup.

LISTEN_PORT=3000
MUSIC_LIBRARY_PATH="/srv/music/Library"
ALLOWED_MUSIC_FILE_EXTENSIONS=".mp3,.flac,.opus"

Optionally set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (create an app at https://developer.spotify.com/dashboard).
When set, any album folder without an album_art file will have its art looked up on Spotify during a sync
and saved as album_art.jpg in the album folder, so it is only fetched once.

To fetch missing album art for the whole library ahead of time (instead of during a sync), run
`bun index.js --fetch-album-art`
This only needs MUSIC_LIBRARY_PATH and the Spotify variables set, and exits when finished without starting the server.

Playlists are saved as JSON files (one per playlist, named by its id) in a `.playlists` folder inside MUSIC_LIBRARY_PATH,
so they're shared between devices and included in any backup of your library. Set PLAYLISTS_PATH to store them somewhere else.
The backend needs write access to this folder.

Dolby Digital / Dolby Digital Plus (E-AC-3) audio, which most Dolby Atmos .m4a files use, can't be played by Chrome, Brave or Firefox.
If ffmpeg and ffprobe are installed (on the PATH, or set FFMPEG_PATH and FFPROBE_PATH), these files are transcoded to FLAC
the first time they're played, keeping all their channels (e.g. 5.1), and the FLAC copy is served from then on.
Atmos height/object information isn't kept: you get the 5.1 or 7.1 mix underneath it.
Copies are saved in a `.transcoded` folder inside MUSIC_LIBRARY_PATH (set TRANSCODE_PATH to store them elsewhere), so the backend
needs write access there. Remember to add .m4a to ALLOWED_MUSIC_FILE_EXTENSIONS.

The first play of each track waits for its transcode, and the frontend only sees the new file size after its next sync.
To transcode the whole library ahead of time instead, run
`bun index.js --transcode`
then sync. This only needs MUSIC_LIBRARY_PATH and ALLOWED_MUSIC_FILE_EXTENSIONS set, and exits when finished without starting the server.


### Opus copy of the library and quality report

`bun index.js --opus`

Transcodes every track into an Opus copy of the library, and checks each track for quality problems so poor copies can be found and replaced.
It needs ffmpeg and ffprobe (with libopus), only needs MUSIC_LIBRARY_PATH and ALLOWED_MUSIC_FILE_EXTENSIONS set, and exits when finished without starting the server.

- The copy goes in a `.opus` folder inside MUSIC_LIBRARY_PATH (set OPUS_PATH to put it elsewhere), with the same Artist/Album folders and album art,
  so it can be used as a library itself by pointing MUSIC_LIBRARY_PATH at it (remember to add .opus to ALLOWED_MUSIC_FILE_EXTENSIONS).
  The originals are never changed.
- OPUS_BITRATE sets the bitrate in kbps for stereo (default 160). Mono gets half, 5.1 and 7.1 (e.g. Dolby files) keep their channels and get proportionally more.
- Files that are already .opus are copied, not re-encoded. If an album has the same track in two formats, the lossless one is used.
- Tracks are processed OPUS_JOBS at a time (default: one per CPU core). Each track is decoded once, for both the transcode and the checks.
- Re-running only processes new or changed tracks (results are cached in `.quality-cache.json`), so it's quick to run again after replacing albums.

The report is written to `quality-report.csv` in the Opus folder, one row per track, worst first, and albums with problems are listed at the end of the output.
Each problem is rated **bad** (worth replacing), **warn** (worth a look) or **info**:

| Check | Rating |
|---|---|
| Lossless (e.g. FLAC) file whose audio stops at ~16-17 kHz, i.e. it was made from a low bitrate MP3/AAC | bad |
| Lossless file whose audio stops at ~20 kHz (probably from a high bitrate lossy file, or a band-limited master) | info |
| Lossy file with low bitrate (MP3 under 150k, AAC under 120k, Vorbis under 112k, Opus under 80k, for stereo) | bad |
| Lossy file with lowish bitrate (MP3 under 190k, AAC/Vorbis under 150k, Opus under 112k) | warn |
| Lossy file whose audio stops at ~17 kHz | warn |
| Sample rate under 44.1 kHz, or lossless under 16 bit | bad |
| Decoding errors (10 or more: bad, as the file is probably damaged) | warn |
| File can't be decoded at all | bad |
| Mono | warn |
| Clipping (keeps hitting full scale) | warn |
| Very quiet or silent | warn |
| Stereo file with both channels identical | info |

The cut-off checks compare the level of the 11-15 kHz band with higher bands: lossy encoders remove everything above a cut-off that depends on the bitrate,
leaving a sharp cliff that's still there after converting to FLAC. Quiet or very dull recordings don't have enough high frequency content to tell, and show "unknown" bandwidth.

- Install dependencies with 
`bun i`

- Run server with
`bun index.js`

- Bundle a single file
`bun build --target=bun index.js > /srv/music/backend.js`


- Create a service so you don't need to manually start it all the time. How to do this depends on your operating system.
Windows users look for NSSM (non-sucking-service-manager).
Linux users you probably already know how to do this.


### Music library structure.

Aural Music requires your Music library to be organised into folders by Artist, then within each Artist a folder for each Album,
then within each Album are the Music Track files, plus an optional album_art.webp (jpg and other formats should be supported but webp is recommended as it is a better format)
Track names should be have the track number first - this is so the tracks are ordered correctly - followed by the track name.
The Aural Music frontend supports a few variations on this and strips off the number and extension when displaying track names.

Supported audio formats can be configured in the ALLOWED_MUSIC_FILE_EXTENSIONS environment variable, but must be natively supported by the client.
In general most modern web browsers will support the usual mp3, flac, opus etc
Apart from Dolby files (see above), no transcoding is performed, so other formats need to be converted in advance.


eg:


Music
    > Black Sabbath
        > Paranoid
            > 01. War Pigs.opus
            > 02. Paranoid.ops
            > 03. Planet Caravan.opus
            ... etc
        > Master of Reality
            > 01. Sweet Leaf.opus
            > 02. After Forever.opus
            ...

