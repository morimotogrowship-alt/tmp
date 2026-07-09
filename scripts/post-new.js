const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const IMAGES_DIR = path.join(REPO_ROOT, "images");
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

function rawUrlFor(filename) {
  const encoded = filename
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `https://raw.githubusercontent.com/${REPO}/main/images/${encoded}`;
}

function captionFor(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
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

async function waitUntilFinished(creationId, maxTries = 10, intervalMs = 3000) {
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

async function postImage(igUserId, filename, caption) {
  const image_url = rawUrlFor(filename);
  console.log(`[${filename}] コンテナ作成: ${image_url}`);
  const { id: creationId } = await graphPost(`/${igUserId}/media`, {
    image_url,
    caption,
    access_token: TOKEN,
  });

  await waitUntilFinished(creationId);

  console.log(`[${filename}] 公開実行`);
  const { id: mediaId } = await graphPost(`/${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: TOKEN,
  });

  return mediaId;
}

async function main() {
  const { id: igUserId, username } = await graphGet(
    `/me?fields=id,username&access_token=${TOKEN}`
  );
  console.log(`Instagramアカウント: @${username} (${igUserId})`);

  const ledger = loadLedger();
  const files = fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .filter((f) => !ledger[f]);

  if (files.length === 0) {
    console.log("新規投稿対象はありません");
    return;
  }

  let hadError = false;

  for (const filename of files) {
    const caption = captionFor(filename);
    if (!caption) {
      console.warn(
        `[${filename}] captions/${filename.replace(/\.[^.]+$/, "")}.txt が未記入のためスキップ`
      );
      continue;
    }

    try {
      const mediaId = await postImage(igUserId, filename, caption);
      ledger[filename] = {
        mediaId,
        postedAt: new Date().toISOString(),
      };
      saveLedger(ledger);
      console.log(`[${filename}] 投稿完了: media_id=${mediaId}`);
    } catch (err) {
      hadError = true;
      console.error(`[${filename}] 投稿失敗: ${err.message}`);
    }

    // Instagram側のレート制限に配慮し、複数投稿時は間隔を空ける
    await new Promise((r) => setTimeout(r, 5000));
  }

  if (hadError) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
