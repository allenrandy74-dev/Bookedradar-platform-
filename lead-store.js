import fs from "node:fs/promises";
import path from "node:path";

export async function appendLead(filePath, lead) {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.appendFile(absolute, JSON.stringify(lead) + "\n", "utf8");
  return absolute;
}
