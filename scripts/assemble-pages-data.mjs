import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = resolve(root, ".github/pages-data");
const manifest = JSON.parse(
  await readFile(resolve(dataDir, "manifest.json"), "utf8"),
);

for (const item of manifest.files) {
  const chunks = [];
  for (let index = 0; index < item.parts; index += 1) {
    chunks.push(await readFile(resolve(dataDir, `${item.name}.${index}.part`)));
  }
  const data = Buffer.concat(chunks);
  const sha256 = createHash("sha256").update(data).digest("hex");
  if (data.length !== item.bytes || sha256 !== item.sha256) {
    throw new Error(`Dados incompletos ou alterados: ${item.name}`);
  }
  const target = resolve(root, "public/data", item.name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
  console.log(`Restaurado ${item.name} (${item.bytes} bytes)`);
}
