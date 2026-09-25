import { readdir, stat } from "node:fs/promises";
import path from "node:path";

console.log(process.env);

const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';
const LISTEN_PORT = process.env.LISTEN_PORT;
const MUSIC_LIBRARY_PATH = process.env.MUSIC_LIBRARY_PATH;
const ALLOWED_MUSIC_FILE_EXTENSIONS = process.env.ALLOWED_MUSIC_FILE_EXTENSIONS?.split(',').map(ext => ext.trim().toLowerCase());
const SECURITY_TOKEN = process.env.SECURITY_TOKEN;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

// `bun index.js --fetch-album-art` fetches missing album art for the whole library, then exits
const FETCH_ALBUM_ART_ONLY = process.argv.includes('--fetch-album-art');

// Check environment variables
if (!LISTEN_HOST) {
    console.error("Error: LISTEN_HOST environment variable is not set or invalid. See README for details.");
    process.exit(1);
}

if (!FETCH_ALBUM_ART_ONLY && (!LISTEN_PORT || isNaN(parseInt(LISTEN_PORT)))) {
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

if (!FETCH_ALBUM_ART_ONLY && !SECURITY_TOKEN) {
    console.error("Error: SECURITY_TOKEN environment variable is not set. See README for details.");
    process.exit(1);
}

if (FETCH_ALBUM_ART_ONLY && (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET)) {
    console.error("Error: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set to fetch album art. See README for details.");
    process.exit(1);
}

// Albums Spotify had no result for, so we don't search again until restart
const spotifyMisses = new Set();
let spotifyToken = null;
let spotifyTokenExpires = 0;

if (FETCH_ALBUM_ART_ONLY) {
    await fetchAllAlbumArt();
    process.exit(0);
}

// Simple token-based authentication middleware
function authenticate(request) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader && authHeader === `Bearer ${SECURITY_TOKEN}`) {
        return true;
    }
    return false;
}



const CORS_HEADERS = { "Access-Control-Allow-Origin": "*" };

const server = Bun.serve({
    hostname: LISTEN_HOST,
    port: LISTEN_PORT,
    async fetch(request) {
        try {
            // Handle CORS preflight
            if (request.method === "OPTIONS") {
                return new Response(null, {
                    status: 204,
                    headers: {
                        ...CORS_HEADERS,
                        "Access-Control-Allow-Methods": "GET, OPTIONS",
                        "Access-Control-Allow-Headers": "Authorization, Content-Type, Range",
                        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
                    },
                });
            }

            // Authenticate request
            if (!authenticate(request)) {
                return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
            }

            const url = new URL(request.url);
            const pathname = url.pathname;

            if (pathname === "/artists") {
                const data = await getFullArtistList();
                return new Response(JSON.stringify(data), {
                    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
                });
            }

            // Match /song/{artist}/{album}/{track}
            const songMatch = pathname.match(/^\/song\/([^/]+)\/([^/]+)\/([^/]+)$/);
            if (songMatch) {
                let segments;
                try {
                    segments = songMatch.slice(1).map(decodeURIComponent);
                } catch {
                    return new Response("Bad request", { status: 400, headers: CORS_HEADERS });
                }
                return await getTrack(...segments, request);
            }

            return new Response("Not found", { status: 404, headers: CORS_HEADERS });
        } catch (err) {
            console.error('Error handling', request.url, err);
            return new Response("Internal Server Error", { status: 500, headers: CORS_HEADERS });
        }
    },
});

console.log(`Listening on ${server.url}`);





// Read a directory, logging and skipping it (instead of failing the whole scan) if it can't be read
async function readDirSafe(dir) {
    try {
        return await readdir(dir, { withFileTypes: true });
    } catch (err) {
        console.error('Cannot read', dir, err.message);
        return [];
    }
}

