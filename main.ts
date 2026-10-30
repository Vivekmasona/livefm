const DEVELOPER_NAME = "Vivek Masona";

let kvInstance = null;

async function getKv() {
  if (!kvInstance) {
    kvInstance = await Deno.openKv();
  }
  return kvInstance;
}

// Database se state lena ya naya initialize karna
async function getState() {
  const kv = await getKv();
  const res = await kv.get(["station_state_v2"]);
  
  if (!res.value || typeof res.value !== 'object' || !Array.isArray(res.value.playlist)) {
    const initialState = { playlist: [], stationStartTime: Date.now() };
    await kv.set(["station_state_v2"], initialState);
    return initialState;
  }
  return res.value;
}

// Database mein state save karna
async function updateState(newState) {
  const kv = await getKv();
  await kv.set(["station_state_v2"], newState);
  return newState;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = req.method;

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "X-Developer": DEVELOPER_NAME,
    "Content-Type": "application/json"
  };

  if (method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  try {
    // 1. Search Songs API
    if (url.pathname === "/api/search" && method === "GET") {
      const query = url.searchParams.get("q");
      if (!query) {
        return new Response(JSON.stringify({ error: "Query required" }), { status: 400, headers });
      }

      const svnRes = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(query)}`);
      const svnData = await svnRes.json();
      const rawResults = svnData?.data?.results || svnData?.results || svnData?.data || [];
      const songs = Array.isArray(rawResults) ? rawResults : [];

      const cleanSongs = songs.map((s) => ({
        title: s.name || s.title || "Unknown",
        primaryArtists: s.primaryArtists || s.artist || s.singers || "Unknown",
        image: s.image?.[s.image.length - 1]?.link || s.image?.[s.image.length - 1]?.url || s.image || "",
        url: s.downloadUrl?.[s.downloadUrl.length - 1]?.link || s.downloadUrl?.[s.downloadUrl.length - 1]?.url || s.url || s.audio || "",
        duration: Number(s.duration) || 180
      })).filter((s) => s.url);

      return new Response(JSON.stringify({ developer: DEVELOPER_NAME, results: cleanSongs }), { headers });
    }

    // 2. Get Playlist / Playback State API
    if (url.pathname === "/api/playlist" && method === "GET") {
      const state = await getState();
      const playback = calculatePlaybackState(state);
      return new Response(JSON.stringify(playback), { headers });
    }

    // 3. Add Song to Playlist API (POST)
    if (url.pathname === "/api/playlist" && method === "POST") {
      const newSong = await req.json();
      if (!newSong.url || !newSong.title) {
        return new Response(JSON.stringify({ error: "Invalid data" }), { status: 400, headers });
      }

      let state = await getState();
      
      // Check duplicate by URL
      const exists = state.playlist.some((s) => s.url === newSong.url);
      if (!exists) {
        newSong.duration = Number(newSong.duration) || 180;
        if (state.playlist.length === 0) {
          state.stationStartTime = Date.now();
        }
        state.playlist.push(newSong);
        await updateState(state);
      }

      const playback = calculatePlaybackState(state);
      return new Response(JSON.stringify({ success: true, ...playback }), { headers });
    }

    // 4. Play Specific Index API
    if (url.pathname === "/api/play" && method === "POST") {
      const { index } = await req.json();
      let state = await getState();
      let playlist = state.playlist || [];

      if (index !== undefined && index >= 0 && index < playlist.length) {
        let pastDurationSumMs = 0;
        for (let i = 0; i < index; i++) {
          pastDurationSumMs += ((Number(playlist[i].duration) || 180) * 1000);
        }
        state.stationStartTime = Date.now() - pastDurationSumMs;
        await updateState(state);
      }

      const playback = calculatePlaybackState(state);
      return new Response(JSON.stringify({ success: true, ...playback }), { headers });
    }

    // 5. Delete Song API
    if (url.pathname.startsWith("/api/playlist/") && method === "DELETE") {
      const parts = url.pathname.split("/");
      const index = parseInt(parts[parts.length - 1]);
      
      let state = await getState();
      let playlist = state.playlist || [];

      if (!isNaN(index) && index >= 0 && index < playlist.length) {
        playlist.splice(index, 1);
        state.playlist = playlist;
        state.stationStartTime = Date.now();
        await updateState(state);
      }

      const playback = calculatePlaybackState(state);
      return new Response(JSON.stringify({ success: true, ...playback }), { headers });
    }

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

// Playback time calculation logic
function calculatePlaybackState(state) {
  const playlist = state.playlist || [];
  if (playlist.length === 0) {
    return { developer: DEVELOPER_NAME, playlist: [], currentIndex: 0, seekTime: 0 };
  }

  const validPlaylist = playlist.map((song) => ({
    ...song,
    duration: Number(song.duration) || 180
  }));

  const totalPlaylistDurationMs = validPlaylist.reduce((acc, song) => acc + (song.duration * 1000), 0);
  if (totalPlaylistDurationMs <= 0) {
    return { developer: DEVELOPER_NAME, playlist: validPlaylist, currentIndex: 0, seekTime: 0 };
  }

  const elapsedMs = Math.max(0, Date.now() - state.stationStartTime);
  const timeInLoopMs = elapsedMs % totalPlaylistDurationMs;

  let accumulatedMs = 0;
  let currentIndex = 0;
  let seekTimeSec = 0;

  for (let i = 0; i < validPlaylist.length; i++) {
    const songDurationMs = validPlaylist[i].duration * 1000;
    if (timeInLoopMs < accumulatedMs + songDurationMs) {
      currentIndex = i;
      seekTimeSec = (timeInLoopMs - accumulatedMs) / 1000;
      break;
    }
    accumulatedMs += songDurationMs;
  }

  return {
    developer: DEVELOPER_NAME,
    playlist: validPlaylist,
    currentIndex: currentIndex,
    seekTime: parseFloat(seekTimeSec.toFixed(3))
  };
}

Deno.serve(handler);
