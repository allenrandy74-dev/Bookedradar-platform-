import express from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";

// Reuse the reviewed marketing source; publish only the Quick Start assets.
export function createPublicOnboardingRouter({ sourceDirectory = path.resolve("website/src") } = {}) {
  const router = express.Router();
  const platform = "https://bookedradar-platform.onrender.com/onboarding";
  router.get("/quick-start.html", async (_req, res, next) => {
    try {
      const source = await readFile(path.join(sourceDirectory, "quick-start.html"), "utf8");
      const html = source
        .replace("<head>", '<head><base href="https://www.bookedradar.com/">')
        .replace('href="styles.css"', `href="${platform}/styles.css"`)
        .replace('src="quick-start.js"', `src="${platform}/quick-start.js"`);
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  });
  for (const file of ["quick-start.js", "styles.css"]) {
    router.get(`/${file}`, (_req, res) => res.sendFile(path.join(sourceDirectory, file)));
  }
  return router;
}
