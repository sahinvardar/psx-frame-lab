const assert = require("node:assert/strict"),
  P = require("./dist/engine.js"),
  fs = require("node:fs"),
  vm = require("node:vm");
let raw = new Uint16Array(1024 * 512),
  c = {
    clut: [0, 480],
    page: { x: 640, y: 0, depth: 0 },
    textureWindow: [0, 0, 0, 0],
    kind: "polygon",
    v: [{ uv: [0, 0] }, { uv: [1, 0] }, { uv: [0, 1] }],
  };
raw[640] = 0x10;
raw[480 * 1024 + 1] = 31;
let p = P.texturePreview(raw, c);
assert.equal(p.width, 2);
assert.deepEqual(Array.from(p.crop.slice(0, 8)), [0, 0, 0, 0, 255, 0, 0, 255]);
c.page.depth = 1;
raw[640] = 0x0100;
assert.deepEqual(
  Array.from(P.texturePreview(raw, c).crop.slice(4, 8)),
  [255, 0, 0, 255],
);
c.page.depth = 2;
raw[640] = 0x03e0;
assert.deepEqual(
  Array.from(P.texturePreview(raw, c).crop.slice(0, 4)),
  [0, 255, 0, 255],
);
c.textureWindow = [1, 0, 1, 0];
raw[648] = 0x7c00;
assert.deepEqual(
  Array.from(P.texturePreview(raw, c).crop.slice(0, 4)),
  [0, 0, 255, 255],
);
c.textureWindow = [0, 0, 0, 0];
c.kind = "rectangle";
c.size = [3, 2];
c.textureFlip = [true, false];
c.v = [{ uv: [1, 0] }];
p = P.texturePreview(raw, c);
assert.equal(p.left, -1);
assert.equal(p.width, 3);
assert.equal(p.height, 2);
assert.equal(P.texturePreview(raw, { kind: "polygon" }), null);
if (process.argv[2] && process.argv[3]) {
  const html = fs.readFileSync(__dirname + "/dist/PSX-Frame-Lab.html", "utf8"),
    source = JSON.parse(
      html.match(/window\.PSX_WORKER_SOURCE=(.*?);<\/script>/s)[1],
    );
  let last;
  const ctx = { TextDecoder, console, postMessage: (m) => (last = m) };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  (async () => {
    const b = fs.readFileSync(process.argv[2]);
    await ctx.onmessage({
      data: {
        type: "load",
        buffer: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      },
    });
    assert.equal(last.type, "loaded", last.text);
    const commands = last.commands,
      idx = commands.findIndex((c) => c.clut);
    await ctx.onmessage({ data: { type: "seek", n: idx + 1 } });
    assert(last.textureRaw);
    const dump = P.parse(new Uint8Array(fs.readFileSync(process.argv[3]))),
      gpu = new P.GPU();
    for (const c of dump.setup) gpu.apply(c, true);
    for (let j = 0; j < idx; j++) gpu.apply(dump.commands[j], true);
    assert.deepEqual(
      Buffer.from(last.textureRaw.buffer),
      Buffer.from(gpu.vram.buffer),
    );
    assert(P.texturePreview(last.textureRaw, commands[idx]));
    await ctx.onmessage({ data: { type: "seek", n: 0 } });
    assert.equal(last.textureRaw, null);
    console.log(
      "Passed: 4/8/15-bit preview, transparency, texture window, rectangle flips, nontextured selection, and pre-command Spyro texture snapshot.",
    );
  })();
} else
  console.log(
    "Passed: 4/8/15-bit preview, transparency, texture window, rectangle flips, and nontextured selection.",
  );
