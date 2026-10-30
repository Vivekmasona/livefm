const DEVELOPER_NAME = "VivekMasona";

let kvInstance: Deno.Kv | null = null;

async function getKv() {
  if (!kvInstance) {
    kvInstance = await Deno.openKv();
  }
  return kvInstance;
}

async function getState() {
  const kv = await getKv();
  const res = await kv.get(["station_state_pure"]);
  if (!res.value || typeof res.value !== 'object' || !Array.isArray((res.value as any).playlist)) {
    const initialState = { playlist: [], stationStartTime: Date.now() };
    await kv.set(["station_state_pure"], initialState);
    return initialState;
  }
  return res.value as { playlist: any[]; stationStartTime: number };
}

async function updateState(newState: { playlist: any[]; stationStartTime: number }) {
  const kv = await getKv();
  await kv.set(["station_state_pure"], newState);
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
    // 1. Search API
    if (url.pathname === "/api/search" && method === "GET") {
      const query = url.searchParams.get("q");
      if (!query) {
        return new Response(JSON.stringify({ error: "Query required" }), { status: 400, headers });
      }

      const svnRes = await fetch(`https://svn-vivekfy.vercel.app/search/songs?query=${encodeURIComponent(query)}`);
      const svnData = await svnRes.json();
      const rawResults = svnData?.data?.results || svnData?.results || svnData?.data || [];
      const songs = Array.isArray(rawResults) ? rawResults : [];

      const cleanSongs = songs.map((s: any) => ({
        title: s.name || s.title || "Unknown",
        primaryArtists: s.primaryArtists || s.artist || s.singers || "Unknown",
        image: s.image?.[s.image.length - 1]?.link || s.image?.[s.image.length - 1]?.url || s.image || "",
        url: s.downloadUrl?.[s.downloadUrl.length - 1]?.link || s.downloadUrl?.[s.downloadUrl.length - 1]?.url || s.url || s.audio || "",
        duration: Number(s.duration) || 180
      })).filter((s: any) => s.url);

      return new Response(JSON.stringify({ developer: DEVELOPER_NAME, results: cleanSongs }), { headers });
    }

    // 2. Get State (Fetched ONCE by client)
    if (url.pathname === "/api/playlist" && method === "GET") {
      const state = await getState();
      return new Response(JSON.stringify({ developer: DEVELOPER_NAME, ...state }), { headers });
    }

    // 3. Add Song API (POST)
    if (url.pathname === "/api/playlist" && method === "POST") {
      const newSong = await req.json();
      if (!newSong.url || !newSong.title) {
        return new Response(JSON.stringify({ error: "Invalid song data" }), { status: 400, headers });
      }

      let state = await getState();
      const exists = state.playlist.some((s: any) => s.url === newSong.url);
      if (!exists) {
        newSong.duration = Number(newSong.duration) || 180;
        if (state.playlist.length === 0) {
          state.stationStartTime = Date.now();
        }
        state.playlist.push(newSong);
        await updateState(state);
      }

      return new Response(JSON.stringify({ success: true, ...state }), { headers });
    }

    // 4. Delete Song API
    if (url.pathname.startsWith("/api/playlist/") && method === "DELETE") {
      const parts = url.pathname.split("/");
      const index = parseInt(parts[parts.length - 1]);
      
      let state = await getState();
      let playlist = state.playlist || [];

      if (!isNaN(index) && index >= 0 && index < playlist.length) {
        playlist.splice(index, 1);
        state.playlist = playlist;
        state.stationStartTime = Date.now(); // Reset baseline for sync math
        await updateState(state);
      }

      return new Response(JSON.stringify({ success: true, ...state }), { headers });
    }

    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });

  } catch (err: any) {
    console.error("Server Error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}

Deno.serve(handler);
