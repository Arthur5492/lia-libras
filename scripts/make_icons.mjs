// Make the PNG icons from public/icon.svg. Run: node scripts/make_icons.mjs
import sharp from "sharp";

const svg = "public/icon.svg";
await sharp(svg).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(svg).resize(180, 180).png().toFile("public/apple-touch-icon.png");
// The maskable icon needs a safe zone, so put the icon on a larger background.
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0f2e36" } })
  .composite([{ input: await sharp(svg).resize(400, 400).png().toBuffer(), gravity: "center" }])
  .png()
  .toFile("public/icon-maskable-512.png");
console.log("icons written");
