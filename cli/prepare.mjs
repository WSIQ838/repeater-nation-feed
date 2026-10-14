// Copies the shared audio code next to the command line tool so the folder is self-contained.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync(new URL("./core/", import.meta.url), { recursive: true });
cpSync(new URL("../core/", import.meta.url), new URL("./core/", import.meta.url), { recursive: true });
console.log("core copied");
