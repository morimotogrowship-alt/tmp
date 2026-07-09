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

async function postStory(igUserId, base, imageFile) {
  const image_url = rawUrlFor("images", imageFile);
  return createAndPublish(
    igUserId,
    "story",
    { image_url, media_type: "STORIES" },
    { maxTries: 10, intervalMs: 3000 }
  );
}

async function postReel(igUserId, base, videoFile, caption) {
  const video_url = rawUrlFor("videos", videoFile);
  return createAndPublish(
    igUserId,
    "reel",
    { video_url, media_type: "REELS", caption },
    { maxTries: 20, intervalMs: 5000 } // 動画処理は時間がかかるため長めに待つ
  );
}

async function main() {
  const { id: igUserId, username } = await graphGet(
    `/me?fields=id,username&access_token=${TOKEN}`
  );
  console.log(`Instagramアカウント: @${username} (${igUserId})`);

  const ledger = loadLedger();

  const imageFiles = fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => /\.(png|jpe?g)$/i.test(f));
  const videoFiles = fs.existsSync(VIDEOS_DIR)
    ? fs.readdirSync(VIDEOS_DIR).filter((f) => /\.mp4$/i.test(f))
    : [];

  const bases = [...new Set(imageFiles.map((f) => f.replace(/\.[^.]+$/, "")))];

  let hadError = false;

  for (const base of bases) {
    const imageFile = imageFiles.find((f) => f.replace(/\.[^.]+$/, "") === base);
    const videoFile = videoFiles.find((f) => f.replace(/\.[^.]+$/, "") === base);
    const caption = captionFor(base);

    if (!caption) {
      console.warn(`[${base}] captions/${base}.txt が未記入のためスキップ`);
      continue;
    }

    ledger[base] = ledger[base] || {};
    let didSomething = false;

    console.log(`[${base}] 処理開始`);

    if (!ledger[base].story) {
      try {
        const mediaId = await postStory(igUserId, base, imageFile);
        ledger[base].story = { mediaId, postedAt: new Date().toISOString() };
        didSomething = true;
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
        const mediaId = await postReel(igUserId, base, videoFile, caption);
        ledger[base].reel = { mediaId, postedAt: new Date().toISOString() };
        didSomething = true;
      } catch (err) {
        hadError = true;
        console.error(`  reel: 投稿失敗 ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (didSomething) saveLedger(ledger);
  }

  if (hadError) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
