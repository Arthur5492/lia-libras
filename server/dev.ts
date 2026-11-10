// Local API server for development. Run with the Firebase emulators (see README.md).
import { createServer } from "node:http";
import { handleNode } from "./node.js";

const port = Number(process.env.PORT || 8000);

createServer((req, res) => {
  handleNode(req, res).catch((error) => {
    console.error(error);
    res.statusCode = 500;
    res.end(JSON.stringify({ code: "internal_error" }));
  });
}).listen(port, () => console.log(`API on http://127.0.0.1:${port}`));
