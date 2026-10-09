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

