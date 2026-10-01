import express from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";

// Reuse the reviewed marketing source; expose only the selected public assets.
export function createPublicOnboardingRouter({ sourceDirectory = path.resolve("website/src") } = {}) {
  const router = express.Router();
  const platform = "https://bookedradar-platform.onrender.com/onboarding";
  for (const page of ["quick-start", "audit"]) router.get(`/${page}.html`, async (_req, res, next) => {
    try {
      const source = await readFile(path.join(sourceDirectory, `${page}.html`), "utf8");
      const html = source
        .replace("<head>", '<head><base href="https://www.bookedradar.com/">')
        .replace('href="styles.css"', `href="${platform}/styles.css"`)
        .replace('src="quick-start.js"', `src="${platform}/quick-start.js"`)
        .replace('src="audit.js"', `src="${platform}/audit.js"`)
        .replace('src="audit-capture.js"', `src="${platform}/audit-capture.js"`)
        .replace('src="bookedradar-telemetry.js"', `src="${platform}/bookedradar-telemetry.js"`);
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  });
  for (const file of ["quick-start.js", "audit.js", "audit-capture.js", "bookedradar-telemetry.js", "styles.css"]) {
    router.get(`/${file}`, (_req, res) => res.sendFile(path.join(sourceDirectory, file)));
  }
  return router;
}
