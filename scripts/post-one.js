const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const IMAGES_DIR = path.join(REPO_ROOT, "images");
const VIDEOS_DIR = path.join(REPO_ROOT, "videos");
const CAPTIONS_DIR = path.join(REPO_ROOT, "captions");
const LEDGER_PATH = path.join(REPO_ROOT, "posted.json");

const GRAPH_API = "https://graph.instagram.com/v21.0";
const TOKEN = process.env.IG_ACCESS_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY; // "owner/repo"

if (!TOKEN) {
  console.error("IG_ACCESS_TOKEN が設定されていません");
  process.exit(1);
}
if (!REPO) {
  console.error("GITHUB_REPOSITORY が取得できません");
  process.exit(1);
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return {};
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
}

function saveLedger(ledger) {
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + "\n");
}

function rawUrlFor(dir, filename) {
  const encoded = filename
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://raw.githubusercontent.com/${REPO}/main/${dir}/${encoded}`;
}

function captionFor(base) {
  const captionPath = path.join(CAPTIONS_DIR, `${base}.txt`);
  if (!fs.existsSync(captionPath)) return null;
  const text = fs.readFileSync(captionPath, "utf8").trim();
  return text.length > 0 ? text : null;
}

// 先頭の数字（例: "02_Yunth..." -> 2）でソートする。ランキング順=投稿順の想定
function naturalKey(base) {
  const m = base.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

async function graphGet(pathAndQuery) {
  const res = await fetch(`${GRAPH_API}${pathAndQuery}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${pathAndQuery} -> ${JSON.stringify(body)}`);
  return body;
}

async function graphPost(igPath, params) {
  const url = new URL(`${GRAPH_API}${igPath}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(`POST ${igPath} -> ${JSON.stringify(body)}`);
  return body;
}

async function waitUntilFinished(creationId, maxTries, intervalMs) {
  for (let i = 0; i < maxTries; i++) {
    const { status_code } = await graphGet(
      `/${creationId}?fields=status_code&access_token=${TOKEN}`
    );
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR" || status_code === "EXPIRED") {
      throw new Error(`メディアコンテナの生成失敗: status_code=${status_code}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("メディアコンテナの生成待ちがタイムアウトしました");
}

async function createAndPublish(igUserId, label, containerParams, waitOpts) {
  const { id: creationId } = await graphPost(`/${igUserId}/media`, {
    ...containerParams,
    access_token: TOKEN,
  });

  await waitUntilFinished(creationId, waitOpts.maxTries, waitOpts.intervalMs);

  const { id: mediaId } = await graphPost(`/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: TOKEN,
  });

  console.log(`  ${label}: 投稿完了 media_id=${mediaId}`);
  return mediaId;
}

async function postStory(igUserId, imageFile) {
  const image_url = rawUrlFor("images", imageFile);
  return createAndPublish(
    igUserId,
    "story",
    { image_url, media_type: "STORIES" },
    { maxTries: 10, intervalMs: 3000 }
  );
}

async function postReel(igUserId, videoFile, caption) {
  const video_url = rawUrlFor("videos", videoFile);
  return createAndPublish(
    igUserId,
    "reel",
    { video_url, media_type: "REELS", caption },
    { maxTries: 20, intervalMs: 5000 } // 動画処理は時間がかかるため長めに待つ
  );
}

function deleteIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function main() {
  const { id: igUserId, username } = await graphGet(
    `/me?fields=id,username&access_token=${TOKEN}`
  );
  console.log(`Instagramアカウント: @${username} (${igUserId})`);

  const ledger = loadLedger();

  const imageFiles = fs.existsSync(IMAGES_DIR)
    ? fs.readdirSync(IMAGES_DIR).filter((f) => /\.(png|jpe?g)$/i.test(f))
    : [];
  const videoFiles = fs.existsSync(VIDEOS_DIR)
    ? fs.readdirSync(VIDEOS_DIR).filter((f) => /\.mp4$/i.test(f))
    : [];

  const candidates = [...new Set(imageFiles.map((f) => f.replace(/\.[^.]+$/, "")))]
    .filter((base) => captionFor(base) !== null)
    .filter((base) => {
      const done = ledger[base]?.story && ledger[base]?.reel;
      return !done;
    })
    .sort((a, b) => naturalKey(a) - naturalKey(b) || a.localeCompare(b));

  if (candidates.length === 0) {
    console.log("投稿可能な在庫（画像+キャプションが揃った未投稿分）がありません。今回はスキップします。");
    return;
  }

  const base = candidates[0];
  const imageFile = imageFiles.find((f) => f.replace(/\.[^.]+$/, "") === base);
  const videoFile = videoFiles.find((f) => f.replace(/\.[^.]+$/, "") === base);
  const caption = captionFor(base);

  console.log(`[${base}] を投稿します（在庫${candidates.length}件中の先頭）`);
  ledger[base] = ledger[base] || {};
  let hadError = false;

  if (!ledger[base].story) {
    try {
      const mediaId = await postStory(igUserId, imageFile);
      ledger[base].story = { mediaId, postedAt: new Date().toISOString() };
    } catch (err) {
      hadError = true;
      console.error(`  story: 投稿失敗 ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!videoFile) {
    console.warn(`  reel: videos/${base}.mp4 が無いためスキップ`);
  } else if (!ledger[base].reel) {
    try {
      const mediaId = await postReel(igUserId, videoFile, caption);
      ledger[base].reel = { mediaId, postedAt: new Date().toISOString() };
    } catch (err) {
      hadError = true;
      console.error(`  reel: 投稿失敗 ${err.message}`);
    }
  }

  saveLedger(ledger);

  // 投稿が完了した分（動画が無い場合はstoryのみで完了扱い）は在庫から削除し、二重投稿を防ぐ
  const storyDone = !!ledger[base].story;
  const reelDone = !videoFile || !!ledger[base].reel;
  if (storyDone && reelDone) {
    deleteIfExists(path.join(IMAGES_DIR, imageFile));
    if (videoFile) deleteIfExists(path.join(VIDEOS_DIR, videoFile));
    deleteIfExists(path.join(CAPTIONS_DIR, `${base}.txt`));
    console.log(`[${base}] 投稿完了・在庫から削除しました`);
  } else {
    console.log(`[${base}] 一部失敗したため在庫に残します（次回リトライ）`);
  }

  if (hadError) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
