# Aural Music Backend

This project should be paired with aural-music-frontend.

Use with BunJS (Tested with version 1.2.13)


## How it works.


Create your set your environment variables
- Create a .env file (or rename .env-example to .env) and set the following, adjusting to suit your setup.

LISTEN_PORT=3000
MUSIC_LIBRARY_PATH="/srv/music/Library"
ALLOWED_MUSIC_FILE_EXTENSIONS=".mp3,.flac,.opus"

- Install dependencies with 
`bun i`

- Run server with
`bun index.js`

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
No transcoding is performed, if you want this you will need to transcode in advanced or modify the backend code.


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

