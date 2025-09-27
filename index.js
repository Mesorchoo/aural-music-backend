import { readdir, stat } from "node:fs/promises";
import path from "node:path";


const LISTEN_PORT = process.env.LISTEN_PORT;
const MUSIC_LIBRARY_PATH = process.env.MUSIC_LIBRARY_PATH;
const ALLOWED_MUSIC_FILE_EXTENSIONS = process.env.ALLOWED_MUSIC_FILE_EXTENSIONS.split(',').map(ext => ext.trim().toLowerCase());
const SECURITY_TOKEN = process.env.SECURITY_TOKEN;

// Check environment variables
if (!LISTEN_PORT || isNaN(parseInt(LISTEN_PORT))) {
    console.error("Error: LISTEN_PORT environment variable is not set or invalid. See README for details.");
    process.exit(1);
}

if (!MUSIC_LIBRARY_PATH) {
    console.error("Error: MUSIC_LIBRARY_PATH environment variable is not set. See README for details.");
    process.exit(1);
}

if (!ALLOWED_MUSIC_FILE_EXTENSIONS || ALLOWED_MUSIC_FILE_EXTENSIONS.length === 0) {
    console.error("Error: ALLOWED_MUSIC_FILE_EXTENSIONS environment variable is not set or empty. See README for details.");
    process.exit(1);
}

if (!SECURITY_TOKEN) {
    console.error("Error: SECURITY_TOKEN environment variable is not set. See README for details.");
    process.exit(1);
}

// Simple token-based authentication middleware
function authenticate(request) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader === `Bearer ${SECURITY_TOKEN}`) {
        return true;
    }
    return false;
}



const server = Bun.serve({
  port: LISTEN_PORT,
fetch(request) {
    try {

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
                    "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
                },
            });
        }
        
        // Authenticate request
        if (!authenticate(request)) {
            return new Response("Unauthorized", {
                status: 401,
                headers: { "Access-Control-Allow-Origin": "*" }
            });
        }

        const url = new URL(request.url);
        const pathname = url.pathname;

        if (pathname === "/artists") {
            return getFullArtistList().then(data => {
                return new Response(JSON.stringify(data), {
                    headers: { 
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    },
                });
            });
        }

        // Match /song/{artist}/{album}/{track}
        const songMatch = pathname.match(/^\/song\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (songMatch) {
            const artist = decodeURIComponent(songMatch[1]);
            const album = decodeURIComponent(songMatch[2]);
            const track = decodeURIComponent(songMatch[3]);

            return getTrack(artist, album, track, request);
        }

        return new Response("Not found", { 
            status: 404,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    } catch (err) {
        return new Response("Internal Server Error", { 
            status: 500,
            headers: { "Access-Control-Allow-Origin": "*" }
        });
    }
},
});

console.log(`Listening on ${server.url}`);





async function getFullArtistList() {    
    console.log('Client fetching Artist data');

    const entries = await readdir(MUSIC_LIBRARY_PATH, { withFileTypes: true });

    let output = [];
    for(let artist_name of entries) {
        if(!artist_name.isDirectory()) continue;
        output.push({
            artist: artist_name.name,
            albums: await getArtistAlbums(artist_name.name, MUSIC_LIBRARY_PATH)
        });
    }

    return output;

}

async function getArtistAlbums(artistName, basePath) {
    const artistPath = `${basePath}/${artistName}`;
    const entries = await readdir(artistPath, { withFileTypes: true });

    let output = [];
    for(let album_name of entries) {
        if(!album_name.isDirectory()) continue;
        // Check for album art (album_art.*)
        const albumDir = `${artistPath}/${album_name.name}`;
        let albumArtFile = null;
        try {
            const albumEntries = await readdir(albumDir, { withFileTypes: true });
            for (const e of albumEntries) {
            if (e.isFile() && /^album_art\.[^./]+$/i.test(e.name)) {
                albumArtFile = e.name;
                break;
            }
            }
        } catch (e) {
            // file doesn't exist or can't be accessed
        }

        output.push({
            album: album_name.name,
            tracks: await getAlbumTracks(album_name.name, artistPath),
            cover_art: albumArtFile ? `song/${encodeURIComponent(artistName)}/${encodeURIComponent(album_name.name)}/${encodeURIComponent(albumArtFile)}` : null
        });
    }

    return output;
}

async function getAlbumTracks(albumName, artistPath) {
    const albumPath = `${artistPath}/${albumName}`;
    const entries = await readdir(albumPath, { withFileTypes: true });

    let output = [];
    for (let track_name of entries) {
        if (!track_name.isFile()) continue;
        const ext = path.extname(track_name.name).toLowerCase();
        if (!ALLOWED_MUSIC_FILE_EXTENSIONS.includes(ext)) continue;

        const filePath = `${albumPath}/${track_name.name}`;
        output.push({
            track: track_name.name,
            size: (await stat(filePath)).size
        });
    }
    return output;
}



async function getTrack(artistName, albumName, trackName, request) {
    const filepath = `${MUSIC_LIBRARY_PATH}/${artistName}/${albumName}/${trackName}`;
    console.log('Client downloading', filepath);

    const range = request.headers.get("range");
    const { size } = await stat(filepath);

    let start = 0;
    let end = size - 1;

    if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            start = parseInt(match[1], 10);
            if (match[2]) {
                end = parseInt(match[2], 10);
            }
        }
    }

    const chunkSize = (end - start) + 1;
    const fileBlob = Bun.file(filepath).slice(start, end + 1);

    return new Response(fileBlob, {
        status: range ? 206 : 200,
        headers: {
            "Content-Type": `audio/${path.extname(trackName).replace('.', '')}`,
            "Cache-Control": 'max-age=31536000',
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Description": 'File Transfer',
            "Content-Transfer-Encoding": "binary",
            "Access-Control-Allow-Origin": "*"
        }
    });
}