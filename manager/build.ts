import { cp, mkdir, rm } from "node:fs/promises";

const root = new URL(".", import.meta.url).pathname;
const dist = `${root}dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const build = await Bun.build({ entrypoints: [`${root}src/app.ts`], target: "browser", format: "esm", minify: true });
await Bun.write(`${dist}/app.js`, await build.outputs[0].text());
await cp(`${root}index.html`, `${dist}/index.html`);
await cp(`${root}src/styles.css`, `${dist}/styles.css`);
await cp(`${root}packs`, `${dist}/packs`, { recursive: true });

console.log("dist ready");