// Artist/album folders, ignoring hidden and NAS system folders like .stfolder or @eaDir
function libraryFolders(entries) {
    return entries
        .filter(e => e.isDirectory() && !/^[.@]/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function findAlbumArt(entries) {
    return entries.find(e => e.isFile() && /^album_art\.[^./]+$/i.test(e.name))?.name || null;
}

async function getFullArtistList() {
    console.log('Client fetching Artist data');

    const output = [];
    for (const artist of libraryFolders(await readDirSafe(MUSIC_LIBRARY_PATH))) {
        output.push({
            artist: artist.name,
            albums: await getArtistAlbums(artist.name),
        });
    }
    return output;
}

async function getArtistAlbums(artistName) {
    const artistPath = `${MUSIC_LIBRARY_PATH}/${artistName}`;

    const output = [];
    for (const album of libraryFolders(await readDirSafe(artistPath))) {
        const albumDir = `${artistPath}/${album.name}`;
        const albumEntries = await readDirSafe(albumDir);

        const albumArtFile = findAlbumArt(albumEntries)
            || await fetchAlbumArtFromSpotify(artistName, album.name, albumDir);

        output.push({
            album: album.name,
            tracks: await getAlbumTracks(albumDir, albumEntries),
            cover_art: albumArtFile ? `song/${encodeURIComponent(artistName)}/${encodeURIComponent(album.name)}/${encodeURIComponent(albumArtFile)}` : null
        });
    }
    return output;
}

async function getAlbumTracks(albumDir, albumEntries) {
    const output = [];
    for (const entry of albumEntries) {
        if (!entry.isFile()) continue;
        if (!ALLOWED_MUSIC_FILE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) continue;

        try {
            output.push({
                track: entry.name,
                size: (await stat(`${albumDir}/${entry.name}`)).size
            });
        } catch (err) {
            console.error('Cannot read', `${albumDir}/${entry.name}`, err.message);
        }
    }
    return output.sort((a, b) => a.track.localeCompare(b.track));
}

async function getSpotifyToken() {
    if (spotifyToken && Date.now() < spotifyTokenExpires) return spotifyToken;

    const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        body: 'grant_type=client_credentials',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`
        }
    });
    if (!res.ok) throw new Error(`Spotify auth failed: ${res.status}`);

    const json = await res.json();
    spotifyToken = json.access_token;
    // Refresh a minute before it actually expires
    spotifyTokenExpires = Date.now() + (json.expires_in - 60) * 1000;
    return spotifyToken;
}

// fetch() that waits and retries when Spotify rate limits us
async function spotifyFetch(url, options, attempts = 3) {
    for (let i = 1; ; i++) {
        const res = await fetch(url, options);
        if (res.status !== 429 || i >= attempts) return res;
        const wait = parseInt(res.headers.get('Retry-After')) || 5;
        console.log(`Spotify rate limit hit, waiting ${wait}s`);
        await Bun.sleep(wait * 1000);
    }
}

// Look up album art on Spotify and save it as album_art.jpg in the album folder.
// Returns the saved file name, or null if disabled / not found / failed.
async function fetchAlbumArtFromSpotify(artistName, albumName, albumDir) {
    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;

    const key = `${artistName}/${albumName}`;
    if (spotifyMisses.has(key)) return null;

    try {
        const token = await getSpotifyToken();
        const query = `${artistName.replace('&', 'and')} ${albumName}`;
        const res = await spotifyFetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=1`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);

        const json = await res.json();
        const images = json.albums?.items?.[0]?.images || [];
        if (images.length === 0) {
            console.log('No Spotify album art found for', key);
            spotifyMisses.add(key);
            return null;
        }

        const largest = images.reduce((a, b) => (b.width || 0) > (a.width || 0) ? b : a);
        const imageRes = await fetch(largest.url);
        if (!imageRes.ok) throw new Error(`Spotify image download failed: ${imageRes.status}`);

        const fileName = 'album_art.jpg';
        await Bun.write(`${albumDir}/${fileName}`, imageRes);
        console.log('Saved Spotify album art for', key);
        return fileName;
    } catch (err) {
        console.error('Error fetching album art for', key, err.message);
        return null;
    }
}



const IMAGE_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
};

function contentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return IMAGE_TYPES[ext] || `audio/${ext.replace('.', '')}`;
}

// Walk the whole library and fetch art for every album folder that doesn't have any
async function fetchAllAlbumArt() {
    console.log('Fetching missing album art for', MUSIC_LIBRARY_PATH);
    let existing = 0, saved = 0, missing = 0;

    for (const artist of libraryFolders(await readDirSafe(MUSIC_LIBRARY_PATH))) {
        const artistPath = `${MUSIC_LIBRARY_PATH}/${artist.name}`;

        for (const album of libraryFolders(await readDirSafe(artistPath))) {
            const albumDir = `${artistPath}/${album.name}`;

            if (findAlbumArt(await readDirSafe(albumDir))) {
                existing++;
            } else if (await fetchAlbumArtFromSpotify(artist.name, album.name, albumDir)) {
                saved++;
            } else {
                missing++;
            }
        }
    }

    console.log(`Done. ${saved} saved, ${missing} not found or failed, ${existing} already had art.`);
}

async function getTrack(artistName, albumName, trackName, request) {
    const notFound = () => new Response("Not found", { status: 404, headers: CORS_HEADERS });

    // Only serve music files and album art
    const isMusic = ALLOWED_MUSIC_FILE_EXTENSIONS.includes(path.extname(trackName).toLowerCase());
    if (!isMusic && !/^album_art\.[^./]+$/i.test(trackName)) return notFound();

    // Each part must be a single folder/file name, so the path can't escape the library
    if ([artistName, albumName, trackName].some(p => p === '.' || p === '..' || /[\\/\0]/.test(p))) {
        return notFound();
    }
    const filepath = `${MUSIC_LIBRARY_PATH}/${artistName}/${albumName}/${trackName}`;

    let size;
    try {
        ({ size } = await stat(filepath));
    } catch {
        return notFound();
    }
    console.log('Client downloading', filepath);

    const headers = {
        ...CORS_HEADERS,
        "Content-Type": contentType(trackName),
        "Cache-Control": 'max-age=31536000',
        "Accept-Ranges": "bytes",
    };

    const match = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    if (!match) {
        return new Response(Bun.file(filepath), { headers: { ...headers, "Content-Length": size } });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
    if (start > end) {
        return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }

    return new Response(Bun.file(filepath).slice(start, end + 1), {
        status: 206,
        headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Content-Length": end - start + 1,
        }
    });
}
